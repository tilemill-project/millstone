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

var cache = '/tmp/millstone-test';

beforeEach(function(){
    rm(path.join(__dirname, '/tmp/millstone-test'));

    try {
        fs.mkdirSync(options.cache, 0777);
    } catch (e) {}
});


it('correctly handles images with no query string', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'image-querystring/project-no-querystring.mml')));

    var options = {
        mml: mml,
        base: path.join(__dirname, 'image-querystring'),
        cache: cache
    };

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.equal(resolved.Stylesheet[0].id, 'style-no-querystring.mss');
        assert.equal(resolved.Stylesheet[0].data, "Map {background-image: url('/tmp/millstone-test/7b53c4b2-yvRISk8.png');}");
        assert.ok(existsSync('/tmp/millstone-test/7b53c4b2-yvRISk8.png'));
        done();
    });
});

it('correctly handles images with query string', function(done) {
    var mml = JSON.parse(fs.readFileSync(path.join(__dirname, 'image-querystring/project-querystring.mml')));

    var options = {
        mml: mml,
        base: path.join(__dirname, 'image-querystring'),
        cache: cache
    };

    millstone.resolve(options, function(err, resolved) {
        assert.equal(err,undefined,err);
        assert.equal(resolved.Stylesheet[0].id, 'style-querystring.mss');
        assert.equal(resolved.Stylesheet[0].data, "Map {background-image: url('/tmp/millstone-test/d855a872-yvRISk8.png');}");
        assert.ok(existsSync('/tmp/millstone-test/d855a872-yvRISk8.png'));
        done();
    });
});
