import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';

function modules(globals = {}, mocks = {}) {
  const loaded = new Map();
  function load(path) {
    path = resolve(path);
    if (loaded.has(path)) return loaded.get(path);
    if (path.endsWith('.json')) return JSON.parse(readFileSync(path,'utf8'));
    const exports = {};
    loaded.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2020, esModuleInterop:true}}).outputText;
    vm.runInNewContext(code, {...globals, exports, require: name => mocks[name] || load(resolve(dirname(path), name.endsWith('.json') ? name : name + '.ts'))}, {filename:path});
    return exports;
  }
  return load;
}

test('coordinate projection remains aligned through zoom and geographic round trips', () => {
  const geo = modules()('lib/map/geo.ts');
  const center = geo.geoToWorld(-22.411,-41.821);
  for (const zoom of [14,15.7,18]) {
    const screen = geo.geoToScreen(-22.414654,-41.818751,center.x,center.y,zoom,256,390,844);
    const result = geo.screenToGeo(screen.x,screen.y,center.x,center.y,zoom,256,390,844);
    assert.ok(Math.abs(result.lat + 22.414654) < 1e-9);
    assert.ok(Math.abs(result.lon + 41.818751) < 1e-9);
  }
});
test('local course survives reload, rejects corrupt data, and reports storage failure', () => {
  const store = new Map();
  const storage = {getItem:key => store.get(key), setItem:(key,v) => store.set(key,v)};
  const {restoreCourse, saveCourse} = modules({localStorage: storage})('lib/map/storage.ts');
  const course = {buoys:[{id:'buoy-2',number:2,lat:-22.411,lon:-41.819}],routes:[{id:'route-1',color:'#00ccff',points:[{lat:-22.411,lon:-41.819}]}],finishLine:{p1:null,p2:null},maintenanceArea:[]};
  assert.equal(saveCourse(course),true);
  const restored = {}; restoreCourse(restored);
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), course);
  store.set('dsb:course:v1','broken'); assert.doesNotThrow(() => restoreCourse({}));
  store.set('dsb:course:v1', JSON.stringify({version:1,buoys:[{lat:1000,lon:0,id:'x',number:1}]}));
  const invalid = {}; restoreCourse(invalid); assert.equal(invalid.buoys, undefined);
  storage.setItem = () => {throw Error('quota');};
  assert.equal(saveCourse(course),false);
});
test('stationary camera paints background once, caps DPR, pauses and suspends hidden tabs', () => {
  let nextFrame, drawBackground = 0, drawFrame = 0, fleet, renderedCamera;
  const events = {}, storage = new Map();
  const document = {hidden:false,addEventListener:(key,fn) => events[key]=fn,removeEventListener:key => delete events[key]};
  const resizeEvents = {};
  const window = {innerWidth:390,innerHeight:844,addEventListener:(name,fn)=>resizeEvents[name]=fn,removeEventListener(){},matchMedia:() => ({matches:false,addEventListener(){},removeEventListener(){}})};
  const globals = {window,document,devicePixelRatio:3,localStorage:{getItem:key=>storage.get(key),setItem:(key,val)=>storage.set(key,val)},requestAnimationFrame:fn => {nextFrame=fn;return 1;},cancelAnimationFrame:()=>{nextFrame=undefined;}};
  const mocks = {'./renderer':{renderBackground:()=>drawBackground++,renderFrame:(_ctx,state)=>{drawFrame++;renderedCamera=[state.worldCX,state.worldCY];}},'./input':{attachInputHandlers:()=>()=>{}},'./tiles':{TileCache:class {revision=0;destroy(){}}}};
  const {initEngine} = modules(globals,mocks)('lib/map/engine.ts');
  const canvas = () => ({width:0,height:0,style:{},getContext:()=>({setTransform(){}})});
  const fg=canvas(), bg=canvas();
  const engine = initEngine(fg,bg,undefined,{onFleetUpdate:boats => fleet=boats});
  for (let time=40;time<=800;time+=40) nextFrame(time);
  assert.equal(drawBackground,1);
  assert.equal(drawFrame,20);
  assert.equal(fg.width,390*3,'phone foreground preserves native 3x detail');
  assert.equal(fg.height,844*3);
  assert.equal(bg.width,(390+160)*1.5,'background keeps its cheaper independent resolution');
  engine.setPaused(true);
  nextFrame(1320); const lat=fleet[0].lat;
  nextFrame(1900); assert.equal(fleet[0].lat,lat);
  engine.zoom(.5); nextFrame(1940); assert.equal(drawBackground,2);
  const beforeFollow = [...renderedCamera];
  engine.follow('b1'); nextFrame(1980); assert.notDeepEqual(renderedCamera, beforeFollow, 'following also works while paused without requiring a full background repaint');
  const beforeResize = drawBackground; resizeEvents.resize(); nextFrame(2020);
  assert.equal(drawBackground,beforeResize+1,'same-size resize must repaint a cleared backing canvas');
  window.innerWidth=3840; window.innerHeight=2160; resizeEvents.resize();
  assert.ok(fg.width*fg.height<=5_000_000,'large dense displays stay within the foreground pixel budget');
  window.innerWidth=844; window.innerHeight=390; resizeEvents.resize();
  assert.equal(fg.width,844*3,'rotation restores native density when it fits the budget');
  document.hidden=true; events.visibilitychange(); assert.equal(nextFrame,undefined);
  document.hidden=false; events.visibilitychange(); assert.equal(typeof nextFrame,'function');
  engine.destroy(); assert.equal(nextFrame,undefined);
});
test('satellite loading has a six-request ceiling, bounded memory and no failed-tile retry loop', () => {
  const images = [];
  class Image { constructor() { images.push(this); } }
  const window = {addEventListener(){}, removeEventListener(){}};
  const {TileCache} = modules({Image, window, navigator:{onLine:true}})('lib/map/tiles.ts');
  const tiles = new TileCache({maxCachedTiles:3,tileSize:256,tileUrl:'https://example.test'});
  for (let i=0;i<10;i++) tiles.load(`16/${i}/0`,16,i,0);
  assert.equal(images.length,6);
  images[0].onerror();
  const afterError = images.length;
  for(let i=0;i<50;i++) tiles.load('16/0/0',16,0,0);
  assert.equal(images.length,afterError);
  for(let i=1;i<10;i++) images[i].onload();
  assert.equal(tiles.get('16/1/0'),undefined);
  assert.ok(tiles.get('16/9/0'));
  tiles.destroy();
});

test('presets keep independent local edits, remember selection, and preserve the legacy circuit', () => {
  const store = new Map();
  const load = modules({localStorage: {getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}});
  const {restoreCourse,saveCourse} = load('lib/map/storage.ts');
  const {defaultCourse} = load('lib/map/courses.ts');
  const state = {courseId:'raia-rapida',...defaultCourse('raia-rapida')};
  restoreCourse(state);
  state.buoys[0].lat = -22.413;
  saveCourse(state);
  restoreCourse(state,'sprint');
  assert.equal(state.buoys.length,2);
  assert.notEqual(state.buoys[0].lat,-22.413);
  saveCourse(state);
  const reopened = {courseId:'raia-rapida'}; restoreCourse(reopened);
  assert.equal(reopened.courseId,'sprint');
  restoreCourse(state,'raia-rapida');
  assert.equal(state.buoys[0].lat,-22.413);
  assert.notEqual(defaultCourse('raia-rapida').buoys[0].lat,-22.413,'editing never mutates a built-in model');
  store.clear();
  store.set('dsb:course:v1',JSON.stringify({version:1,...state}));
  restoreCourse(reopened);
  assert.equal(reopened.courseId,'custom');
  assert.equal(reopened.buoys[0].lat,-22.413);
  saveCourse(reopened);
  restoreCourse(reopened,'sprint'); saveCourse(reopened);
  restoreCourse(reopened,'custom'); assert.equal(reopened.buoys[0].lat,-22.413);
});

test('editing a preset can be undone, restored, switched, and dragged without losing saved changes', () => {
  let input, state;
  const store = new Map();
  const storage = {getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
  const load = modules({window:{innerWidth:1400,innerHeight:900,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},document:{addEventListener(){},removeEventListener(){}},devicePixelRatio:1,requestAnimationFrame:()=>1,cancelAnimationFrame(){},localStorage:storage},
    {'./renderer':{},'./input':{attachInputHandlers:(_c,s,_cfg,cb)=>{state=s;input=cb;return()=>{};}},'./tiles':{TileCache:class{destroy(){}}}});
  const {initEngine} = load('lib/map/engine.ts');
  const {geoToScreen} = load('lib/map/geo.ts');
  const canvas=()=>({style:{},getContext:()=>({setTransform(){}})});
  const engine=initEngine(canvas(),canvas());
  engine.zoom(100); assert.equal(state.zoom,21);
  engine.zoom(-100); assert.equal(state.zoom,14); engine.fit();
  const count=state.buoys.length;
  engine.addBuoy(-22.413,-41.821);
  engine.undoCourse(); assert.equal(state.buoys.length,count);
  engine.setEditTool('buoy');
  const original={...state.buoys[0]};
  const p=geoToScreen(original.lat,original.lon,state.worldCX,state.worldCY,state.zoom,256,state.width,state.height);
  assert.equal(input.onEditStart(p.x,p.y),true);
  input.onEditMove(p.x+40,p.y+30); input.onEditEnd(false);
  const moved={...state.buoys[0]}; assert.notEqual(moved.lat,original.lat);
  engine.selectCourse('sprint'); engine.selectCourse('raia-rapida');
  assert.equal(state.buoys[0].lat,moved.lat);
  engine.resetCourse(); assert.equal(state.buoys[0].lat,original.lat);
  engine.undoCourse(); assert.equal(state.buoys[0].lat,moved.lat);
  engine.setEditTool('buoy');
  const q=geoToScreen(moved.lat,moved.lon,state.worldCX,state.worldCY,state.zoom,256,state.width,state.height);
  input.onEditStart(q.x,q.y); input.onEditMove(q.x+70,q.y); input.onEditEnd(true);
  assert.equal(state.buoys[0].lon,moved.lon,'cancelled gestures restore the original position');
  storage.setItem=()=>{throw Error('quota');};
  assert.equal(engine.selectCourse('sprint'),false,'a failed save must not discard the current edits');
  assert.equal(state.courseId,'raia-rapida');
  engine.destroy();
});

test('touch editing moves a handle without panning and rolls back when a pinch starts', () => {
  const events={}; let edits=0, taps=0; const ends=[];
  const canvas={addEventListener:(n,cb)=>events[n]=cb,removeEventListener(){},setPointerCapture(){}};
  const state={zoom:17,width:390,height:844,worldCX:.4,worldCY:.6};
  const {attachInputHandlers}=modules()('lib/map/input.ts');
  const cleanup=attachInputHandlers(canvas,state,{tileSize:256,zoomMin:14,zoomMax:18},{onEditStart:()=>true,onEditMove:()=>edits++,onEditEnd:cancel=>ends.push(cancel),onTap:()=>taps++});
  events.pointerdown({button:0,clientX:100,clientY:100,pointerId:1});
  events.pointermove({clientX:140,clientY:120}); events.pointerup({clientX:140,clientY:120});
  assert.equal(edits,1); assert.equal(taps,0); assert.deepEqual(ends,[false]);
  assert.equal(state.worldCX,.4); assert.equal(state.worldCY,.6);
  events.pointerdown({button:0,clientX:100,clientY:100,pointerId:1});
  events.touchstart({touches:[{clientX:100,clientY:100},{clientX:200,clientY:100}]});
  assert.deepEqual(ends,[false,true]); assert.equal(state.dragging,false);
  cleanup();
});

test('a tap on a path inserts a vertex between its neighbors', () => {
  const load=modules(); const {insertRoutePoint}=load('lib/map/editing.ts'); const geo=load('lib/map/geo.ts');
  const center=geo.geoToWorld(-22.413,-41.82);
  const a={lat:-22.413,lon:-41.821}, b={lat:-22.413,lon:-41.819};
  const state={routes:[{id:'route-1',points:[a,b]}],zoom:17,width:600,height:600,worldCX:center.x,worldCY:center.y};
  const point={lat:-22.413,lon:-41.82};
  assert.equal(insertRoutePoint(state,{tileSize:256},300,300,point),true);
  assert.equal(state.routes[0].points[1],point); assert.equal(state.routes[0].points[2],b);
  assert.equal(state.activeRouteId,'route-1');
});

test('event areas migrate from the adjusted Match Race and stay shared across every course', () => {
  const store=new Map(); const load=modules({localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}});
  const {defaultCourse,COURSE_PRESETS}=load('lib/map/courses.ts');
  const {restoreCourse,saveCourse}=load('lib/map/storage.ts');
  const adjusted=defaultCourse('match-race'); adjusted.maintenanceArea[0].lat-=.00003;
  store.set('dsb:course:v2:match-race',JSON.stringify({version:1,...adjusted}));
  const state={courseId:'sprint',...defaultCourse('sprint')}; restoreCourse(state,'sprint');
  assert.equal(state.maintenanceArea[0].lat,adjusted.maintenanceArea[0].lat);
  state.maintenanceArea[1].lon-=.00002; state.waitingArea[0].lat+=.00001;
  const expected=JSON.stringify([state.maintenanceArea,state.waitingArea]); saveCourse(state);
  for(const preset of COURSE_PRESETS) {
    restoreCourse(state,preset.id); assert.equal(JSON.stringify([state.maintenanceArea,state.waitingArea]),expected,preset.id);
  }
});

test('old Sprint template updates while a custom Sprint path remains intact', () => {
  const store=new Map(); const load=modules({localStorage:{getItem:k=>store.get(k)}});
  const {defaultCourse,LEGACY_SPRINT_POINTS}=load('lib/map/courses.ts'); const {restoreCourse}=load('lib/map/storage.ts');
  const course=defaultCourse('sprint'); course.routes[0].points=LEGACY_SPRINT_POINTS.map(p=>({...p}));
  const state={courseId:'sprint'};
  store.set('dsb:course:v2:sprint',JSON.stringify({version:1,...course})); restoreCourse(state,'sprint');
  assert.ok(state.routes[0].points.length>2);
  course.routes[0].points[0]={lat:-22.411,lon:-41.819};
  store.set('dsb:course:v2:sprint',JSON.stringify({version:1,...course})); restoreCourse(state,'sprint');
  assert.equal(state.routes[0].points[0].lat,-22.411);
});

test('race limits, waiting berths, and support patrols remain separated for all seven courses', () => {
  const load=modules({}, {'./renderer':{},'./input':{},'./tiles':{}});
  const {createMapState}=load('lib/map/engine.ts');
  const {COURSE_PRESETS,defaultCourse}=load('lib/map/courses.ts');
  const {createSimulation,insideArea,distanceToRoutes,distanceMeters}=load('lib/map/simulation.ts');
  const lake=JSON.parse(readFileSync('lib/map/data/imboassica.json','utf8')).features.find(f=>f.id===132616186).points.map(([lon,lat])=>({lon,lat}));
  for(const preset of COURSE_PRESETS) {
    const state=createMapState(); Object.assign(state,defaultCourse(preset.id),{courseId:preset.id});
    const tick=createSimulation(state);
    const racers=state.boats.filter(b=>b.activity==='racing'), waiting=state.boats.filter(b=>b.activity==='waiting'), support=state.boats.filter(b=>b.activity==='support');
    const expected=preset.id==='match-race' ? 2 : preset.id==='slalom' ? 1 : 6;
    assert.equal(racers.length,expected,preset.id); assert.equal(waiting.length,6-expected); assert.equal(support.length,3);
    if(preset.id==='match-race') assert.equal(new Set(racers.map(b=>b.raceRouteId)).size,2);
    const anchors=support.map(b=>({lat:b.lat,lon:b.lon}));
    let moved=false;
    for(let second=1;second<=360;second++) {
      state.animationTime=second*1000; tick(1000);
      for(const b of waiting) { assert.ok(insideArea(b,state.waitingArea),`${preset.id}: waiting boat stays inside its area`); assert.equal(b.raceRouteId,null); }
      for(const [i,b] of support.entries()) {
        assert.equal(b.raceRouteId,null); assert.ok(b.speed<1);
        assert.ok(insideArea(b,lake),`${preset.id}: support stays on water`);
        assert.ok(distanceToRoutes(b,state.routes)>25,`${preset.id}: support stays away from every lane`);
        assert.ok(state.buoys.every(buoy=>distanceMeters(b,buoy)>20),'patrol does not overlap a buoy');
        assert.ok(distanceMeters(b,anchors[i])<=10.01);
        if(distanceMeters(b,anchors[i])>1) moved=true;
      }
    }
    assert.ok(moved,'patrol has gentle movement');
  }
});

test('Sprint crosses the buoy line outside the right buoy outbound and between the buoys inbound', () => {
  const {defaultCourse}=modules()('lib/map/courses.ts'); const course=defaultCourse('sprint');
  const [a,b]=course.buoys; const points=course.routes[0].points;
  const crossings=[];
  const cross=(x,y)=>x.lon*y.lat-x.lat*y.lon;
  const subtract=(x,y)=>({lon:x.lon-y.lon,lat:x.lat-y.lat});
  const gate=subtract(b,a);
  for(let i=1;i<points.length;i++) {
    const p=points[i-1],v=subtract(points[i],p),w=subtract(a,p),denom=cross(v,gate);
    if(Math.abs(denom)<1e-15) continue;
    const t=cross(w,gate)/denom, u=cross(w,v)/denom;
    if(t>0 && t<=1) crossings.push(u);
  }
  assert.ok(crossings[0]>1,'outbound passes to the right, outside both buoys');
  assert.ok(crossings.slice(1).some(u=>u>0 && u<1),'return passes inside the gate');
});

test('extra satellite zoom reuses native level 18 rather than requesting level 21 tiles', () => {
  const {renderBackground}=modules({}, {'./chart':{renderChart(){}}})('lib/map/renderer.ts');
  const levels=[];
  renderBackground({}, {width:390,height:844,zoom:21,worldCX:.3838,worldCY:.5639,style:'satellite'}, {tileSize:256,zoomMin:14,zoomMax:21},
    {get:()=>null,findFallback:()=>null,load:(_key,z)=>levels.push(z)});
  assert.ok(levels.length>0 && levels.length<=4); assert.ok(levels.every(z=>z===18));
});
