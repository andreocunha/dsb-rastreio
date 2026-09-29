import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import * as sun from 'suncalc';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/map/three/lighting.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Date,require:()=>sun});
const {sceneSun}=exports,day=new Date('2026-09-27T15:00:00Z');
test('lighting uses the event coordinates and the real instant, in degrees from north',()=>{
 const result=sceneSun(day,-22.414654,-41.818751,'live');
 assert.equal(result.date.getTime(),day.getTime());assert.ok(result.altitude>50);assert.equal(result.day,1);
 assert.ok(Math.abs(Math.hypot(result.x,result.y,result.z)-1)<1e-9);
});
test('fixed presets provide daylight, golden hour and readable night independently of host timezone',()=>{
 const morning=sceneSun(day,-22.414654,-41.818751,'morning');
 const noon=sceneSun(day,-22.414654,-41.818751,'noon');
 const sunset=sceneSun(day,-22.414654,-41.818751,'sunset');
 const night=sceneSun(day,-22.414654,-41.818751,'night');
 assert.ok(morning.altitude>0 && morning.altitude<noon.altitude);
 assert.ok(sunset.altitude<3 && sunset.warm>0);
 assert.ok(night.altitude<0);assert.equal(night.day,0);
 assert.ok(morning.x>0 && sunset.x<0,'sun moves from east to west');
});
