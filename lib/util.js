var fs = require('fs'),
    path = require('path'),
    _ = require('underscore'),
    Step = require('step'),
    mkdirP = require('mkdirp');

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
function forcelink(linkdata, path, callback) {
    fs.lstat(path, function(err, stat) {
        // Error.
        if (err && err.code !== 'ENOENT')
            return callback(err);

        // Path does not exist. Symlink.
        if (err && err.code === 'ENOENT')
            return fs.symlink(linkdata, path, callback);

        // Path exists and is not a symlink. Do nothing.
        if (!stat.isSymbolicLink()) return callback();

        // Path exists and is a symlink. Check existing link path and update
        // if necessary.
        fs.readlink(path, function(err, old) {
            if (err) return callback(err);
            if (old === linkdata) return callback();
            fs.unlink(path, function(err) {
                if (err) return callback(err);
                fs.symlink(linkdata, path, callback);
            });
        });
    });
}

module.exports = {
    mkdirP: mkdirP,
    forcelink: forcelink,
    rm: rm
};
