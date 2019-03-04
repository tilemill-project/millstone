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
	assert.ok(err.message.search("error: 'Unexpected token ]") != -1);
        done();
    });
});

it('correctly handles missing shapefile at relative path', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'missing-file-relative/project.mml')));

    var options = {
        mml: mml,
        base: path.join(__dirname, 'missing-file-relative'),
        cache: '/tmp/millstone-test'
    };

    millstone.resolve(options, function(err, resolved) {
        var err_expected = err.message.search("File not found:") != -1 || err.message.search("Can't open") != -1;
        assert.ok(err_expected);
        done();
    });
});


it('correctly handles missing shapefile at absolute path', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'missing-file-absolute/project.mml')));

    var options = {
        mml: mml,
        base: path.join(__dirname, 'missing-file-absolute'),
        cache: '/tmp/millstone-test'
    };

    millstone.resolve(options, function(err, resolved) {
        var err_expected = err.message.search("File not found:") != -1 || err.message.search("Can't open") != -1;
        assert.ok(err_expected);
        done();
    });
});