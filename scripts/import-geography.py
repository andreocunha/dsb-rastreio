"""Convert an OSM API XML extract into the small chart bundled with the app.
Usage: python3 scripts/import-geography.py /path/to/extract.osm
Source bbox: -41.853,-22.428,-41.805,-22.395. OSM data © contributors, ODbL.
"""
import json, math, sys, xml.etree.ElementTree as ET
from pathlib import Path
root = ET.parse(sys.argv[1]).getroot()
nodes = {n.attrib['id']: [float(n.attrib['lon']), float(n.attrib['lat'])] for n in root.findall('node')}

def simplify(points, epsilon=0.000025):
    if len(points) < 3: return points
    a,b=points[0],points[-1]
    dx,dy=b[0]-a[0],b[1]-a[1]
    d=dx*dx+dy*dy
    def distance(p):
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)) if d else 0
        return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
    index=max(range(1,len(points)-1),key=lambda i:distance(points[i]))
    if distance(points[index])>epsilon:
        return simplify(points[:index+1],epsilon)[:-1]+simplify(points[index:],epsilon)
    return [a,b]

features=[]
for way in root.findall('way'):
    tags={t.attrib['k']:t.attrib['v'] for t in way.findall('tag')}
    natural=tags.get('natural')
    highway=tags.get('highway')
    kind = natural if natural in ['water','wood','wetland','beach','coastline'] else ('road' if highway in ['primary','secondary','tertiary','residential','unclassified'] else ('park' if tags.get('leisure')=='park' else None))
    if not kind: continue
    refs=[n.attrib['ref'] for n in way.findall('nd')]
    if not all(n in nodes for n in refs): continue
    pts=simplify([nodes[n] for n in refs])
    features.append({'id':int(way.attrib['id']),'kind':kind,'name':tags.get('name',''),'major':highway in ['primary','secondary','tertiary'],'points':[[round(x,6),round(y,6)] for x,y in pts]})
output={'source':'© OpenStreetMap contributors · ODbL 1.0','sourceUrl':'https://www.openstreetmap.org/copyright','features':features}
p=Path('lib/map/data/imboassica.json')
p.write_text(json.dumps(output,separators=(',',':'),ensure_ascii=False)+'\n')
print(f'{len(features)} features, {p.stat().st_size} bytes')
for f in features:
    if f['kind']=='coastline': print(f['id'],f['points'][0],f['points'][-1])
