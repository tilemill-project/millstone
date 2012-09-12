var fs = require('fs');
var path = require('path');
var existsSync = require('fs').existsSync || require('path').existsSync;

// Recursive, synchronous rm.
exports.rm = rm = function(filepath) {
    if (existsSync(filepath)) {
        var stat;
        var files;
    
        try { stat = fs.lstatSync(filepath); } catch(e) { throw e; }
    
        // File.
        if (stat.isFile() || stat.isSymbolicLink()) {
            return fs.unlinkSync(filepath);
        // Directory.
        } else if (stat.isDirectory()) {
            try { files = fs.readdirSync(filepath); } catch(e) { throw e; }
            files.forEach(function(file) {
                try { rm(path.join(filepath, file)); } catch(e) { throw e; }
            });
            try { fs.rmdirSync(filepath); } catch(e) { throw e; }
        // Other?
        } else {
            throw new Error('Unrecognized file.');
        }
    }
}
