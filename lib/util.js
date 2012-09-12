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
    src = path.relative(options.cache, dest).slice(0, 2) !== '..' ? path.relative(path.dirname(dest), src) : src;
    fs.lstat(dest, function(err, stat) {
        // Error.
        if (err && err.code !== 'ENOENT')
            return callback(err);

        // Path does not exist. Symlink.
        if (err && err.code === 'ENOENT') {
            if (env == 'development') console.log("[millstone] linking '" + dest + "' -> '"  + src + "'");
            return fs.symlink(src, dest, callback);
        }

        // Path exists and is not a symlink. Do nothing.
        if (!stat.isSymbolicLink()) return callback();

        // Path exists and is a symlink. Check existing link path and update
        // if necessary.
        fs.readlink(dest, function(err, old) {
            if (err) return callback(err);
            if (old === src) return callback();
            fs.unlink(dest, function(err) {
                if (err) return callback(err);
                if (env == 'development') console.log("[millstone] re-linking '" + dest + "' -> '"  + src + "'");
                fs.symlink(src, dest, callback);
            });
        });
    });
}

function copy(src, dest, options, callback) {
    if (!options) throw new Error('options not defined!');
    if (!callback) throw new Error('callback not defined!');
    fs.lstat(dest, function(err, dest_stat) {
        // Error.
        if (err && err.code !== 'ENOENT'){
            return callback(err);
        }

        // Path does not exist. Copy.
        if (err && err.code === 'ENOENT') {
            return fs.readFile(src, function(err, data) {
                if (err) {
                    return callback(err);
                }
                if (env == 'development') console.log("[millstone] copying '" + src + "' to '"  + dest + "'");
                fs.writeFile(dest, data, callback)
            });
        }

        // Path exists and is a symlink. Do nothing.
        if (dest_stat.isSymbolicLink()) {
            return callback();
        }

        // Path exists and is a file. Check if it needs updating
        fs.lstat(src, function(err,src_stat) {
            // Error.
            if (err) {
                return callback(err);
            }
            if (src_stat.mtime > dest_stat.mtime) {
                return fs.readFile(src, function(err, data) {
                    if (err) {
                        return callback(err);
                    }
                    if (env == 'development') console.log("[millstone] re-copying '" + src + "' to '"  + dest + "'");
                    fs.writeFile(dest, data, callback)
                });
            } else {
                return callback();
            }
        });
    });
}


function processSHP(src, dest, fn, options, callback) {
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
                return callback(err)
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
    processSHP: processSHP
};
