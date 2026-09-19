# Imboassica chart data

`imboassica.json` is a simplified extract of OpenStreetMap data, © OpenStreetMap contributors, available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

Source: <https://api.openstreetmap.org/api/0.6/map?bbox=-41.853,-22.428,-41.805,-22.395> (retrieved 2026-09-19). The lagoon is OSM way [132616186](https://www.openstreetmap.org/way/132616186). Attribution is shown in the map UI. This derived dataset is also distributed under ODbL 1.0.

The import retains water, coastline, vegetation, parks and selected road classes; coordinates remain longitude/latitude, WGS84. Douglas–Peucker simplification uses 0.000025° tolerance. Styling, water colour and bank strokes are illustrative. Shorelines can change and the chart is not a navigation or official course survey.

To regenerate from an OSM XML extract, run:

```sh
python3 scripts/import-geography.py /path/to/extract.osm
```

No geographic API is queried at runtime in the default illustrated view.
