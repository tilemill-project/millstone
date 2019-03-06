#!/bin/sh

print_usage () {
  echo "Usage:"
  echo "    $0        Clean up prior test, build, and test."
  echo "    $0 -c     Clean up prior test only."
}

if [ "$1" != "" ] && [ "$1" != "-c" ]; then
  print_usage; exit 1
fi

clean () {
rm test/cache/layers/absolute-json.json
rm test/cache/layers/csv.csv
rm test/cache/layers/polygons.json
rm test/data/.ne_10m_admin_0_boundary_lines_disputed_areas.zip
rm test/data/ne_10m_admin_0_boundary_lines_disputed_areas.dbf
rm test/data/ne_10m_admin_0_boundary_lines_disputed_areas.html
rm test/data/ne_10m_admin_0_boundary_lines_disputed_areas.prj
rm test/data/ne_10m_admin_0_boundary_lines_disputed_areas.shp
rm test/data/ne_10m_admin_0_boundary_lines_disputed_areas.shx
rm test/data/ne_10m_admin_0_boundary_lines_disputed_areas.txt
rm -rf test/cache/layers/absolute-shp/
rm -rf test/cache/layers/stations/
rm -rf test/cache/layers/zip-no-ext/
rm -rf test/corrupt-zip/layers/
rm -rf test/macosx-zipped/layers/
rm -rf test/multi-shape-zip/layers/
rm -rf test/zipped-json/layers/
}

if [ "$1" == "-c" ]; then
  clean; exit 0
fi

npm install
npm test
clean

exit 0