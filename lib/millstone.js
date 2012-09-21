var fs = require('fs');
var path = require('path');
var url = require('url');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var mime = require('mime');
var mkdirp = require('mkdirp');

var exists = require('fs').exists || require('path').exists;

var env = process.env.NODE_ENV || 'development';

// Third party modules
var _ = require('underscore'),
    srs = require('srs'),
    request = require('request'),
    zipfile = require('zipfile'),
    Step = require('step'),
    utils = require('./util.js');

var file_linking_method = utils.forcelink;

// for Windows versions that do not support symlinks (like XP) fallback to copy method
try {
    fs.symlinkSync('',''); // on XP and node v0.8.9 will throw ENOSYS, function not implemented
} catch (e) {
    if (e.code === 'ENOSYS') {
        if (env == 'development') {
            console.log("[millstone] detected platform that does not support symlinks, switching to copying data instead");
        }
        file_linking_method = utils.copy;
    } else if (e.code === 'EPERM') {
        if (env == 'development') {
            console.log("[millstone] **NOTICE** detected a user that does not have the privilege to create symlinks so falling back to copying data. To avoid this please ask your Administrator for SeCreateSymbolicLinkPrivilege rights (http://msdn.microsoft.com/en-us/library/bb530716%28VS.85%29.aspx) or run as Administator");
        }
        // TODO - consider using hardlinks: https://github.com/mapbox/millstone/issues/71
        file_linking_method = utils.copy;
    }
}

// Known SRS values
var SRS = {
    'WGS84': '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs',
    '900913': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 ' +
        '+y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over'
};

// on object of locks for concurrent downloads
var downloads = {};
// object for tracking logging on downloads
var download_log_interval = true;
// last download count, in order to limit logging barf
var download_last_count;

var pool = require('generic-pool').Pool({
    create: function(callback) {
        callback(null, {});
    },
    destroy: function(obj) {
        obj = undefined;
    },
    max: 5
});


function download(url, options, callback) {
    if (env == 'development' && Object.keys(downloads).length > 1) {
        download_log_interval = setInterval(function() {
            var in_use = Object.keys(downloads);
            if (in_use.length > 0 && (download_last_count != in_use.length)) {
                console.log("[millstone] currently downloading " + in_use.length + " files: " + _(in_use).map(function(f) {return path.basename(f)}));
            }
            download_last_count = in_use.length;
        },5000);
    } else {
        clearInterval(download_log_interval)
    }
    // https://github.com/mapbox/millstone/issues/39
    url = unescape(url);
    var dl = options.filepath + '.download';
    // If this file is already being downloaded, attach the callback
    // to the existing EventEmitter
    if (downloads[url]) {
        return downloads[url].once('done', callback);
    } else {
        downloads[url] = new EventEmitter();
        pool.acquire(function(obj) {
            pool.release(obj);
            if (env == 'development') console.log("[millstone] downloading: '" + url + "'");
            var make_message = function() {
                var msg = "Unable to download '" + url + "'";
                if (options.name)
                    msg += " for '" + options.name + "'";
                return msg;
            };
            var req;
            try {
            req = request({
                url: url,
                proxy: process.env.HTTP_PROXY
            });
            } catch (err) {
                // catch Invalid URI error
                downloads[url].emit('done', err);
                delete downloads[url];
                err.message =  make_message() + " ("+err.message+")";
                return callback(err);
            }
            req.on('error', function(err) {
                downloads[url].emit('done', err);
                delete downloads[url];
                err.message =  make_message() + " ("+err.message+")";
                return callback(err);
            });
            req.pipe(fs.createWriteStream(dl)).on('error', function(err) {
                downloads[url].emit('done', err);
                delete downloads[url];
                err.message =  make_message() + " ("+err.message+")";
                return callback(err);
            }).on('close', function() {
                if (!req.response || (req.response && req.response.statusCode >= 400)) {
                    var err = new Error(make_message() + ' (server returned ' + req.response.statusCode + ')');
                    downloads[url].emit('done', err);
                    delete downloads[url];
                    return callback(err);
                } else {
                    fs.rename(dl, options.filepath, function(err) {
                        if (err) {
                          downloads[url].emit('done', err);
                          delete downloads[url];
                          return callback(err);
                        } else {
                            if (env == 'development') console.log("[millstone] finished downloading '" + options.filepath + "'");
                            // We store the headers from the download in a hidden file
                            // alongside the data for future reference. Currently, we
                            // only use the `content-disposition` header to determine
                            // what kind of file we downloaded if it doesn't have an
                            // extension.
                            var req_meta = _(req.req.res.headers).clone();
                            if (req.req.res.request && req.req.res.request.path) {
                                req_meta['path'] = req.req.res.request.path;
                            }
                            fs.writeFile(metapath(options.filepath), JSON.stringify(req_meta), 'utf-8', function(err) {
                                downloads[url].emit('done', err, options.filepath);
                                delete downloads[url];
                                return callback(err, options.filepath);
                            });
                        }
                    });
                }
            });
        });
    }
}

// Retrieve a remote copy of a resource only if we don't already have it.
function localize(url, options, callback) {
    exists(options.filepath, function(exists) {
        if (exists) {
            callback(null, options.filepath);
        } else {
            var dir_path = path.dirname(options.filepath);
            mkdirp(dir_path, 0755, function(err) {
                if (err && err.code !== 'EEXIST') {
                    if (env == 'development') console.log('[millstone] could not create directory: ' + dir_path);
                    callback(err);
                } else {
                    download(url, options, function(err, filepath) {
                        if (err) return callback(err);
                        callback(null, filepath);
                    });
                }
            });
        }
    });
}

// Generate the cache path for a given URL.
function cachepath(location) {
    var uri = url.parse(location);
    if (!uri.protocol) {
        throw new Error('Invalid URL: ' + location);
    } else {
        var hash = crypto.createHash('md5')
            .update(location)
            .digest('hex')
            .substr(0,8) +
            '-' + path.basename(uri.pathname, path.extname(uri.pathname));
        var extname = path.extname(uri.pathname);
        return _(['.shp', '.zip', '']).include(extname.toLowerCase()) ?
            path.join(hash, hash + extname)
            : path.join(hash + extname);
    }
}

// Determine the path for a files dotfile.
function metapath(filepath) {
    return path.join(path.dirname(filepath), '.' + path.basename(filepath));
}

function isRelative(loc) {
    if (process.platform === 'win32') {
        return loc[0] !== '\\' && loc.match(/^[a-zA-Z]:\\/) === null;
    } else {
        return loc[0] !== '/';
    }
}

function guessExtension(headers) {
    if (headers['path']) {
        var ext = path.extname(headers.path);
        if (ext) {
            return ext;
        }
    }
    if (headers['content-disposition']) {
        var match = headers['content-disposition'].match(/filename=['"](.*)['"]$/);
        if (!match) {
            match = headers['content-disposition'].match(/filename=['"]?([^'";]+)['"]?/);
        }
        if (match) {
            var ext = path.extname(match[1]);
            if (ext) {
                return ext;
            }
        }
    }
    if (headers['content-type']) {
        var ext = mime.extension(headers['content-type'].split(';')[0]);
        if (ext) {
            return '.' + ext;
        }
    }
    return '';
};

// Read headers and guess extension
function readExtension(file, cb) {
    fs.readFile(metapath(file), 'utf-8', function(err, data) {
        if (err) {
            if (err.code === 'ENOENT') return cb(new Error('Metadata file does not exist.'));
            return cb(err);
        }
        try {
            return cb(null, guessExtension(JSON.parse(data)));
        } catch (e) {
            return cb(e);
        }
    });
}

// Unzip function, geared specifically toward unpacking a shapefile.
function unzip(file, callback) {
    var zf;
    try {
        zf = new zipfile.ZipFile(file);
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
}

// Fix known bad SRS strings to good ones.
function fixSRS(obj) {
    if (!obj.srs) return;

    var normalized = _(obj.srs.split(' ')).chain()
        .select(function(s) { return s.indexOf('=') > 0; })
        .sortBy(function(s) { return s; })
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
        .reject(function(v, k) { return normalized[k] === v; })
        .size()
        .value()) obj.srs = SRS['900913'];
}

function checkTTL(cache, l) {
    var file = l.Datasource.file;
    var ttl = l.Datasource.ttl

    if (!url.parse(file).protocol) return;

    var filepath = path.join(cache, cachepath(file));
    fs.stat(filepath, function(err, stats) {
        if (err && err.code != 'ENOENT') return console.warn(err);

        var msttl = parseInt(ttl) * 1000;
        if (err || Date.now() > (new Date(stats.mtime).getTime() + msttl)) {
            download(file, {filepath:filepath,name:l.name}, function(err, filepath){
                if (err) return console.warn(err);
            });
        }
    });
}

// Resolve and process all externals for an MML file.
function resolve(options, callback) {
    if (typeof callback !== 'function') throw new Error('Second argument must be a callback');
    if (!options) return callback(new Error('options is required'));
    if (!options.mml) return callback(new Error('options.mml is required'));
    if (!options.base) return callback(new Error('options.base is required'));
    if (!options.cache) return callback(new Error('options.cache is required'));
    if (typeof options.nosymlink === "undefined") options.nosymlink = false;

    var mml = options.mml,
        base = path.resolve(options.base),
        cache = path.resolve(options.cache),
        resolved = JSON.parse(JSON.stringify(mml)),
        nosymlink = options.nosymlink;

    Step(function setup() {
        mkdirp(path.join(base, 'layers'), 0755, this);
    }, function externals(err) {
        if (err && err.code !== 'EEXIST') throw err;

        var remaining = mml.Layer.length + mml.Stylesheet.length;
        var error = null;
        var next = function(err) {
            remaining--;
            if (err && err.code !== 'EEXIST') error = err;
            if (!remaining) this(error);
        }.bind(this);

        if (!remaining) return this();

        resolved.Stylesheet.forEach(function(s, index) {
            if (typeof s !== 'string') {
                if (env == 'development') console.log("[millstone] processing style '" + s.id + "'");
                return localizeCartoURIs(s,next);
            }
            var uri = url.parse(s);

            // URL, download.
            if (uri.protocol && (uri.protocol == 'http:' || uri.protocol == 'https:')) {
                return request({
                    url: s,
                    proxy: process.env.HTTP_PROXY
                }, function(err, response, data) {
                    if (err) return next(err);

                    resolved.Stylesheet[index] = {
                        id: path.basename(uri.pathname),
                        data: data.toString()
                    };
                    localizeCartoURIs(resolved.Stylesheet[index],next);
                });
            }

            // File, read from disk.
            if (uri.pathname && isRelative(uri.pathname)) {
                uri.pathname = path.join(base, uri.pathname);
            }
            fs.readFile(uri.pathname, 'utf8', function(err, data) {
                if (err) return next(err);

                resolved.Stylesheet[index] = {
                    id: s,
                    data: data
                };
                localizeCartoURIs(resolved.Stylesheet[index],next);
            });
        });

        // Handle URIs within the Carto CSS
        function localizeCartoURIs(s,callback) {

            // Get all unique URIs in stylesheet
            // TODO - avoid finding non url( uris?
            var matches = s.data.match(/[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi);
            var URIs = _.uniq(matches || []);
            var CartoURIs = [];
            // remove any matched urls that are not clearly
            // part of a carto style
            // TODO - consider moving to carto so we can also avoid
            // downloading commented out code
            URIs.forEach(function(u) {
                var idx = s.data.indexOf(u);
                if (idx > -1) {
                    var pre_url = s.data.slice(idx-5,idx);
                    if (pre_url.indexOf('url(') > -1) {
                        CartoURIs.push(u);
                        // Update number of async calls so that we don't
                        // call this() too soon (before everything is done)
                        remaining += 1;
                    }
                }
            });

            CartoURIs.forEach(function(u) {
                var uri = url.parse(encodeURI(u));

                // URL.
                if (uri.protocol && (uri.protocol == 'http:' || uri.protocol == 'https:')) {
                    var filepath = path.join(cache, cachepath(u));
                    localize(uri.href, {filepath:filepath,name:s.id}, function(err, file) {
                        if (err) {
                            callback(err);
                        } else {
                            var extname = path.extname(file);
                            if (!extname) {
                                readExtension(file, function(error, ext) {
                                    // note - we ignore any readExtension errors
                                    if (ext) file += ext;
                                    s.data = s.data.split(u).join(file);
                                    callback(err);
                                });
                            } else {
                                s.data = s.data.split(u).join(file);
                                callback(err);
                            }
                        }
                    });
                } else {
                    callback();
                }
            });
            callback();
        }

        resolved.Layer.forEach(function(l, index) {
            if (!l.Datasource || !l.Datasource.file) return next();
            if (env == 'development') console.log("[millstone] processing layer '" + l.name + "'");

            // TODO find  better home for this check.
            if (l.Datasource.ttl) checkTTL(cache, l);

            var name = l.name || 'layer-' + index,
                uri = url.parse(encodeURI(l.Datasource.file)),
                pathname = decodeURI(uri.pathname),
                extname = path.extname(pathname);

            // This function takes (egregious) advantage of scope;
            // l, extname, and more is all up-one-level.
            //
            // `file`: filename to be symlinked in place to l.Datasource.file
            var symlink = function(file, cb) {
                if (!file) return cb();

                readExtension(file, function(err, ext) {
                    // ignore errors from extension check
                    //if (err) console.log(err);

                    ext = ext || extname;

                    switch (ext.toLowerCase()) {
                    // Unzip and symlink to directory.
                    case '.zip':
                        l.Datasource.file =
                            path.join(base,
                                'layers',
                                name,
                                path.basename(file, path.extname(file)) + '.shp');
                        exists(l.Datasource.file, function(exists) {
                            if (exists) return cb();
                            if (env == 'development') console.log("[millstone] unzipping '" + file + '"');
                            unzip(file, function(err, file) {
                                if (err) return cb(err);
                                utils.processSHP(file, l.Datasource.file, file_linking_method, {cache:cache}, cb);
                            });
                        });
                        break;
                    // Symlink directories
                    case '.shp':
                        l.Datasource.file =
                            path.join(base, 'layers', name, path.basename(file));
                        utils.processSHP(file, l.Datasource.file, file_linking_method, {cache:cache}, cb);
                        break;
                    // Symlink files
                    default:
                        l.Datasource.file =
                            path.join(base, 'layers', name + ext);
                        file_linking_method(file, l.Datasource.file, {cache:cache}, cb);
                        break;
                    }
                });
            };

            // URL.
            if (uri.protocol && (uri.protocol == 'http:' || uri.protocol == 'https:')) {
                var filepath = path.join(cache, cachepath(l.Datasource.file));
                localize(uri.href, {filepath:filepath,name:l.name}, function(err, file) {
                    if (err) return next(err);
                    if (nosymlink) {
                        l.Datasource.file = file;
                        next();
                    } else {
                        symlink(file, next)
                    }
                });
            // Absolute path.
            } else if (pathname && !isRelative(pathname)) {
                if (nosymlink) {
                    l.Datasource.file = pathname;
                    next();
                } else {
                    symlink(pathname, next);
                }
            // Local path.
            } else {
                l.Datasource.file = path.resolve(path.join(base, pathname));
                next();
            }
        });
    }, function processSql(err) {
        if (err) throw err;
        var group = this.group();
        resolved.Layer.forEach(function(l, index) {
            var d = l.Datasource;
            // mapnik's sqlite plugin resolves attached databases
            // relative to the main database, but in tilemill we prefer
            // to interpret relative to the project so we resolve here
            if (d.type == 'sqlite' && d.table && d.attachdb) {
                var next = group();
                var dbs = d.attachdb.split(',');
                Step(function() {
                    var group = this.group();
                    for (var i = 0; i < dbs.length; i++) (function(next) {
                        if (!dbs[i]) {
                            return next();
                        }

                        var file = url.parse(dbs[i].split('@').pop());
                        var pathname = file.pathname;
                        var extname = path.extname(pathname);
                        var alias = dbs[i].split('@').shift();
                        var name = (l.name || 'layer-' + index) + '-attach-' + alias;
                        var index = i;

                        var symlink = function(filepath, cb) {
                            var filename = path.join(base, 'layers', name + extname);
                            dbs[index] =  alias + '@' + filename;
                            file_linking_method(to, filename, {cache:cache}, cb);
                        };

                        // URL.
                        if (file.protocol) {
                            var filepath = path.join(cache, cachepath(file.href));
                            localize(file.href, {filepath:filepath,name:name}, function(err) {
                                if (err) return next(err);
                                if (nosymlink) {
                                    dbs[index] = alias + '@' + filepath;
                                    next();
                                } else {
                                    symlink(filepath, next);
                                }
                            });
                        }
                        // Absolute path.
                        else if (pathname && !isRelative(pathname)) {
                            if (nosymlink) {
                                dbs[index] = alias + '@' + pathname;
                                next();
                            } else {
                                symlink(pathname, next);
                            }
                        }
                        // Local path.
                        else {
                            dbs[index] =  alias + '@' + path.join(base, pathname);
                            next();
                        }
                    })(group());
                }, function(err) {
                    if (err) return next(err);
                    d.attachdb = dbs.join(',');
                    return next(err);
                });
            }
        });
    }, function autodetect(err) {
        if (err) throw err;

        var group = this.group();
        resolved.Layer.forEach(function(l, index) {
            var d = l.Datasource;
            var next = group();
            if (!d.file) return next();

            Step(function() {
                var ext = path.extname(d.file);
                var next = this;
                if (ext) {
                    next(null, ext);
                } else {
                    // This file doesn't have an extension, so we look for a
                    // hidden metadata file that will contain headers for the
                    // original HTTP request. We look at the
                    // `content-disposition` header to determine the extension.
                    fs.readlink(l.Datasource.file, function(err, resolvedPath) {
                        if (resolvedPath && isRelative(resolvedPath)) {
                            resolvedPath = path.join(path.dirname(l.Datasource.file), resolvedPath);
                        }
                        readExtension(resolvedPath, next);
                    });
                }
            }, function(err, ext) {
                // Ignore errors during extension checks above and let a
                // missing extension fall through to a missing `type`.

                var name = l.name || 'layer-' + index;

                var ext = ext || path.extname(d.file);
                switch (ext) {
                case '.csv':
                case '.tsv': // google refine uses tsv for tab-delimited
                case '.txt': // resonable assumption that .txt is csv?
                    d.type = d.type || 'csv';
                    l.srs = l.srs || SRS.WGS84;
                    break;
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
                    break;
                case '.geojson':
                case '.json':
                    d.type = d.type || 'ogr';
                    d.layer_by_index = 0;
                    l.srs = l.srs || srs.parse(d.file).proj4;
                    break;
                case '.kml':
                case '.rss':
                    d.type = d.type || 'ogr';
                    d.layer_by_index = 0;
                    // WGS84 is the only valid SRS for KML and RSS so we force
                    // it here.
                    l.srs = SRS.WGS84;
                    break;
                }

                if (l.srs) return next();

                var error = new Error('Unable to determine SRS for layer "' + name + '" at ' + d.file);
                if (d.type !== 'shape') {
                    // If we don't have a projection by now, bail out unless we have a shapefile.
                    return next(error);
                } else {
                    // Special handling that opens .prj files for shapefiles.
                    var prj_path = path.join(
                        path.dirname(d.file),
                        path.basename(d.file, path.extname(d.file)) + '.prj'
                    );
                    fs.readFile(prj_path, 'utf8', function(err, data) {
                        if (err && err.code === 'ENOENT') {
                            return next(error);
                        } else if (err) {
                            return next(err);
                        }

                        try {
                            l.srs = l.srs || srs.parse(data).proj4;
                            l.srs = l.srs || srs.parse('ESRI::' + data).proj4; // See issue #26.
                        } catch (e) {
                            next(e);
                        }

                        next(l.srs ? null : error);
                    });
                }
            });
        });
    }, function end(err) {
        // Fix map & layer SRS values.
        resolved.srs = resolved.srs || SRS['900913'];
        fixSRS(resolved);
        resolved.Layer.forEach(fixSRS);
        if (!err && env == 'development') console.log("[millstone] finished processing '" + options.base + "'");
        callback(err, resolved);
    });
}

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
        exists(filepath, function(exists) {
            if (!exists) return this();
            utils.rm(filepath, this);
        }.bind(this));
    }, function removeMetafile(err) {
        if (err) throw err;
        exists(metapath(filepath), function(exists) {
            if (!exists) return this();
            utils.rm(metapath(filepath), this);
        }.bind(this));
    }, function finish(err) {
        callback(err);
    });
}

module.exports = {
    resolve: resolve,
    flush: flush,
    isRelative: isRelative,
    guessExtension: guessExtension,
    downloads: downloads
};

