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


// NOTE: watch out, this zip has both a csv and shape in it and uses
// non-ascii characters - idea being to be the basis for other tests
// https://github.com/mapbox/millstone/issues/85
it('correctly handles re-downloading a zip that is invalid in its cached state', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'corrupt-zip/project.mml')));
    
    var cache = '/tmp/millstone-test';
    var options = {
        mml: mml,
        base: path.join(__dirname, 'corrupt-zip'),
        cache: cache
    };

    try {
        fs.mkdirSync(options.cache, 0777);
    } catch (e) {}
    
    // write bogus data over the zip archive to simulate a corrupt cache
    if (!existsSync('/tmp/millstone-test/29f2b277-Cle%CC%81ment/')) fs.mkdirSync('/tmp/millstone-test/29f2b277-Cle%CC%81ment/')
    fs.writeFileSync('/tmp/millstone-test/29f2b277-Cle%CC%81ment/29f2b277-Cle%CC%81ment.zip','');

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.equal(resolved.Stylesheet[0].id, 'style.mss');
        assert.equal(resolved.Stylesheet[0].data, '#polygon { }');
        var expected = [
            {
                "name": "corrupt-zip",
                "Datasource": {
                    "file": path.join(__dirname, 'corrupt-zip/layers/corrupt-zip/29f2b277-Cle%CC%81ment.shp'),
                    "type": "shape"
                },
                "srs": '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs'
            }
        ];
        assert.deepEqual(resolved.Layer, expected);
        done();
    });
});
