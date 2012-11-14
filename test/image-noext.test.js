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

it('correctly handles images with no extension', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'image-noext/project.mml')));
    
    var cache = '/tmp/millstone-test';
    var options = {
        mml: mml,
        base: path.join(__dirname, 'image-noext'),
        cache: cache
    };

    try {
        fs.mkdirSync(options.cache, 0777);
    } catch (e) {}

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.equal(resolved.Stylesheet[0].id, 'style.mss');
        assert.equal(resolved.Stylesheet[0].data, "Map {background-image: url('/tmp/millstone-test/2b2cf79a-images/2b2cf79a-images.jpeg');}");
        assert.ok(existsSync('/tmp/millstone-test/2b2cf79a-images/2b2cf79a-images.jpeg'));
        done();
    });
});
