var fs = require('fs');
var path = require('path');
var assert = require('assert');

// switch to 'development' for more verbose logging
process.env.NODE_ENV = 'production'
var utils = require('../lib/util.js');
var millstone = require('../lib/millstone');
var tests = module.exports = {};
var rm = require('./support.js').rm;

var existsSync = require('fs').existsSync || require('path').existsSync;

beforeEach(function(){
  rm(path.join(__dirname, '/tmp/millstone-test'));
})

it('correctly handles datasources with uppercase extensions', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'UPPERCASE_EXT/project.mml')));
    
    var cache = '/tmp/millstone-test';
    var options = {
        mml: mml,
        base: path.join(__dirname, 'UPPERCASE_EXT'),
        cache: cache
    };

    try {
        fs.mkdirSync(options.cache, 0777);
    } catch (e) {}

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.equal(resolved.Stylesheet[0].id, 'style.mss');
        assert.equal(resolved.Stylesheet[0].data, '#polygon { }');
        var expected = [
            {
                "name": "uppercase-ext",
                "Datasource": {
                    "file": path.join(__dirname, 'UPPERCASE_EXT/test1.CSV'),
                    "type": "csv"
                },
                "srs": '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs'
            }
        ];
        assert.deepEqual(resolved.Layer, expected);
        done();
    });
});
