var fs = require('fs');
var path = require('path');
var url = require('url');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;

// Third party modules
var _ = require('underscore');
var srs = require('srs');
var get = require('get');
var zipfile = require('zipfile');
var Step = require('step');

// Known SRS values
var SRS = {
    'WGS84': '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs',
    '900913': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over'
};

var downloads = {};
var pool = require('generic-pool').Pool({
    create: function(callback) { callback(null, {}); },
    destroy: function(obj) { delete obj; },
    max: 5
});

function download(url, filepath, callback) {
    var dl = filepath + '.download'
    if (downloads[url]) return downloads[url].once('done', callback);

    downloads[url] = new EventEmitter();
    pool.acquire(function(obj) {
        (new get(url)).toDisk(dl, function(err, file) {
            pool.release(obj);
            if (err) {
                downloads[url].emit('done', err);
                delete downloads[url];
                return callback(err);
            }
            fs.rename(dl, filepath, function(err) {
                downloads[url].emit('done', err, filepath);
                delete downloads[url];
                return callback(err, filepath);
            });
        });
    });
};

// https://gist.github.com/707661
function mkdirP(p, mode, f) {
    var cb = f || function() {};
    if (p.charAt(0) != '/') {
        cb(new Error('Relative path: ' + p));
        return;
    }

    var ps = path.normalize(p).split('/');
    path.exists(p, function(exists) {
        if (exists) cb(null);
        else mkdirP(ps.slice(0, -1).join('/'), mode, function(err) {
            if (err && err.code !== 'EEXIST') cb(err);
            else {
                fs.mkdir(p, mode, cb);
            }
        });
    });
};

// Recursive rm.
function rm(filepath, callback) {
    var killswitch = false;
    fs.stat(filepath, function(err, stat) {
        if (err) return callback(err);
        if (stat.isFile()) return fs.unlink(filepath, callback);
        if (!stat.isDirectory()) return callback(new Error('Unrecognized file.'));
        Step(function() {
            fs.readdir(filepath, this);
        },
        function(err, files) {
            if (err) throw err;
            if (files.length === 0) return this(null, []);
            var group = this.group();
            _(files).each(function(file) {
                rm(path.join(filepath, file), group());
            });
        },
        function(err) {
            if (err) return callback(err);
            fs.rmdir(filepath, callback);
        });
    });
};

// Generate the cache path for a given URL.
function cachepath(location) {
    var uri = url.parse(location);
    if (!uri.protocol) throw new Error('Invalid URL: ' + location);

    var hash = crypto.createHash('md5')
        .update(location)
        .digest('hex')
        .substr(0,8)
        + '-' + path.basename(uri.pathname, path.extname(uri.pathname));
    var extname = path.extname(uri.pathname);
    return _(['.shp', '.zip']).include(extname.toLowerCase())
        ? path.join(hash, hash + extname)
        : path.join(hash + extname);
};

// Unzip function, geared specifically toward unpacking a shapefile.
function unzip(file, callback) {
    try {
        var zf = new zipfile.ZipFile(file);
    } catch (err) {
        return callback(err);
    }

    var remaining = zf.names.length;
    var shp = _(zf.names).chain()
        .map(function(name) {
            if (path.extname(name).toLowerCase() !== '.shp') return;
            return path.join(
                path.dirname(file),
                path.basename(file, path.extname(file)) +
                path.extname(name).toLowerCase()
            );
        })
        .compact()
        .first()
        .value();
    if (!shp) return callback(new Error('Shapefile not found in zip ' + file));

    zf.names.forEach(function(name) {
        // Skip directories, hiddens.
        if (!path.extname(name) || name[0] === '.') {
            remaining--;
            if (!remaining) callback(null, shp);
        }
        // We're brutal in our expectations -- don't support nested
        // directories, and rename any file from `arbitraryName.SHP`
        // to `[hash].shp`.
        var dest = path.join(
            path.dirname(file),
            path.basename(file, path.extname(file)) +
            path.extname(name).toLowerCase()
        );
        zf.readFile(name, function(err, buff) {
            if (err) return callback(err);
            fs.open(dest, 'w', 0644, function(err, fd) {
                if (err) return callback(err);
                fs.write(fd, buff, 0, buff.length, null, function(err) {
                    if (err) return callback(err);
                    fs.close(fd, function(err) {
                        if (err) return callback(err);
                        remaining--;
                        if (!remaining) callback(null, shp);
                    });
                });
            });
        });
    });
};

// Like fs.symlink except that it will overwrite an existing symlink at the
// given path if it exists.
function forcelink(linkdata, path, callback) {
    fs.lstat(path, function(err, stat) {
        // Error.
        if (err && err.code !== 'ENOENT')
            return callback(err);

        // Path does not exist. Symlink.
        if (err && err.code === 'ENOENT')
            return fs.symlink(linkdata, path, callback);

        // Path exists and is not a symlink. Do nothing.
        if (!err && !stat.isSymbolicLink())
            return callback();

        // Path exists and is a symlink. Remove it and then symlink.
        if (!err && stat.isSymbolicLink()) {
            fs.unlink(path, function(err) {
                if (err) return callback(err);
                fs.symlink(linkdata, path, callback);
            });
        }
    });
};

// Fix known bad SRS strings to good ones.
function fixSRS(obj) {
    if (!obj.srs) return;

    var normalized = _(obj.srs.split(' ')).chain()
        .select(function(s) { return s.indexOf('=') > 0 })
        .sortBy(function(s) { return s })
        .reduce(function(memo, s) {
            var key = s.split('=')[0];
            var val = s.split('=')[1];
            if (val === '0') val = '0.0';
            memo[key] = val;
            return memo;
        }, {})
        .value();
    var legacy = {
        '+a': '6378137',
        '+b': '6378137',
        '+lat_ts': '0.0',
        '+lon_0': '0.0',
        '+proj': 'merc',
        '+units': 'm',
        '+x_0': '0.0',
        '+y_0': '0.0'
    };
    if (!_(legacy).chain()
        .reject(function(v, k) { return normalized[k] === v })
        .size()
        .value()) obj.srs = SRS['900913'];
}

// Resolve and process all externals for an MML file.
function resolve(options, callback) {
    if (typeof callback !== 'function') throw new Error('Second argument must be a callback');
    if (!options) return callback(new Error('options is required'));
    if (!options.mml) return callback(new Error('options.mml is required'));
    if (!options.base) return callback(new Error('options.base is required'));
    if (!options.cache) return callback(new Error('options.cache is required'));
    var mml = options.mml;
    var base = path.resolve(options.base);
    var cache = path.resolve(options.cache);
    var resolved = JSON.parse(JSON.stringify(mml));

    Step(function setup() {
        mkdirP(path.join(base, 'layers'), 0755, this);
    }, function externals(err) {
        if (err) throw err;

        var remaining = mml.Layer.length + mml.Stylesheet.length;
        var error = null;
        var next = function(err) {
            remaining--;
            if (err && err.code !== 'EEXIST') error = err;
            if (!remaining) this(error);
        }.bind(this);

        if (!remaining) return this();

        resolved.Stylesheet.forEach(function(s, index) {
            if (typeof s !== 'string') return next();
            var uri = url.parse(s);

            // URL, download.
            if (uri.protocol) return (new get(s)).asBuffer(function(err, data) {
                if (err) return next(err);

                resolved.Stylesheet[index] = {
                    id:path.basename(uri.pathname),
                    data:data.toString()
                };
                next(err);
            });

            // File, read from disk.
            if (uri.pathname[0] !== '/')
                uri.pathname = path.join(base, uri.pathname);
            fs.readFile(uri.pathname, 'utf8', function(err, data) {
                if (err) return next(err);

                resolved.Stylesheet[index] = {
                    id:s,
                    data:data
                };
                next(err);
            });
        });

        resolved.Layer.forEach(function(l, index) {
            if (!l.Datasource || !l.Datasource.file) return next();
            var name = l.name || 'layer-' + index;
            var uri = url.parse(l.Datasource.file);
            var extname = path.extname(uri.pathname);
            var symlink = function(err, file) {
                if (err) return next(err);
                if (!file) return next();

                switch (extname.toLowerCase()) {
                // Unzip and symlink to directory.
                case '.zip':
                    l.Datasource.file =
                        path.join(base, 'layers', name, path.basename(file, path.extname(file)) + '.shp');
                    path.exists(l.Datasource.file, function(exists) {
                        if (exists) return next();
                        unzip(file, function(err, file) {
                            if (err) return next(err);
                            forcelink(path.dirname(file), path.dirname(l.Datasource.file), next);
                        });
                    });
                    break;
                // Symlink directories
                case '.shp':
                    l.Datasource.file =
                        path.join(base, 'layers', name, path.basename(file));
                    path.exists(l.Datasource.file, function(exists) {
                        if (exists) return next();
                        forcelink(path.dirname(file), path.dirname(l.Datasource.file), next);
                    });
                    break;
                // Symlink files
                default:
                    l.Datasource.file =
                        path.join(base, 'layers', name + extname);
                    path.exists(l.Datasource.file, function(exists) {
                        if (exists) return next();
                        forcelink(file, l.Datasource.file, next);
                    });
                    break;
                }
            };

            // URL.
            if (uri.protocol) {
                var filepath = path.join(cache, cachepath(l.Datasource.file));
                path.exists(filepath, function(exists) {
                    if (exists) return symlink(null, filepath);
                    mkdirP(path.dirname(filepath), 0755, function(err) {
                        if (err && err.code !== 'EEXIST') return symlink(err);
                        download(l.Datasource.file, filepath, symlink);
                    });
                });
            // Absolute path.
            } else if (uri.pathname && uri.pathname[0] === '/') {
                symlink(null, uri.pathname);
            // Local path.
            } else {
                l.Datasource.file = path.resolve(path.join(base, uri.pathname));
                next();
            }
        });
    }, function autodetect(err) {
        if (err) throw err;

        var group = this.group();
        resolved.Layer.forEach(function(l, index) {
            var d = l.Datasource;
            var name = l.name || 'layer-' + index;

            switch (path.extname(d.file)) {
            case '.shp':
            case '.zip':
                d.type = d.type || 'shape';
                break;
            case '.geotiff':
            case '.geotif':
            case '.vrt':
            case '.tiff':
            case '.tif':
                d.type = d.type || 'gdal';
                l.srs = SRS['900913'];
                break;
            case '.geojson':
            case '.json':
                l.srs = srs.parse(d.file);
            case '.rss':
                d.type = d.type || 'ogr';
                d.layer_by_index = 0;
                break;
            case '.kml':
                d.type = d.type || 'ogr';
                d.layer_by_index = 0;
                l.srs = SRS['WGS84'];
                break;
            }

            if (d.type !== 'shape' || l.srs) return;

            var next = group();
            var prj = path.join(
                path.dirname(d.file),
                path.basename(d.file, path.extname(d.file)) + '.prj'
            );
            fs.readFile(prj, 'utf8', function(err, data) {
                if (err && err.code === 'ENOENT') return next(new Error('No projection found for layer "' + name + '" at ' + base));
                if (err) return next(err);

                try {
                    l.srs = l.srs || srs.parse(data).proj4;
                } catch (e) {}
                try {
                    l.srs = l.srs || srs.parse('ESRI::' + data).proj4;
                } catch (e) {}

                next(l.srs ? null : new Error('No projection found for layer "' + name + '" at ' + base));
            });
        });
    }, function end(err) {
        // Fix map & layer SRS values.
        resolved.srs = resolved.srs || SRS['900913'];
        fixSRS(resolved);
        resolved.Layer.forEach(fixSRS);

        callback(err, resolved);
    });
};

// Flush the cache for a given layer/url.
function flush(options, callback) {
    if (!options) return callback(new Error('options is required'));
    if (!options.base) return callback(new Error('options.base is required'));
    if (!options.cache) return callback(new Error('options.cache is required'));
    if (!options.layer) return callback(new Error('options.layer is required'));
    if (!options.url) return callback(new Error('options.url is required'));

    var uri = url.parse(options.url);
    if (!uri.protocol) return callback(new Error('Invalid URL: ' + options.url));

    var extname = path.extname(path.basename(uri.pathname));
    var filepath;
    var layerpath;

    switch (extname.toLowerCase()) {
    case '.zip':
    case '.shp':
        layerpath = path.join(options.base, 'layers', options.layer);
        filepath = path.join(options.cache, path.dirname(cachepath(options.url)));
        break;
    default:
        layerpath = path.join(options.base, 'layers', options.layer + extname);
        filepath = path.join(options.cache, cachepath(options.url));
        break;
    }

    Step(function() {
        fs.lstat(layerpath, this);
    }, function removeSymlink(err, stat) {
        if (err && err.code !== 'ENOENT') throw err;
        if (!err && stat.isSymbolicLink()) {
            fs.unlink(layerpath, this);
        } else {
            this();
        }
    }, function removeCache(err) {
        if (err) throw err;
        path.exists(filepath, function(exists) {
            if (!exists) return this();
            rm(filepath, this);
        }.bind(this));
    }, function finish(err) {
        callback(err);
    });
};

module.exports = {
    resolve: resolve,
    flush: flush
};

