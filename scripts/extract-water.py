#!/usr/bin/env python3
"""Traça a margem da água a partir das imagens de satélite (Esri World Imagery).

Gera lib/map/data/<local>-water.json, usado pelo mapa 2D, pelo 3D e pela simulação.
Requer: pip install numpy scipy pillow scikit-image

  python3 scripts/extract-water.py imboassica
  python3 scripts/extract-water.py vitoria

Etapas: baixa um mosaico z17, segmenta a lagoa por cor + textura (a água é lisa)
a partir de pontos-semente, segmenta o mar incluindo a arrebentação, vetoriza,
simplifica (~1,7 m) e prolonga as bordas externas do mar. Confira o resultado
sobrepondo o contorno ao satélite antes de publicar.
"""
import json, math, os, sys, urllib.request, concurrent.futures as cf
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import color, measure, morphology

URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
Z, DOWN = 17, 2
VENUES = {
    # bbox (oeste, sul, leste, norte); sementes da lagoa [lat, lon, tolerância de cor, textura]; semente do mar
    'imboassica': {'bbox': (-41.863, -22.432, -41.800, -22.395), 'file': 'imboassica-water.json',
                   'lagoon': [[-22.4115, -41.8175, 14, 3.5], [-22.411, -41.830, 14, 3.5], [-22.408, -41.851, 14, 3.5], [-22.4105, -41.840, 14, 3.5]],
                   'sea': [-22.4215, -41.8095], 'sea_is_lagoon_like': False},
    'vitoria': {'bbox': (-40.273, -20.276, -40.249, -20.254), 'file': 'vitoria-water.json',
                'lagoon': [], 'bay': [[-20.2745, -40.268, 16, 4], [-20.269, -40.270, 16, 4], [-20.268, -40.2615, 16, 4], [-20.2735, -40.2555, 16, 4]]},
}

def tile_xy(lat, lon, z):
    n = 2 ** z
    r = math.radians(lat)
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n

def mosaic(name, west, south, east, north):
    x0, y0 = map(int, tile_xy(north, west, Z)); x1, y1 = map(int, tile_xy(south, east, Z))
    cache = os.path.join('.cache', 'tiles', name); os.makedirs(cache, exist_ok=True)
    jobs = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    def get(xy):
        x, y = xy; path = os.path.join(cache, f'{Z}_{x}_{y}.jpg')
        if not os.path.exists(path):
            req = urllib.request.Request(URL.format(z=Z, x=x, y=y), headers={'User-Agent': 'dsb-rastreio-import'})
            open(path, 'wb').write(urllib.request.urlopen(req, timeout=30).read())
        return path
    with cf.ThreadPoolExecutor(6) as ex: list(ex.map(get, jobs))
    img = Image.new('RGB', ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256))
    for x, y in jobs: img.paste(Image.open(os.path.join(cache, f'{Z}_{x}_{y}.jpg')).convert('RGB'), ((x - x0) * 256, (y - y0) * 256))
    return img, x0, y0

def main(name):
    v = VENUES[name]
    img, x0, y0 = mosaic(name, *v['bbox'])
    img = img.resize((img.width // DOWN, img.height // DOWN), Image.LANCZOS)
    rgb = np.asarray(img).astype(np.float32) / 255
    lab = color.rgb2lab(rgb)
    pixel = lambda lat, lon: tuple(int((c - o) * 256 / DOWN) for c, o in zip(tile_xy(lat, lon, Z), (x0, y0)))
    def geo(px, py):
        n = 2 ** Z; wx = (px * DOWN / 256 + x0) / n; wy = (py * DOWN / 256 + y0) / n
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * wy)))), wx * 360 - 180
    n = 2 ** Z
    north, west = geo(0, 0); south, east = geo(img.width, img.height)
    bounds = [round(west, 6), round(south, 6), round(east, 6), round(north, 6)]

    # Lagoa/baía: região lisa e de cor homogênea conectada às sementes.
    smooth = np.stack([ndi.gaussian_filter(lab[..., i], 1.5) for i in range(3)], -1)
    L = lab[..., 0]; mean = ndi.uniform_filter(L, 7); sq = ndi.uniform_filter(L * L, 7)
    texture = ndi.gaussian_filter(np.sqrt(np.maximum(0, sq - mean * mean)), 1.5)
    def grow(seeds):
        total = np.zeros(L.shape, bool)
        for lat, lon, ctol, ttol in seeds:
            sx, sy = pixel(lat, lon)
            ref = np.median(smooth[sy - 15:sy + 15, sx - 15:sx + 15].reshape(-1, 3), 0)
            cand = (np.linalg.norm(smooth - ref, axis=-1) < ctol) & (texture < ttol)
            ids, _ = ndi.label(morphology.opening(cand, morphology.disk(1)))
            total |= ids == ids[sy, sx]
        mask = ndi.binary_fill_holes(morphology.closing(total, morphology.disk(4)))
        return morphology.opening(morphology.remove_small_objects(mask, max_size=400), morphology.disk(2))
    # Mar: água azul-esverdeada ou espuma branca, conectada ao alto-mar.
    def sea(lat, lon):
        s = np.stack([ndi.gaussian_filter(lab[..., i], 2) for i in range(3)], -1)
        l, a, b = s[..., 0], s[..., 1], s[..., 2]
        cand = (((l > 42) & (a < -8) & (b < 22)) | ((a < -3) & (b < 8))) | ((l > 75) & (b < 13) & (a < 2))
        sx, sy = pixel(lat, lon)
        ids, _ = ndi.label(morphology.opening(cand, morphology.disk(1))); mask = ids == ids[sy, sx]
        mask = morphology.opening(ndi.binary_fill_holes(morphology.closing(mask, morphology.disk(6))), morphology.disk(4))
        ids, _ = ndi.label(mask); mask = ids == ids[sy, sx]
        p = np.pad(mask, 1); p[-1, :] = True; p[:, -1] = True
        return ndi.binary_fill_holes(p)[1:-1, 1:-1]
    def polygons(mask):
        out = []
        for c in measure.find_contours(np.pad(mask, 1).astype(float), .5):
            c = measure.approximate_polygon(c, tolerance=.7)
            if len(c) < 8: continue
            pts = [geo(q[1] - .5, q[0] - .5) for q in c]
            area = abs(sum(pts[i][1] * pts[i - 1][0] - pts[i - 1][1] * pts[i][0] for i in range(len(pts))))
            if area > 2e-7: out.append([[round(lon, 6), round(lat, 6)] for lat, lon in pts])
        return sorted(out, key=lambda p: -len(p))
    def extend(poly, eps=4e-5, far=.15):
        res = []
        for lon, lat in poly:
            if abs(lon - bounds[0]) < eps: lon = bounds[0] - far
            if abs(lon - bounds[2]) < eps: lon = bounds[2] + far
            if abs(lat - bounds[1]) < eps: lat = bounds[1] - far
            if abs(lat - bounds[3]) < eps: lat = bounds[3] + far
            res.append([round(lon, 6), round(lat, 6)])
        return res
    lagoon = polygons(grow(v['lagoon']))[:1] if v['lagoon'] else []
    ocean = [extend(polygons(sea(*v['sea']))[0])] if 'sea' in v else [extend(p) for p in polygons(grow(v['bay']))[:1]]
    out = {'source': 'Contorno extraído de Esri World Imagery (z17); bordas externas do mar prolongadas.', 'bounds': bounds, 'lagoon': lagoon, 'ocean': ocean}
    path = os.path.join(os.path.dirname(__file__), '..', 'lib', 'map', 'data', v['file'])
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print(path, bounds, [len(p) for p in lagoon], [len(p) for p in ocean])

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'imboassica')
