# millstone

[![Build Status](https://secure.travis-ci.org/mapbox/millstone.png?branch=master)](http://travis-ci.org/mapbox/millstone)
[![Build status](https://ci.appveyor.com/api/projects/status/jtktmdac2g60h1rj)](https://ci.appveyor.com/project/Mapbox/millstone)
[![Dependencies](https://david-dm.org/mapbox/millstone.png)](https://david-dm.org/mapbox/millstone)

As of [carto 0.2.0](https://github.com/mapbox/carto), the Carto module expects
all datasources and resources to be localized - remote references like
URLs and providers are not downloaded when maps are rendered.

Millstone now contains this logic - it provides two functions,
`resolve` and `flush`. Resolve takes an MML file and returns a localized
version, and `flush` can be used to clear the cache of a specific resource.

## Authors

* Will White
* Dmitri Gaskin
* Young Hahn
* Konstantin Kaefer
* Tom MacWright
