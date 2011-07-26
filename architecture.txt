tilemill:
  - uses millstone to localize datasources upon adding a layer
  - uses carto to compile the stylesheets with the localized datasources
  - uses tilelive/tilelive-mapnik to render maps and grids


millstone:
  - takes MML/JSON file and localizes all datasource references
  - resulting MML/JSON files with local path references is returned


carto:
  - takes MML/JSON file with embedded or referenced carto .mss files
  - compiles carto stylesheet to XML <Stylesheet> objects
  - outputs Mapnik/XML file


tilelive-mapnik:
  - takes Mapnik/XML file and passes it directly to Map constructor:
  - reads MML/JSON file with the same basename in the same directory to
    determine settings. if it doesn't exist, there'll be no interactivity
    and the center is estimated from the bounds.
