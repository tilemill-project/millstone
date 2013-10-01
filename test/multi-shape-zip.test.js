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

// https://github.com/mapbox/millstone/issues/99
it('correctly handles a zipfile containing multiple shapefiles without corrupting data', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'multi-shape-zip/project.mml')));
    
    var cache = '/tmp/millstone-test';
    var options = {
        mml: mml,
        base: path.join(__dirname, 'multi-shape-zip'),
        cache: cache
    };

    try {
        fs.mkdirSync(options.cache, 0777);
    } catch (e) {}
    
    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        var expected = [
            {
                "name": "multi-shape-zip",
                "Datasource": {
                    "file": path.join(__dirname, 'multi-shape-zip/layers/multi-shape-zip/134ecf39-PLATES_PlateBoundary_ArcGIS.shp'),
                    "type": "shape"
                },
                "srs": '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs'
            }
        ];
        assert.deepEqual(resolved.Layer, expected);
        done();
    });
});
