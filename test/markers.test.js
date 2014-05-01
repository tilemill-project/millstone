var fs = require('fs');
var path = require('path');
var assert = require('assert');

// switch to 'development' for more verbose logging
process.env.NODE_ENV = 'production'
var millstone = require('../');
var tests = module.exports = {};
var rm = require('./support.js').rm;

var existsSync = require('fs').existsSync || require('path').existsSync;

before(function(){
  rm('/tmp/millstone-test');
});


it('correctly localizes remote image/svg files', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'markers/project.mml')));

    var options = {
        mml: mml,
        base: path.join(__dirname, 'markers'),
        cache: '/tmp/millstone-test'
    };

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.equal(resolved.Stylesheet[0].id, 'style.mss');
        assert.equal(resolved.Stylesheet[0].data, '// a url like https:example.com in the comments\n#points { one/marker-file: url(\'/tmp/millstone-test/e33af80e-Cup_of_coffee.svg\'); two/marker-file: url(\'/tmp/millstone-test/e33af80e-Cup_of_coffee.svg\'); four/marker-file: url("/tmp/millstone-test/c953e0d1-pin-m-fast-food+AA0000.png"); five/marker-file:url("/tmp/millstone-test/7b9b9979-fff&text=x/7b9b9979-fff&text=x.png"); }\n');
        assert.deepEqual(resolved.Layer, [
            {
                "name": "points",
                "Datasource": {
                    "file": path.join(__dirname, 'markers/layers/points.csv'),
                    "type": "csv"
                },
                "srs": "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs"
            }
        ]);
        done();
    });
});

it('correctly localizes zipped json', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'zipped-json/project.mml')));

    var options = {
        mml: mml,
        base: path.join(__dirname, 'zipped-json'),
        cache: '/tmp/millstone-test'
    };

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.equal(resolved.Stylesheet[0].id, 'style.mss');
        assert.equal(resolved.Stylesheet[0].data, '#polygon { }');
        var expected = [
            {
                "name": "polygons-zipped",
                "Datasource": {
                    "file": path.join(__dirname, 'zipped-json/layers/polygons-zipped/7e482cc8-polygons.json.json'),
                    "type": "ogr",
                    "layer_by_index":0
                },
                "srs": '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs'
            }
        ];
        assert.deepEqual(resolved.Layer, expected);
        done();
    });
});
