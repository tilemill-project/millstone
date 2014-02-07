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
  rm('/tmp/millstone-test');
});


it('correctly handles files without symlinking', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'nosymlink/project.mml')));
    
    var cache = '/tmp/millstone-test';
    mml.Layer[4].Datasource.file = path.join(cache, "pshape.zip");

    var options = {
        mml: mml,
        base: path.join(__dirname, 'nosymlink'),
        cache: cache,
        nosymlink:true
    };

    try {
        fs.mkdirSync(options.cache, 0777);
    } catch (e) {}

    try {
        var newFile = fs.createWriteStream(path.join(options.cache, 'pshape.zip'));
        var oldFile = fs.createReadStream(path.join(__dirname, 'nosymlink/pshape.zip'));
        oldFile.pipe(newFile);
    } catch (e) {console.log(e)}

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.equal(resolved.Stylesheet[0].id, 'style.mss');
        var expected = [
            {
                "name": "one",
                "Datasource": {
                    "file": path.join(__dirname, 'nosymlink/points.csv'),
                    "type": "csv"
                },
                "srs": "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
            },
            {
                "name": "two",
                "Datasource": {
                    "file": path.join(__dirname, "nosymlink/pshape.shp"),
                    "type": "shape"
                },
                "srs": "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
            },
            {
                "name": "three",
                "Datasource": {
                    "file": path.join(__dirname, "nosymlink/pshape.shp"),
                    "type": "shape"
                },
                "srs": "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
            },
            {
                "name": "four",
                "Datasource": {
                    "file": path.join(__dirname, "nosymlink/points.vrt"),
                    "type": "ogr",
                    "layer":"points"
                },
                "srs": "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
            },
            {
                "name": "five",
                "Datasource": {
                    "file": path.join(options.cache, "pshape.shp"),
                    "type": "shape"
                },
                "srs": "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
            }
        ];
        for (var i=0;i<=expected.length;i++) {
          assert.deepEqual(resolved.Layer[i], expected[i]);
        }
        done();
    });
});

after(function() {
  // cleanup
  rm(path.join(__dirname, 'nosymlink','pshape.shp'));
  rm(path.join(__dirname, 'nosymlink','pshape.dbf'));
  rm(path.join(__dirname, 'nosymlink','pshape.prj'));
  rm(path.join(__dirname, 'nosymlink','pshape.shx'));
  rm(path.join(__dirname, 'nosymlink','.pshape.zip'));
})
