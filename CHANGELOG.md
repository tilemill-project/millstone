## CHANGELOG

#### 0.5.5

* Added a verbose mode that can be trigged by setting NODE_ENV = 'development'

* Switched to request (dropped node-get) for better proxy support

* Support for making relative the paths stored to the download cache

* Support for zipfiles with no extension

* Advertise node v8 support

#### 0.5.4

* Fixes to better support localization of carto resources

#### 0.5.3

* Updated node-get min version in order to fully support proxy auth
* Improved cross-platform relative path detection

#### 0.5.2

* Improved regex used to detect content-disposition

* Support for localizing uri's in stylesheet

#### 0.5.1

* Moved to mocha for tests

* Made `nosymlink` option optional

#### 0.5.0

* Add `nosymlink` option for not downloading files
