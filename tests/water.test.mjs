import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function load(path,globals={}){
  path=resolve(path);if(path.endsWith('.json'))return JSON.parse(readFileSync(path,'utf8'));const exports={};
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{...globals,exports,require:name=>name==='three'?THREE:name.startsWith('three/')?{mergeGeometries}:load(resolve(dirname(path),name.endsWith('.json')?name:name+'.ts'),globals)});
  return exports;
}
const inside=(p,polygon)=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const [ax,ay]=polygon[i],[bx,by]=polygon[j];if((ay>p.lat)!==(by>p.lat)&&p.lon<(bx-ax)*(p.lat-ay)/(by-ay)+ax)hit=!hit;}return hit;};

/** Metres from a point to the outline of a polygon. */
const shore=(p,polygon)=>{let best=Infinity;const kx=111320*Math.cos(p.lat*Math.PI/180),ky=110700;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const ax=(polygon[j][0]-p.lon)*kx,ay=(polygon[j][1]-p.lat)*ky,dx=(polygon[i][0]-p.lon)*kx-ax,dy=(polygon[i][1]-p.lat)*ky-ay,t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(ax+t*dx,ay+t*dy));}return best;};

test('every preset course lies on the satellite-traced lagoon, never on land',()=>{
  const water=JSON.parse(readFileSync('lib/map/data/imboassica-water.json','utf8'));
  const {COURSE_PRESETS,defaultCourse}=load('lib/map/courses.ts');
  for(const preset of COURSE_PRESETS){
    const course=defaultCourse(preset.id);
    const points=[...course.buoys,...course.routes.flatMap(r=>r.points)];
    for(const p of points)assert.ok(water.lagoon.some(l=>inside(p,l)),`${preset.id}: ${p.lat},${p.lon} is on the lagoon`);
    // The finish line starts at the pier (Instrução Técnica), so its shore end may sit on it: within 15 m of the water.
    for(const p of [course.finishLine.p1,course.finishLine.p2])assert.ok(water.lagoon.some(l=>inside(p,l)||shore(p,l)<15),`${preset.id}: finish ${p.lat},${p.lon} is on the lagoon or at the pier`);
  }
  // The imagery bounds cover the whole lagoon and the event venue.
  const [west,south,east,north]=water.bounds;
  for(const [lon,lat] of water.lagoon[0])assert.ok(lon>=west&&lon<=east&&lat>=south&&lat<=north);
  const vitoria=JSON.parse(readFileSync('lib/map/data/vitoria-water.json','utf8'));
  assert.ok(vitoria.ocean.length>0&&vitoria.ocean[0].length>50);
});

test('distance transform is exact on a small grid',()=>{
  const {distanceField}=load('lib/map/three/water-field.ts');
  const w=9,h=7,target=new Uint8Array(w*h);target[3*w+4]=1;
  const d=distanceField(target,w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)assert.ok(Math.abs(d[y*w+x]-Math.hypot(x-4,y-3))<1e-6);
});

test('hull forms and outboard counts produce the configured boat',()=>{
  const context=new Proxy({},{get:(_,k)=>k==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}});
  const document={createElement:()=>({width:0,height:0,getContext:()=>context})};
  // Same typed-array constructors as three.js, so the real geometry merge accepts the pieces.
  const {solarBoat}=load('lib/map/three/boat.ts',{document,Float32Array,Uint16Array,Uint32Array});
  for(const type of ['cat','mono'])for(const motors of [1,2,3]){
    const boat=solarBoat({type,motors,color:'#187cc1'});
    assert.equal(boat.motorOffsets.length,motors,`${type} with ${motors} motors`);
    assert.equal(boat.hulls.length,type==='cat'?2:1,'catamarans have exactly two floats; no trimaran');
  }
  const mono=solarBoat({type:'mono',motors:1,color:'#fff'});
  const box=new THREE.Box3();let panelWidth=0;
  mono.body.traverse(o=>{if(o.isMesh&&[o.material].flat().some(m=>m.map)){box.setFromObject(o);panelWidth=Math.max(panelWidth,box.max.x-box.min.x);}});
  assert.ok(panelWidth>mono.beam*1.6,'monohull panels overhang the hull');
  const jet=solarBoat({type:'jetski',motors:1,color:'#d36551'});
  assert.ok(jet.length<4,'rescue jet ski is compact');
});
