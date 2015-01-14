var fs = require('fs');
var path = require('path');
var url = require('url');
var crypto = require('crypto');
var EventEmitter = require('events').EventEmitter;
var mime = require('mime');
var mkdirp = require('mkdirp');

var existsAsync = require('fs').exists || require('path').exists;
var existsSync = require('fs').existsSync || require('path').existsSync;

var env = process.env.NODE_ENV || 'development';

// Third party modules
var _ = require('underscore'),
    srs = require('srs'),
    request = require('request'),
    zipfile = require('zipfile'),
    Step = require('step'),
    utils = require('./util.js');


// mapping of known file extensions
// to mapnik datasource plugin name
var valid_ds_extensions = {
  '.shp':'shape',
  '.csv':'csv',
  '.tsv':'csv',
  '.txt':'csv',
  '.geotiff':'gdal',
  '.geotif':'gdal',
  '.tif':'gdal',
  '.tiff':'gdal',
  '.vrt':'gdal',
  '.geojson':'ogr',
  '.json':'ogr',
  '.gml':'ogr',
  '.osm':'osm',
  '.kml':'ogr',
  '.rss':'ogr',
  '.gpx':'ogr',
  '.gdb':'ogr',
  '.topojson':'ogr',
  '.db':'sqlite',
  '.sqlite3':'sqlite',
  '.sqlite':'sqlite',
  '.spatialite':'sqlite'
};

// marker types readible by mapnik
var valid_marker_extensions = {
  '.svg':'svg',
  '.png':'image',
  '.tif':'image',
  '.tiff':'image',
  '.jpeg':'image',
  '.jpg':'image'
};

var file_linking_method = utils.forcelink;

var never_link = false;
if (process.platform === 'win32') {
    never_link = true;
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
var download_log_interval = null;
// last download count, in order to limit logging barf
var download_last_count = 0;

var pool = require('generic-pool').Pool({
    create: function(callback) {
        callback(null, {});
    },
    destroy: function(obj) {
        obj = undefined;
    },
    max: 10
});


function download(url, options, callback) {
    if (env == 'development') {
        if (!download_log_interval) {
            download_log_interval = setInterval(function() {
                var in_use = Object.keys(downloads);
                if (in_use.length > 0 && (download_last_count !== in_use.length)) {
                    var msg = "[millstone] currently downloading " + in_use.length + ' file';
                    if (in_use.length > 1) {
                        msg += 's';
                    }
                    msg += ': ' + _(in_use).map(function(f) { return path.basename(f); });
                    console.error(msg);
                }
                download_last_count = in_use.length;
            },5000);
        }
    } else {
        clearInterval(download_log_interval);
        download_log_interval = null;
    }
    // https://github.com/mapbox/millstone/issues/39
    url = unescape(url);
    var dl = options.filepath + '.download';
    // If this file is already being downloaded, attach the callback
    // to the existing EventEmitter
    var dkey = options.filepath + '|' + url;
    if (downloads[dkey]) {
        return downloads[dkey].once('done', callback);
    } else {
        pool.acquire(function(err, obj) {
            var make_message = function() {
                var msg = "Unable to download '" + url + "'";
                if (options.name)
                    msg += " for '" + options.name + "'";
                return msg;
            };
            var return_on_error = function(err) {
                downloads[dkey].emit('done', err);
                delete downloads[dkey];
                err.message =  make_message() + " ("+err.message+")";
                pool.release(obj);
                return callback(err);
            }
            downloads[dkey] = new EventEmitter();
            if (err) {
                return return_on_error(err);
            } else {
                if (env == 'development') console.error("[millstone] downloading: '" + url + "'");
                var req;
                try {
                req = request({
                    url: url,
                    proxy: process.env.HTTP_PROXY
                });
                } catch (err) {
                    // catch Invalid URI error
                    return return_on_error(err);
                }
                req.on('error', function(err) {
                    return return_on_error(err);
                });
                req.pipe(fs.createWriteStream(dl)).on('error', function(err) {
                    return return_on_error(err);
                }).on('close', function() {
                    if (!req.response || (req.response && req.response.statusCode >= 400)) {
                        return return_on_error(new Error('server returned ' + req.response.statusCode));
                    } else {
                        pool.release(obj);
                        fs.rename(dl, options.filepath, function(err) {
                            if (err) {
                              downloads[dkey].emit('done', err);
                              delete downloads[dkey];
                              return callback(err);
                            } else {
                                if (env == 'development') console.error("[millstone] finished downloading '" + options.filepath + "'");
                                // We store the headers from the download in a hidden file
                                // alongside the data for future reference. Currently, we
                                // only use the `content-disposition` header to determine
                                // what kind of file we downloaded if it doesn't have an
                                // extension.
                                var req_meta = _(req.req.res.headers).clone();
                                if (req.req.res.request && req.req.res.request.path) {
                                    req_meta.path = req.req.res.request.path;
                                }
                                fs.writeFile(metapath(options.filepath), JSON.stringify(req_meta), 'utf-8', function(err) {
                                    downloads[dkey].emit('done', err, options.filepath);
                                    delete downloads[dkey];
                                    return callback(err, options.filepath);
                                });
                            }
                        });
                    }
                });
            }
        });
    }
}

// Retrieve a remote copy of a resource only if we don't already have it.
function localize(url, options, callback) {
    existsAsync(options.filepath, function(exists) {
        if (exists) {
            var re_download = false;
            // unideal workaround for frequently corrupt/partially downloaded zips
            // https://github.com/mapbox/millstone/issues/85
            if (path.extname(options.filepath) == '.zip') {
                try {
                  var zf = new zipfile.ZipFile(options.filepath);
                  if (zf.names.length < 1) {
                      throw new Error("could not find any valid data in zip archive: '" + options.filepath + "'");
                  }
                } catch (e) {
                    if (env == 'development') console.error('[millstone] could not open zip archive: "' + options.filepath + '" attempting to re-download from "'+url+"'");
                    re_download = true;
                }
            }
            if (!re_download) {
                return callback(null, options.filepath);
            }
        }
        var dir_path = path.dirname(options.filepath);
        mkdirp(dir_path, 0755, function(err) {
            if (err && err.code !== 'EEXIST') {
                if (env == 'development') console.error('[millstone] could not create directory: ' + dir_path);
                callback(err);
            } else {
                download(url, options, function(err, filepath) {
                    if (err) return callback(err);
                    callback(null, filepath);
                });
            }
        });
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

function add_item_to_metafile(metafile,key,item,callback) {
	existsAsync(metafile, function(exists) {
        if (exists) {
            fs.readFile(metafile, 'utf-8', function(err, data) {
                if (err) return callback(err);
                var meta;
                try {
                    meta = JSON.parse(data);
                } catch (err) {
                    return callback(err);
                }
                meta[key] = item;
                fs.writeFile(metafile, JSON.stringify(meta), 'utf-8', function(err) {
                    if (err) return callback(err);
                    return callback(null);
                });
            });
        } else {
            var data = {};
            data[key] = item;
            fs.writeFile(metafile, JSON.stringify(data), 'utf-8', function(err) {
                if (err) return callback(err);
                return callback(null);
            });
        }
	});
}

function isRelative(loc,platform) {
    platform = platform || process.platform;
    if (platform === 'win32') {
        return loc[0] !== '\\' && loc[0] !== '/' && loc.match(/^[a-zA-Z]:/) === null;
    } else {
        return loc[0] !== '/';
    }
}

function isValidExt(ext) {
    if (ext) {
        var lower_ext = ext.toLowerCase();
        return lower_ext == '.zip' || valid_marker_extensions[lower_ext] || valid_ds_extensions[lower_ext];
    }
    return false;
}

function guessExtension(headers) {
    if (headers.path) {
        var ext = path.extname(headers.path);
        if (isValidExt(ext)) {
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
            if (isValidExt(ext)) {
                return ext;
            }
        }
    }
    if (headers['content-type']) {
        if (headers['content-type'].indexOf('subtype=gml') != -1) {
            return '.gml'; // avoid .xml being detected for gml
        }
        var ext_no_dot = mime.extension(headers['content-type'].split(';')[0]);
        var ext = '.'+ext_no_dot;
        if (isValidExt(ext)) {
            return ext;
        }
    }
    return '';
}

// Read headers and guess extension
function readExtension(file, cb) {
    fs.readFile(metapath(file), 'utf-8', function(err, data) {
        if (err) {
            if (err.code === 'ENOENT') return cb(new Error('Metadata file does not exist.'));
            return cb(err);
        }
        try {
            var ext = guessExtension(JSON.parse(data));
            if (ext) {
                if (env == 'development') console.error("[millstone] detected extension of '" + ext + "' for '" + file + "'");
            }
            return cb(null, ext);
        } catch (e) {
            return cb(e);
        }
    });
}

// Unzip function, geared specifically toward unpacking a shapefile.
function unzip(file, callback) {
    var metafile = metapath(file);
    // return cached result of unzipped file
    // intentionally sync here to avoid race condition unzipping
    // same file for multiple layers
    try {
        var meta_data = fs.readFileSync(metafile);
        if (meta_data) {
            var meta = JSON.parse(meta_data);
            var dest_file = meta['unzipped_file'];
            if (dest_file && existsSync(dest_file)) {
                if (env == 'development') console.error('[millstone] found previously unzipped file: ' + dest_file);
                return callback(null,dest_file);
            }
        } else {
            if (env == 'development') console.error('[millstone] empty meta file for zipfile: ' + metafile);
        }
    }
    catch (err) {
        if (env == 'development') console.error('[millstone] error opening meta file for zipfile: ' + err.message);
    }
    var zf;
    try {
        zf = new zipfile.ZipFile(file);
    } catch (err) {
        return callback(err);
    }

    if (zf.names.length < 1) {
        return callback(new Error("could not find any valid data in zip archive: '" + file + "'"));
    }

    var remain = zf.names.length;
    var ds_files = _(zf.names).chain()
        .reject(function(name) {
            return (name && (name[0] === '.' || path.basename(name)[0] === '.'));
        })
        .map(function(name) {
            if (!valid_ds_extensions[path.extname(name).toLowerCase()]) return;
            var new_name = path.join(
                path.dirname(file),
                path.basename(file, path.extname(file)) +
                path.extname(name).toLowerCase());
            return {new_name:new_name,original_name:name};
        })
        .uniq()
        .compact()
        .value();

    if (!ds_files || ds_files.length < 1) return callback(new Error("Valid datasource not detected (by extension) in zip: '" + file + "'"));

    var original_name = ds_files[0].original_name;
    var new_name = ds_files[0].new_name;

    var len = Object.keys(ds_files).length;
    if (len > 1) {
        // prefer first .shp
        for (var i=0;i<len;++i) {
            var fname = ds_files[i].original_name;
            if (path.extname(fname) == '.shp') {
                original_name = fname;
                new_name = ds_files[i].new_name;
                break;
            }
        }
        if (env == 'development') {
            console.warn('[millstone] warning: detected more than one file in zip (by ext) that may be valid: ');
            for (var i=0;i<len;++i) {
                console.warn('[millstone]   ' + ds_files[i].original_name);
            }
            console.warn('[millstone] picked: ' + original_name);
        }
    }

    if (!new_name) return callback(new Error("Valid datasource not detected (by extension) in zip: '" + file + "'"));

    if (env == 'development') {
        console.warn('[millstone] renaming ' + original_name + ' to ' + new_name);
    }

    // only unzip files that match our target name
    // naive '(name.indexOf(search_basename) < 0)' does the trick
    // yes this is simplistic, but its better than corrupt data: https://github.com/mapbox/millstone/issues/99
    var search_basename = path.basename(original_name,path.extname(original_name));
    zf.names.forEach(function(name) {
        // Skip directories, hiddens.
        var basename = path.basename(name);
        if (!path.extname(name) || (name.indexOf(search_basename) < 0) || name[0] === '.' || basename[0] === '.') {
            remain--;
            if (!remain) callback(null, new_name);
        } else {
            // We're brutal in our expectations -- don't support nested
            // directories, and rename any file from `arbitraryName.SHP`
            // to `[hash].shp`.
            var dest = path.join(
                path.dirname(file),
                path.basename(file, path.extname(file)) +
                path.extname(name).toLowerCase()
            );
            zf.copyFile(name, dest, function(err) {
                if (err) return callback(err);
                remain--;
                if (!remain) {
                    add_item_to_metafile(metafile,'unzipped_file',new_name,function(err) {
                        // ignore error from add_item_to_metafile
                        //if (err && env == 'development') console.error('[millstone] ' + err.message);
                        if (err) throw err;
                        callback(null, new_name);
                    });
                }
            });
        }
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
    var ttl = l.Datasource.ttl;

    if (!url.parse(file).protocol) return;

    var filepath = path.join(cache, cachepath(file));
    fs.stat(filepath, function(err, stats) {
        if (err && err.code != 'ENOENT') return console.warn(err);

        var msttl = parseInt(ttl,10) * 1000;
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
    if (typeof options.benchmark === "undefined") options.benchmark = false;
    // respect global no-symlinking preference on windows
    if (never_link) options.nosymlink = true;

    var mml = options.mml,
        base = path.resolve(options.base),
        cache = path.resolve(options.cache),
        resolved = JSON.parse(JSON.stringify(mml)),
        nosymlink = options.nosymlink,
        benchmark = options.benchmark;

    Step(function setup() {
        if (nosymlink) mkdirp(base, 0755, this);
        else mkdirp(path.join(base, 'layers'), 0755, this);
    }, function style_externals(err) {
        if (err && err.code !== 'EEXIST') throw err;
        if (benchmark) console.time("[millstone][benchmark] Resolving style (mss) externals");
        var remaining = mml.Stylesheet.length;
        var error = null;
        var next = function(err) {
            remaining--;
            if (err && err.code !== 'EEXIST') error = err;
            if (remaining <= 0) this(error);
        }.bind(this);

        if (!remaining) return this();

        // Handle URIs within the Carto CSS
        function localizeCartoURIs(s,cb) {
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
                            cb(err);
                        } else {
                            var extname = path.extname(file);
                            if (!extname) {
                                readExtension(file, function(error, ext) {
                                    // note - we ignore any readExtension errors
                                    if (ext) {
                                        var new_filename = file + ext;
                                        fs.rename(file, new_filename, function(err) {
                                            s.data = s.data.split(u).join(new_filename);
                                            cb(err);
                                        });
                                    } else {
                                        s.data = s.data.split(u).join(file);
                                        cb(err);
                                    }
                                });
                            } else {
                                s.data = s.data.split(u).join(file);
                                cb(err);
                            }
                        }
                    });
                } else {
                    cb();
                }
            });
            cb();
        }

        resolved.Stylesheet.forEach(function(s, index) {
            if (typeof s !== 'string') {
                if (env == 'development') console.error("[millstone] processing style '" + s.id + "'");
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
    }, function layer_externals(err) {
        if (err) throw err;
        if (benchmark) {
            console.timeEnd("[millstone][benchmark] Resolving style (mss) externals");
            console.time("[millstone][benchmark] Resolving layer (mml) externals");
        }
        var remaining = mml.Layer.length;
        var error = null;
        var next = function(err) {
            remaining--;
            if (err && err.code !== 'EEXIST') error = err;
            if (remaining <= 0) this(error);
        }.bind(this);
        if (!remaining) return this();
        resolved.Layer.forEach(function(l, index) {
            if (!l.Datasource || !l.Datasource.file) return next();
            if (env == 'development') console.error("[millstone] processing layer '" + l.name + "'");

            // TODO find  better home for this check.
            if (l.Datasource.ttl) checkTTL(cache, l);

            var name = l.name || 'layer-' + index;
            var uri = url.parse(encodeURI(l.Datasource.file));
            var pathname = decodeURI(uri.pathname);
            var extname = path.extname(pathname);
            // unbreak pathname on windows if absolute path is used
            // to an alternative drive like e:/
            // https://github.com/mapbox/millstone/issues/81
            if (process.platform === 'win32') {
                if (uri.protocol && l.Datasource.file.slice(0,2).match(/^[a-zA-Z]:/)) {
                    pathname = l.Datasource.file;
                }
            }
            // This function takes (egregious) advantage of scope;
            // l, extname, and more is all up-one-level.
            //
            // `file`: filename to be symlinked in place to l.Datasource.file
            var processFile = function(file, cb) {
                if (!file) return cb();

                readExtension(file, function(err, ext) {
                    // ignore errors from extension check
                    //if (err) console.error(err);

                    ext = ext || extname;

                    switch (ext.toLowerCase()) {
                    // Unzip and symlink to directory.
                    case '.zip':
                        if (nosymlink) {
                            unzip(file, function(err, file) {
                                if (err) return cb(err);
                                l.Datasource.file = file;
                                return cb();
                            });
                        } else {
                            unzip(file, function(err, file_found) {
                                if (err) return cb(err);
                                l.Datasource.file = path.join(base,
                                                      'layers',
                                                      name,
                                                      path.basename(file_found));
                                return utils.processFiles(file_found,
                                                        l.Datasource.file,
                                                        file_linking_method,
                                                        {cache:cache}, cb);
                            });
                        }
                        break;
                    case '.shp':
                        if (nosymlink) {
                            l.Datasource.file = file;
                            return cb();
                        } else {
                            l.Datasource.file =
                                path.join(base, 'layers', name, path.basename(file));
                            return utils.processFiles(file, l.Datasource.file, file_linking_method, {cache:cache}, cb);
                        }
                        break;
                    default:
                        if (nosymlink) {
                            l.Datasource.file = file;
                            return cb();
                        } else {
                            l.Datasource.file =
                                path.join(base, 'layers', name + ext);
                            return file_linking_method(file, l.Datasource.file, {cache:cache}, cb);
                        }
                        break;
                    }
                });
            };

            // URL.
            if (uri.protocol && (uri.protocol == 'http:' || uri.protocol == 'https:')) {
                var filepath = path.join(cache, cachepath(l.Datasource.file));
                localize(uri.href, {filepath:filepath,name:l.name}, function(err, file) {
                    if (err) return next(err);
                    processFile(file, next);
                });
            // Absolute path.
            } else if (pathname && !isRelative(pathname)) {
                existsAsync(pathname, function(exists) {
                    if (!exists && nosymlink) {
                        // throw here before we try to symlink to avoid confusing error message
                        // we only throw here on nosymlink because a tarred/symlink resolved project
                        // may have locally resolved files that exist, see:
                        // https://github.com/mapbox/tilemill/issues/697#issuecomment-6813928
                        return next(new Error("File not found at absolute path: '" + pathname + "'"));
                    } else {
                        processFile(pathname, next);
                    }
                });
            // Local path.
            } else {
                var local_pathname = path.resolve(path.join(base, pathname));
                // NOTE : we do not call processFile here to avoid munging the name
                if (path.extname(local_pathname) === '.zip') {
                    unzip(local_pathname, function(err, file) {
                        if (err) return next(err);
                        l.Datasource.file = file;
                        return next();
                    });
                } else {
                    l.Datasource.file = local_pathname;
                    return next();
                }
            }
        });
    }, function processSql(err) {
        if (err) throw err;
        if (benchmark) console.timeEnd("[millstone][benchmark] Resolving layer (mml) externals");
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
                        var db_index = i;

                        var symlink_db = function(filepath, cb) {
                            var filename = path.join(base, 'layers', name + extname);
                            dbs[db_index] =  alias + '@' + filename;
                            file_linking_method(filepath, filename, {cache:cache}, cb);
                        };

                        // URL.
                        if (file.protocol) {
                            var filepath = path.join(cache, cachepath(file.href));
                            localize(file.href, {filepath:filepath,name:name}, function(err) {
                                if (err) return next(err);
                                if (nosymlink) {
                                    dbs[db_index] = alias + '@' + filepath;
                                    next();
                                } else {
                                    symlink_db(filepath, next);
                                }
                            });
                        }
                        // Absolute path.
                        else if (pathname && !isRelative(pathname)) {
                            if (nosymlink) {
                                dbs[db_index] = alias + '@' + pathname;
                                next();
                            } else {
                                symlink_db(pathname, next);
                            }
                        }
                        // Local path.
                        else {
                            dbs[db_index] =  alias + '@' + path.join(base, pathname);
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
        if (benchmark) console.time("[millstone][benchmark] detecting layer type and srs");
        var group = this.group();
        resolved.Layer.forEach(function(l, index) {
            var d = l.Datasource;
            var next = group();
            if (!d.file) return next();
            existsAsync(d.file, function(exists) {
                if (!exists) {
                    // https://github.com/mapbox/tilemill/issues/1808
                    // on OS X broken symlinks can be read and resolved but actually
                    // do not "exist" so here we try to resolve in order to avoid
                    // providing a confusing error that says a file does not exist
                    // when it actually does (and is just a broken link)
                    fs.readlink(d.file,function(err,resolvedPath){
                        if (resolvedPath) {
                            return next(new Error("File not found: '" +
                              resolvedPath + "' (broken symlink: '" +
                              d.file + "')"));
                        } else {
                            return next(new Error("File not found: '" + d.file + "'"));
                        }
                    });
                } else {
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
                            fs.lstat(l.Datasource.file, function(err, stats) {
                                if (err && err.code != 'ENOENT') {
                                    next(err);
                                } else {
                                    if (!stats.isSymbolicLink()) {
                                        readExtension(l.Datasource.file, next);
                                    } else {
                                        fs.readlink(l.Datasource.file, function(err, resolvedPath) {
                                            if (resolvedPath && isRelative(resolvedPath)) {
                                                resolvedPath = path.join(path.dirname(l.Datasource.file), resolvedPath);
                                            }
                                            readExtension(resolvedPath, next);
                                        });
                                    }
                                }
                            });
                        }
                    }, function(err, ext) {
                        // Ignore errors during extension checks above and let a
                        // missing extension fall through to a missing `type`.
                        var name = l.name || 'layer-' + index;
                        ext = ext || path.extname(d.file);
                        d.type = d.type || valid_ds_extensions[ext.toLowerCase()];
                        switch (ext.toLowerCase()) {
                        case '.vrt':
                            // we default to assuming gdal raster for vrt's
                            // but we need to support OGRVRTLayer as well
                            try {
                                var vrt_file = fs.readFileSync(d.file, 'utf8').toString();
                                if (vrt_file.indexOf('OGRVRTLayer') != -1) {
                                    d.type = 'ogr';
                                    if (!l.srs) {
                                        var match = vrt_file.match(/<LayerSRS>(.+)<\/LayerSRS>/);
                                        if (match && match[1]) {
                                           var srs_parsed = srs.parse(match[1]);
                                           l.srs = srs_parsed.proj4;
                                        }
                                    }
                                }
                            } catch (e) {
                                if (env == 'development') console.error('failed to open vrt file: ' + e.message);
                            }
                            break;
                        case '.csv':
                        case '.tsv':
                        case '.txt':
                        case '.osm':
                        case '.gpx':
                            l.srs = l.srs || SRS.WGS84;
                            break;
                        case '.geojson':
                        case '.topojson':
                        case '.json':
                            try {
                                var json_obj = JSON.parse(fs.readFileSync(d.file));
                                l.srs = l.srs || srs.parse(srs.jsonCrs(json_obj)).proj4;
                            } catch (e) {
                                next(new Error("Could not parse: '" + d.file + "': error: '" + e.message + "'"));
                            }
                            break;
                        case '.kml':
                        case '.rss':
                            l.srs = SRS.WGS84;
                            break;
                        }
                        if (d.type === 'ogr' && !d.layer) {
                            d.layer_by_index = 0;
                        }
                        // at this point if we do not know the 'type' of mapnik
                        // plugin to dispatch to we are out of luck and there is no
                        // need to check for the projection
                        if (!d.type) {
                            return next(new Error("Could not detect datasource type for: '"+d.file+"'"))
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
                }
            });
        });
    }, function end(err) {
        if (benchmark) console.timeEnd("[millstone][benchmark] detecting layer type and srs");
        // Fix map & layer SRS values.
        resolved.srs = resolved.srs || SRS['900913'];
        fixSRS(resolved);
        resolved.Layer.forEach(fixSRS);
        if (!err && env == 'development') console.error("[millstone] finished processing '" + options.base + "'");
        if (Object.keys(downloads).length < 1) {
            clearInterval(download_log_interval);
            download_log_interval = null;
        }
        return callback(err, resolved);
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
        existsAsync(filepath, function(exists) {
            if (!exists) return this();
            utils.rm(filepath, this);
        }.bind(this));
    }, function removeMetafile(err) {
        if (err) throw err;
        existsAsync(metapath(filepath), function(exists) {
            if (!exists) return this();
            utils.rm(metapath(filepath), this);
        }.bind(this));
    }, function finish(err) {
        callback(err);
    });
}

function drainPool(callback) {
    if (download_log_interval) clearInterval(download_log_interval);
    if (pool) {
        pool.drain(function(err) {
            if (err) return callback(err);
            pool.destroyAllNow(function(err) {
               if (err) return callback(err);
               return callback();
            });
        });
    }
}

module.exports = {
    resolve: resolve,
    flush: flush,
    isRelative: isRelative,
    guessExtension: guessExtension,
    downloads: downloads,
    valid_ds_extensions: valid_ds_extensions,
    valid_marker_extensions: valid_marker_extensions,
    drainPool:drainPool
};

