import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';

function load(path){
  path=resolve(path);if(path.endsWith('.json'))return JSON.parse(readFileSync(path,'utf8'));const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name==='three'?THREE:load(resolve(dirname(path),name.endsWith('.json')?name:name+'.ts'))});
  return exports;
}

test('imagery tiles align to the exact GPS projection and keep a bounded visible grid',()=>{
  const {projection}=load('lib/map/three/geography.ts');
  const {imageryGrid}=load('lib/map/three/imagery-grid.ts');
  const {Imagery}=load('lib/map/three/imagery.ts');
  for(const venue of ['imboassica','vitoria-test']){
    const p=projection(venue),corners=[p.world(-900,-600),p.world(900,-600),p.world(900,600),p.world(-900,600)];
    const grid=imageryGrid(corners,18);
    assert.ok((grid.x1-grid.x0+1)*(grid.y1-grid.y0+1)<=48);
    const image={},requests=[];
    const tiles={revision:1,get:()=>image,load:(...a)=>requests.push(a)};
    const imagery=new Imagery(tiles,p);imagery.update(corners,18);
    assert.ok(imagery.ready);assert.ok(imagery.root.children.length<=48);
    for(const mesh of imagery.root.children){
      const world=p.world(mesh.position.x,mesh.position.z);
      assert.ok(Math.abs((world.x*grid.n)%1-.5)<1e-8);
      assert.ok(Math.abs((world.y*grid.n)%1-.5)<1e-8);
      assert.ok(Math.abs(mesh.scale.x-p.meters/grid.n)<1e-9);
    }
    const first=requests.length;imagery.update(corners,18);
    assert.equal(requests.length,first,'stationary camera does not repeatedly queue imagery');
    imagery.dispose();
  }
});

test('boat wake is laid on its past path, follows curves, expires, and clears on GPS jumps',()=>{
  const {BoatWake}=load('lib/map/three/boat-wake.ts');
  const wake=new BoatWake();
  for(let i=0;i<20;i++)wake.update(0,-i*2,0,8,1,i*150,true);
  const first=wake.stamps(5000)[0];
  // A tight turn: new stamps take the new heading, old ones stay where they were laid.
  for(let i=0;i<20;i++)wake.update(i*2,-40,90,8,1,3000+i*150,true);
  const stamps=wake.stamps(5000);
  assert.deepEqual(stamps[0],first,'turning does not move or rotate old foam');
  assert.ok(Math.abs(stamps.at(-1).angle-Math.PI/2)<1e-6,'new foam follows the new heading');
  assert.ok(wake.visible(6000)<=91,'instances stay bounded');
  wake.update(1000,1000,90,8,1,6100,true);
  assert.ok(wake.stamps(6100).every(s=>Math.hypot(s.x-1000,s.z-1000)<1),'a jump restarts the wake at the new fix: no foam across the lake');
  for(let i=0;i<300;i++)wake.update(1000+i*3,1000,90,8,1,6200+i*100,true);
  assert.ok(wake.visible(36100)<=91,'ring buffer stays bounded');
  wake.update(2000,1000,90,0,1,80000,false);
  assert.equal(wake.stamps(80000).length,0,'old foam fades without new positions');
  wake.dispose();
});
