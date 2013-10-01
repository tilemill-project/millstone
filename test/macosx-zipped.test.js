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

before(function(){
  rm('/tmp/millstone-test');
});

it('correctly handles mac os x zipped archives with the lame __MACOSX/ subfolder', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'macosx-zipped/project.mml')));

    var options = {
        mml: mml,
        base: path.join(__dirname, 'macosx-zipped'),
        cache: '/tmp/millstone-test'
    };

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.deepEqual(resolved.Layer, [
            {
                "name": "points",
                "Datasource": {
                    "file": path.join(__dirname, 'macosx-zipped/layers/points/9afe4795-crashes_2007_2009.shp'),
                    "type": "shape"
                },
                "srs": "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
            }
        ]);
        done();
    });
});