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

it('correctly handles invalid json', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'invalid-json/project.mml')));

    var options = {
        mml: mml,
        base: path.join(__dirname, 'invalid-json'),
        cache: '/tmp/millstone-test'
    };

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err.message,"Could not parse: '/Users/dane/projects/tilemill/node_modules/millstone/test/invalid-json/broken.json': error: 'Unexpected token ]'");
        done();
    });
});
