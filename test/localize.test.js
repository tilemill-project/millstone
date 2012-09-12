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
  rm(path.join(__dirname, 'tmp'));
})

it('correctly localizes remote image/svg files', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'markers/project.mml')));
    rm(path.join(__dirname, 'tmp'));

    var options = {
        mml: mml,
        base: path.join(__dirname, 'markers'),
        cache: path.join(__dirname, 'tmp')
    };

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined);
        assert.equal(resolved.Stylesheet[0].id, 'style.mss');
        assert.equal(resolved.Stylesheet[0].data.slice(0,27), "#points { marker-file: url(");
        assert.notEqual(resolved.Stylesheet[0].data.slice(27,31), 'http'); // should be a local, absolute path
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
