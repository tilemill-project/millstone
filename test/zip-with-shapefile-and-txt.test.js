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

// https://github.com/mapbox/millstone/issues/101
it('correctly prefers (for back compatibility) shapefiles over .txt files in zip archive', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'zip-with-shapefile-and-txt/project.mml')));
    
    var cache = '/tmp/millstone-test';
    var options = {
        mml: mml,
        base: path.join(__dirname, 'zip-with-shapefile-and-txt'),
        cache: cache
    };

    try {
        fs.mkdirSync(options.cache, 0777);
    } catch (e) {}
    
    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.deepEqual(resolved.Layer[0].Datasource.type, 'shape');
        done();
    });
});
