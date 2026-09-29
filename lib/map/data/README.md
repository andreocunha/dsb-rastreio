# Imboassica chart data

`imboassica.json` is a simplified extract of OpenStreetMap data, © OpenStreetMap contributors, available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

Source: <https://api.openstreetmap.org/api/0.6/map?bbox=-41.853,-22.428,-41.805,-22.395> (retrieved 2026-09-19). The lagoon is OSM way [132616186](https://www.openstreetmap.org/way/132616186). Attribution is shown in the map UI. This derived dataset is also distributed under ODbL 1.0.

The import retains water, coastline, vegetation, parks and selected road classes; coordinates remain longitude/latitude, WGS84. Douglas–Peucker simplification uses 0.000025° tolerance. Styling, water colour and bank strokes are illustrative. Shorelines can change and the chart is not a navigation or official course survey.

To regenerate from an OSM XML extract, run:

```sh
python3 scripts/import-geography.py /path/to/extract.osm
```

No geographic API is queried at runtime in the default illustrated view.

## Local de teste · Vitória

`vitoria-test.json`: centro informado pelo organizador **-20.265221, -40.260797**.
Extrato obtido em 2026-09-26 de
<https://api.openstreetmap.org/api/0.6/map?bbox=-40.273,-20.276,-40.249,-20.254>.
Mesma licença ODbL e atribuição do mapa de Imboassica. Geometria simplificada,
sem tiles nem chamadas a OSM durante a visualização. O marcador representa o ponto
informado; nenhum circuito de competição foi inventado para esse local.

```sh
python3 scripts/import-geography.py /path/to/vitoria.osm lib/map/data/vitoria-test.json
```

O seletor “Local” e o parâmetro `?venue=vitoria-test` abrem esse mapa.
Áreas e percursos editados nele são salvos separadamente do evento de Imboassica.
Para adicionar futuras edições, registre o local em `venues.ts`, importe sua
geometria e acrescente o renderizador; não é necessário alterar os trackers.

## Margens da água (`*-water.json`)

`imboassica-water.json` e `vitoria-water.json` contêm a margem da lagoa e do mar
traçada automaticamente das imagens Esri World Imagery (z17, 2026-09-27): a água é
segmentada por cor e textura a partir de pontos-semente, vetorizada e simplificada
(~1,7 m). O contorno do OpenStreetMap da lagoa estava deslocado em relação à foto
(p. ex. no canal e na vegetação da margem sul), por isso 2D, 3D e simulação usam
este traçado. As bordas externas do mar são prolongadas além do recorte.
Os arquivos contêm apenas coordenadas vetoriais, sem pixels das imagens.

```sh
pip install numpy scipy pillow scikit-image
python3 scripts/extract-water.py imboassica
python3 scripts/extract-water.py vitoria
```

Confira o resultado sobre o satélite antes de publicar: margens com juncos ou
aguapés podem mudar entre imagens.
