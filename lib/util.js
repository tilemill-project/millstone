var fs = require('fs'),
    path = require('path'),
    _ = require('underscore'),
    Step = require('step');

var env = process.env.NODE_ENV || 'development';

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
}

// Like fs.symlink except that it will overwrite stale symlinks at the
// given path if it exists.
function forcelink(src, dest, options, callback) {
    if (!options || !options.cache) throw new Error('options.cache not defined!');
    if (!callback) throw new Error('callback not defined!');
    // uses relative path if linking to cache dir
    if (path.relative) {
        src = path.relative(options.cache, dest).slice(0, 2) !== '..' ? path.relative(path.dirname(dest), src) : src;
    }
    fs.lstat(dest, function(err, stat) {
        // Error.
        if (err && err.code !== 'ENOENT') {
            return callback(err);
        }

        // Path does not exist. Symlink.
        if (err && err.code === 'ENOENT') {
            if (env == 'development') console.error("[millstone] linking '" + dest + "' -> '"  + src + "'");
            return fs.symlink(src, dest, callback);
        }

        // Path exists and is not a symlink. Do nothing.
        if (!stat.isSymbolicLink()) {
            if (env == 'development') console.error("[millstone] skipping re-linking '" + src + "' because '"  + dest + " is already an existing file");
            return callback();
        }

        // Path exists and is a symlink. Check existing link path and update if necessary.
        // NOTE : broken symlinks will pass through this step
        fs.readlink(dest, function(err, old) {
            if (err) return callback(err);
            if (old === src) return callback();
            fs.unlink(dest, function(err) {
                if (err) return callback(err);
                if (env == 'development') console.error("[millstone] re-linking '" + dest + "' -> '"  + src + "'");
                fs.symlink(src, dest, callback);
            });
        });
    });
}

function copyStream(src,dest,callback) {
    var src_stream = fs.createReadStream(src);
    src_stream.on('error', function(err) {
        return callback(err);
    });
    var dest_stream = fs.createWriteStream(dest);
    dest_stream.on('error', function(err) {
        return callback(err);
    });
    src_stream.on('end', function() {
        if (env == 'development') console.error("[millstone] finished copying '" + src + "' to '"  + dest + "'");
        return callback(null);
    });
    src_stream.pipe(dest_stream);
}

function copy(src, dest, options, callback) {
    if (!options) throw new Error('options not defined!');
    if (!callback) throw new Error('callback not defined!');
    fs.lstat(dest, function(err, dest_stat) {
        // Error.
        if (err && err.code !== 'ENOENT'){
            return callback(err);
        }

        // Dest path does not exist. Copy.
        if (err && err.code === 'ENOENT') {
            if (env == 'development') console.error("[millstone] attempting to copy '" + src + "' to '"  + dest + "'");
            return copyStream(src,dest,callback);
        }

        // Path exists and is a symlink. Do nothing.
        if (dest_stat.isSymbolicLink()) {
            if (env == 'development') console.error("[millstone] skipping copying '" + src + "' because '"  + dest + " is an existing symlink");
            return callback();
        }

        // Dest path exists and is a file. Check if it needs updating
        fs.lstat(src, function(err,src_stat) {
            // Error.
            if (err) {
                return callback(err);
            }
            // NOTE: we intentially do not compare the STAT exactly
            // because some windows users will be used to editing files
            // after they are copied. In future releases we should consider
            // simply doing if (src_stat != dest_stat)
            // check size to dodge potentially corrupt data
            // https://github.com/mapbox/tilemill/issues/1674
            if ((src_stat.size != dest_stat.size && src_stat.mtime < dest_stat.mtime) || src_stat.mtime > dest_stat.mtime) {
                if (env == 'development') console.error("[millstone] attempting to re-copy '" + src + "' to '"  + dest + "'");
                return copyStream(src,dest,callback);
            } else {
                return callback();
            }
        });
    });
}


function processFiles(src, dest, fn, options, callback) {
    if (!options) throw new Error('options not defined!');
    if (!fn) throw new Error('link function not defined!');
    if (!callback) throw new Error('callback not defined!');
    var basename = path.basename(src, path.extname(src)),
        srcdir = path.dirname(src),
        destdir = path.dirname(dest);

    // Group multiple calls
    var remaining,
        err;
    function done(err) {
        remaining --;
        if (!remaining) callback(err);
    }

    function forcemkdir(dir, callback) {
        fs.lstat(dir, function(err, stat) {
            if (err && err.code !== 'ENOENT') {
                return callback(err);
            } else if (!err && stat.isSymbolicLink()) {
                return fs.unlink(dir, function(err) {
                    if (err) return callback(err);
                    fs.mkdir(dir, 0755, callback);
                });

            } else {
                return fs.mkdir(dir, 0755, callback);
            }
        });
    }

    function processFiltered(err, files) {
        if (err) return callback(err);

        files = files.filter(function(f) {
            return path.basename(f, path.extname(f)) === basename;
        });
        if (files.length < 1) return callback(err);

        remaining = files.length;

        files.forEach(function(f) {
            fn(path.join(srcdir, f), path.join(destdir, f), options, done);
        });
    }

    forcemkdir(destdir, function() {
        fs.readdir(srcdir, processFiltered);
    });
}

module.exports = {
    forcelink: forcelink,
    rm: rm,
    copy: copy,
    processFiles: processFiles
};
