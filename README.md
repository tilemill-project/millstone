# millstone

As of [carto 0.2.0](https://github.com/mapbox/carto), the Carto module expects
all datasources and resources to be localized - remote references like
URLs and providers are not downloaded when maps are rendered.

Millstone now contains this logic - it provides two functions,
`resolve` and `flush`. Resolve takes an MML file and returns a localized
version, and `flush` can be used to clear the cache of a specific resource.

## Usage

The main usage of millstone is through the `millstone.resolve()` function:

```javascript
millstone.resolve({
    mml: // Carto MML file
    base: // Base path to find local resources
    cache: // Where to store the cache of resources
}, callback);
```

## Authors

* Will White
* Dmitri Gaskin
* Young Hahn
* Konstantin Kaefer
* Tom MacWright
