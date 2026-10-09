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
    vm.runInNewContext(code, {performance, ...globals, exports, require: name => mocks[name] || load(resolve(dirname(path), name.endsWith('.json') ? name : name + '.ts'))}, {filename:path});
    return exports;
  }
  return load;
}

test('wake disappears at rest, grows through race speeds and stays bounded above sprint speed', () => {
  const {drawWake} = modules()('lib/map/wake.ts');
  function sample(speed, time = 1000) {
    const arcs = [];
    const ctx = {
      beginPath(){}, moveTo(){},
      quadraticCurveTo(_cx,_cy,x,y){ this.endpoint = {x,y}; },
      stroke(){ arcs.push({...this.endpoint,alpha:Number(this.strokeStyle.split(',').at(-1).slice(0,-1)),width:this.lineWidth}); },
    };
    drawWake(ctx,speed,time);
    return arcs;
  }
  for (const speed of [0,0.1,0.3,-1,NaN,Infinity]) assert.deepEqual(sample(speed),[]);
  for (const time of [0,400,1000,1700]) {
    const slow=sample(1,time), normal=sample(6,time), sprint=sample(12,time);
    assert.equal(sprint.length,5,'effect keeps a fixed drawing budget');
    for (const property of ['x','y','alpha','width']) {
      const peak = arcs => Math.max(...arcs.map(a=>a[property]));
      assert.ok(peak(slow)<peak(normal),`${property} increases toward normal race speed`);
      assert.ok(peak(normal)<peak(sprint),`${property} increases toward sprint speed`);
    }
    assert.deepEqual(sample(25,time),sprint,'jet skis do not stretch the competitors’ visual scale');
  }
});

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
  const project=p=>geo.geoToScreen(p.lat,p.lon,state.worldCX,state.worldCY,state.zoom,256,state.width,state.height);
  assert.equal(insertRoutePoint(state,project,300,300,point),true);
  assert.equal(state.routes[0].points[1],point); assert.equal(state.routes[0].points[2],b);
  assert.equal(state.activeRouteId,'route-1');
});



test('race limits, waiting berths, and support patrols remain separated for all seven courses', () => {
  const load=modules({}, {'./renderer':{},'./input':{},'./tiles':{}});
  const {createMapState}=load('lib/map/engine.ts');
  const {COURSE_PRESETS,defaultCourse}=load('lib/map/courses.ts');
  const {createSimulation,insideArea,distanceToRoutes,distanceMeters}=load('lib/map/simulation.ts');
  const lake=JSON.parse(readFileSync('lib/map/data/imboassica-water.json','utf8')).lagoon[0].map(([lon,lat])=>({lon,lat}));
  for(const preset of COURSE_PRESETS) {
    const state=createMapState(); Object.assign(state,defaultCourse(preset.id),{courseId:preset.id});
    const tick=createSimulation(state);
    const racers=state.boats.filter(b=>b.activity==='racing'), waiting=state.boats.filter(b=>b.activity==='waiting'), support=state.boats.filter(b=>b.activity==='support');
    const expected=preset.id==='match-race' ? 2 : preset.id==='slalom' ? 1 : 10;
    assert.equal(racers.length,expected,preset.id); assert.equal(waiting.length,10-expected); assert.equal(support.length,3);
    if(preset.id==='match-race') assert.equal(new Set(racers.map(b=>b.raceRouteId)).size,2);
    const anchors=support.map(b=>({lat:b.lat,lon:b.lon}));
    let moved=false;
    for(let second=1;second<=360;second++) {
      state.animationTime=second*1000; tick(1000);
      for(const b of waiting) { assert.ok(insideArea(b,state.waitingArea),`${preset.id}: waiting boat stays inside its area`); assert.equal(b.raceRouteId,null); }
      for(const [i,b] of support.entries()) {
        assert.equal(b.raceRouteId,null); assert.ok(b.speed<4,'support idles slowly');
        assert.ok(insideArea(b,lake),`${preset.id}: support stays on water`);
        assert.ok(distanceToRoutes(b,state.routes)>25,`${preset.id}: support stays away from every lane`);
        assert.ok(state.buoys.every(buoy=>distanceMeters(b,buoy)>20),'patrol does not overlap a buoy');
        assert.ok(distanceMeters(b,anchors[i])<=32.01);
        if(distanceMeters(b,anchors[i])>1) moved=true;
      }
    }
    assert.ok(moved,'patrol has gentle movement');
  }
});

test('Sprint runs straight from the middle of the start gate to the finish line', () => {
  const load=modules(); const {defaultCourse}=load('lib/map/courses.ts'); const {distanceMeters}=load('lib/map/simulation.ts');
  const course=defaultCourse('sprint'); const [a,b]=course.buoys; const points=course.routes[0].points;
  assert.equal(course.routes.length,1); assert.equal(points.length,2);
  const mid=(x,y)=>({lat:(x.lat+y.lat)/2,lon:(x.lon+y.lon)/2});
  const {p1,p2}=course.finishLine;
  assert.ok(distanceMeters(points[0],mid(a,b))<15,'starts between the start buoys');
  assert.ok(distanceMeters(points[1],mid(p1,p2))<15,'ends at the finish line');
});

test('extra satellite zoom reuses native level 18 rather than requesting level 21 tiles', () => {
  const {renderBackground}=modules({}, {'./chart':{renderChart(){}}})('lib/map/renderer.ts');
  const levels=[];
  renderBackground({}, {width:390,height:844,zoom:21,worldCX:.3838,worldCY:.5639,style:'satellite'}, {tileSize:256,zoomMin:14,zoomMax:21},
    {get:()=>null,findFallback:()=>null,load:(_key,z)=>levels.push(z)});
  assert.ok(levels.length>0 && levels.length<=4); assert.ok(levels.every(z=>z===18));
});

test('live fleet never simulates positions, preserves a bounded trail and removes stopped trackers', () => {
  let frame, fleet;
  const window={innerWidth:1200,innerHeight:800,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
  const globals={window,document:{hidden:false,addEventListener(){},removeEventListener(){}},devicePixelRatio:1,localStorage:{getItem(){return null;},setItem(){}},requestAnimationFrame:fn=>{frame=fn;return 1;},cancelAnimationFrame(){}};
  const mocks={'./renderer':{renderBackground(){},renderFrame(){}},'./input':{attachInputHandlers:()=>()=>{}},'./tiles':{TileCache:class{revision=0;destroy(){}}}};
  const {initEngine}=modules(globals,mocks)('lib/map/engine.ts');
  const canvas=()=>({style:{},getContext:()=>({setTransform(){}})});
  const engine=initEngine(canvas(),canvas(),undefined,{onFleetUpdate:b=>fleet=b},true);
  frame(100);assert.equal(fleet.length,0);
  const point={id:'solares',label:'Solares',color:'blue',lat:-22.4,lon:-41.8,speed:5,heading:12,capturedAt:new Date().toISOString()};
  engine.setLiveBoats([point]);
  for(let time=200;time<2000;time+=100) frame(time);
  assert.equal(fleet[0].lat,point.lat);assert.equal(fleet[0].lon,point.lon);
  engine.setLiveBoats([]);assert.equal(fleet.length,0);
  engine.setLiveBoats([{...point,lat:NaN}]);assert.equal(fleet.length,0);
  engine.destroy();
});

test('public demo ignores live points and stored course edits, can pause, and does not save a course',()=>{
  let frame,state;
  const window={innerWidth:1200,innerHeight:800,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
  const globals={window,document:{hidden:false,addEventListener(){},removeEventListener(){}},devicePixelRatio:1,
    localStorage:{getItem(){throw Error('demo must not read the operator course');},setItem(){throw Error('demo must not overwrite the operator course');}},
    requestAnimationFrame:fn=>{frame=fn;return 1;},cancelAnimationFrame(){}};
  const mocks={'./renderer':{renderBackground(){},renderFrame:(_ctx,s)=>state=s},'./input':{attachInputHandlers:()=>()=>{}},'./tiles':{TileCache:class{revision=0;destroy(){}}}};
  const {initEngine}=modules(globals,mocks)('lib/map/engine.ts');
  const canvas=()=>({style:{},getContext:()=>({setTransform(){}})});
  const engine=initEngine(canvas(),canvas(),undefined,{},false,true);
  frame(100);assert.equal(state.demo,true);assert.equal(state.boats.length,13,'ten competitors plus rescue and support craft, as at the event');
  const start=state.boats[0].lat;
  for(let t=200;t<=1000;t+=100)frame(t);
  assert.notEqual(state.boats[0].lat,start);
  engine.setPaused(true);const paused=state.boats[0].lat;
  frame(2000);assert.equal(state.boats[0].lat,paused);
  engine.setLiveBoats([]);assert.equal(state.boats.length,13);
  engine.setDemoSpeed(4);engine.setPaused(false);frame(2100);
  assert.notEqual(state.boats[0].lat,paused);
  engine.destroy();
});



test('healthy stream becomes stale without new GPS points and recovers on the next fix', () => {
  const {feedStatusFor,feedToneFor,isRecentPosition,positionAge}=modules()('lib/tracker/freshness.ts');
  const now=Date.parse('2026-09-27T01:29:00Z');
  const boats=[{capturedAt:new Date(now).toISOString()}];
  assert.equal(feedStatusFor('connected',true,boats,now),'Ao vivo');
  assert.equal(isRecentPosition(boats[0].capturedAt,now+15000),false);
  assert.equal(feedStatusFor('connected',true,boats,now+180000),'Sem sinal dos trackers · Última posição há 3 min');
  assert.equal(feedStatusFor('connected',true,[...boats,{capturedAt:new Date(now+180000).toISOString()}],now+180000),'Ao vivo · 1 sem atualização');
  assert.equal(feedStatusFor('connected',true,[{capturedAt:new Date(now+180000).toISOString()}],now+180000),'Ao vivo');
  assert.equal(feedStatusFor('connected',false,boats,now),'Últimas posições · Servidor sem atualização');
  assert.equal(feedStatusFor('disconnected',true,boats,now),'Reconectando…');
  assert.equal(feedToneFor('connected',true,boats,now),'live');
  assert.equal(feedToneFor('connected',true,boats,now+180000),'stale');
  assert.equal(feedToneFor('connected',false,boats,now),'stale');
  assert.equal(feedToneFor('disconnected',true,boats,now),'wait');
  assert.equal(positionAge(undefined,now),'Sem posição');
});

test('live movement plays the track smoothly behind real time, crossing north on turns, without extrapolation',()=>{
  const {LiveMotion,PLAYBACK_DELAY}=modules()('lib/map/live-motion.ts');
  const motion=new LiveMotion({lat:-20,lon:-40,heading:350,time:1000},0);
  motion.push({lat:-19.9999,lon:-40,heading:10,time:2000},1000);
  const half=motion.sample(500+PLAYBACK_DELAY);
  assert.ok(Math.abs(half.lat-(-19.99995))<1e-9);
  assert.ok(Math.abs(((half.heading+180)%360)-180)<1e-6,'heading follows the track north, not a 340 degree spin');
  assert.equal(motion.sample(100000).lat,-19.9999,'stops at the latest real coordinate');
  assert.equal(motion.sample(1500,true).lat,-19.9999,'respects reduced motion');
});
test('1 Hz fixes with network jitter or a lost fix produce continuous motion: never stop-and-go',()=>{
  const {LiveMotion,PLAYBACK_DELAY}=modules()('lib/map/live-motion.ts');
  const step=0.00004,jitter=[0,380,-150,420,90,-200,300,0,250,-100];
  const motion=new LiveMotion({lat:0,lon:0,heading:0,time:0},100);
  // Fix 5 is lost entirely: one second without signal must not stop the boat.
  const arrivals=jitter.map((j,i)=>({time:(i+1)*1000,at:(i+1)*1000+100+j})).filter(a=>a.time!==5000);
  let previous=0,stalls=0,maxStep=0;
  for(let now=100;now<=10000+PLAYBACK_DELAY;now+=16){
    for(const a of arrivals)if(a.at<=now&&!a.done){a.done=true;motion.push({lat:a.time/1000*step,lon:0,heading:0,time:a.time},a.at);}
    const lat=motion.sample(now).lat,delta=lat-previous;previous=lat;
    // After the initial buffering, until the last fix is played.
    if(now>PLAYBACK_DELAY+1500&&now<9500+PLAYBACK_DELAY){if(delta<=0)stalls++;maxStep=Math.max(maxStep,delta);}
  }
  assert.equal(stalls,0,'the boat keeps moving between late and early fixes');
  assert.ok(maxStep<step/1000*16*1.35,`no visible surge when a delayed fix arrives (${(maxStep/(step/1000*16)).toFixed(2)}x)`);
});
test('live retargeting preserves visual continuity and ignores reordered GPS',()=>{
  const {LiveMotion}=modules()('lib/map/live-motion.ts');
  const motion=new LiveMotion({lat:0,lon:0,heading:0,time:1000},0);
  motion.push({lat:0.0001,lon:0,heading:90,time:2000},1000);
  const before=motion.sample(2400);
  motion.push({lat:0.0002,lon:0,heading:180,time:3000},2400);
  assert.ok(Math.abs(motion.sample(2400).lat-before.lat)<1e-12);
  assert.ok(Math.abs(motion.sample(2400).heading-before.heading)<1e-9);
  assert.equal(motion.push({lat:40,lon:40,heading:0,time:2000},2500),false);
  assert.equal(motion.sample(100000).lat,0.0002);
});
test('long outages and GPS jumps reposition directly instead of speeding through history',()=>{
  const {LiveMotion}=modules()('lib/map/live-motion.ts');
  const motion=new LiveMotion({lat:0,lon:0,heading:0,time:1000},0);
  assert.equal(motion.push({lat:0.0002,lon:0,heading:90,time:61000},60000),false);
  assert.equal(motion.sample(60000).lat,0.0002);
  assert.equal(motion.push({lat:1,lon:1,heading:180,time:62000},61000),false);
  assert.equal(motion.sample(61000).lat,1);
});
test('SOS notices baseline old calls, deduplicate retries and reconnects, accept another SOS from same boat',()=>{
  const {SosNotices}=modules()('lib/tracker/sos-notices.ts');
  const notices=new SosNotices();
  const old=['old','boat','Solares',1],fresh=['new','boat','Solares',2];
  assert.equal(notices.accept([old]).length,0);
  assert.equal(notices.accept([fresh,old]).length,1);
  assert.equal(notices.accept([fresh,old]).length,0);
  notices.accept([]);
  assert.equal(notices.accept([fresh]).length,0,'a snapshot after reconnect is not a new SOS');
  assert.equal(notices.accept([['again','boat','Solares',3],fresh]).length,1);
});

test('3D local coordinates preserve the map projection and GPS orientation for both venues',()=>{
  const {projection}=modules()('lib/map/three/geography.ts');
  const {geoToWorld}=modules()('lib/map/geo.ts');
  for(const id of ['imboassica','vitoria-test']){
    const p=projection(id),lat=p.venue.lat+.001,lon=p.venue.lon+.001;
    const local=p.point(lat,lon),world=p.world(local.x,local.z),expected=geoToWorld(lat,lon);
    assert.ok(local.x>0 && local.z<0,'east is +X, north is -Z');
    assert.ok(Math.abs(world.x-expected.x)<1e-12 && Math.abs(world.y-expected.y)<1e-12);
    assert.ok(p.point(p.venue.lat,p.venue.lon).x===0);
  }
});

test('course data from the server is sanitised strictly and malformed courses are rejected',()=>{
  const {parseGeometry,parseAreas,parseLiveCourse}=modules()('lib/map/course-data.ts');
  const geometry={buoys:[{id:'buoy-1',number:1,lat:-22.41,lon:-41.82,extra:'x'}],routes:[{id:'route-1',color:'#00ccff',points:[{lat:-22.41,lon:-41.82},{lat:-22.412,lon:-41.821}]}],finishLine:{p1:{lat:-22.41,lon:-41.82},p2:null}};
  const parsed=parseGeometry(geometry);
  assert.equal(JSON.stringify(parsed.buoys[0]),JSON.stringify({id:'buoy-1',number:1,lat:-22.41,lon:-41.82}),'unknown keys dropped');
  assert.equal(parseGeometry({...geometry,routes:[{...geometry.routes[0],color:'red;background:url(x)'}]}),null);
  assert.equal(parseGeometry({...geometry,buoys:[{id:'b',number:1,lat:200,lon:0}]}),null);
  assert.equal(parseGeometry({...geometry,buoys:Array.from({length:301},(_,i)=>({id:'b'+i,number:i,lat:0,lon:0}))}),null);
  assert.equal(parseAreas({maintenanceArea:[{lat:0,lon:0}]}),null,'both areas required');
  assert.equal(parseLiveCourse({venue:'../x',course:'raia-rapida'}),null);
  assert.equal(parseLiveCourse({venue:'imboassica',course:'slalom',geometry:null,areas:null}).course,'slalom');
});

function editableEngine(storage=new Map()) {
  let input,state,edits=[];
  const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
  const load=modules({window:{innerWidth:1400,innerHeight:900,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},document:{addEventListener(){},removeEventListener(){}},devicePixelRatio:1,requestAnimationFrame:()=>1,cancelAnimationFrame(){},localStorage},
    {'./renderer':{},'./input':{attachInputHandlers:(_c,s,_cfg,cb)=>{state=s;input=cb;return()=>{};}},'./tiles':{TileCache:class{destroy(){}}}});
  const {initEngine}=load('lib/map/engine.ts');const {geoToScreen}=load('lib/map/geo.ts');
  const canvas=()=>({style:{},getContext:()=>({setTransform(){}})});
  const engine=initEngine(canvas(),canvas(),undefined,{onCourseEdit:e=>edits.push(JSON.parse(JSON.stringify(e)))},true);
  const screen=p=>geoToScreen(p.lat,p.lon,state.worldCX,state.worldCY,state.zoom,256,state.width,state.height);
  return {engine,get state(){return state;},get input(){return input;},edits,screen,storage};
}

test('spectators follow the published course and keep it cached for offline reopening',()=>{
  const t=editableEngine();
  assert.equal(t.state.courseId,'raia-rapida','first model until something is published');
  const custom={buoys:[{id:'buoy-1',number:1,lat:-22.4131,lon:-41.8201}],routes:[],finishLine:{p1:null,p2:null}};
  t.engine.applyLiveCourse({venue:'imboassica',course:'slalom',geometry:custom,areas:null,updatedAt:'1'});
  assert.equal(t.state.courseId,'slalom');assert.equal(t.state.buoys[0].lat,-22.4131);
  assert.ok(t.state.maintenanceArea.length>=3,'built-in areas when none were published');
  t.engine.applyLiveCourse({venue:'imboassica',course:'sprint',geometry:null,areas:null,updatedAt:'2'});
  assert.equal(t.state.courseId,'sprint');assert.ok(t.state.buoys.length>0,'null geometry shows the model');
  t.engine.destroy();
  const reopened=editableEngine(t.storage);
  assert.equal(reopened.state.courseId,'sprint','the last published course reopens offline');
  reopened.engine.destroy();
});

test('an edit session keeps the organizer copy on screen, reports edits, undoes, cancels gestures and returns to live',()=>{
  const t=editableEngine();
  t.engine.beginEdit();
  t.engine.loadCourse('imboassica','match-race',null,null);
  assert.equal(t.state.courseId,'match-race');
  t.engine.applyLiveCourse({venue:'imboassica',course:'slalom',geometry:null,areas:null,updatedAt:'1'});
  assert.equal(t.state.courseId,'match-race','a publish elsewhere does not yank the editor');
  t.engine.setEditTool('buoy');
  const original={...t.state.buoys[0]},p=t.screen(original);
  assert.equal(t.input.onEditStart(p.x,p.y),true);
  t.input.onEditMove(p.x+40,p.y+30);t.input.onEditEnd(false);
  const moved={...t.state.buoys[0]};assert.notEqual(moved.lat,original.lat);
  const last=t.edits.at(-1);
  assert.equal(last.course,'match-race');assert.equal(last.geometry.buoys[0].lat,moved.lat);assert.ok(last.areas.maintenanceArea.length>=3);
  t.engine.undoCourse();assert.equal(t.state.buoys[0].lat,original.lat);
  t.engine.resetCourse();assert.equal(t.state.buoys[0].lat,original.lat);
  const q=t.screen(t.state.buoys[0]);t.input.onEditStart(q.x,q.y);t.input.onEditMove(q.x+70,q.y);t.input.onEditEnd(true);
  assert.equal(t.state.buoys[0].lon,original.lon,'cancelled gestures restore the original position');
  t.engine.endEdit();
  assert.equal(t.state.courseId,'slalom','closing the editor returns to what spectators see');
  const count=t.edits.length;t.engine.addBuoy(-22.413,-41.821);
  assert.equal(t.edits.length,count,'no saves outside an edit session');
  t.engine.destroy();
});

test('boat names stay clear of hulls and of each other, fade in, and only re-render on change', () => {
  let bitmaps = 0;
  const context = new Proxy({}, {get: (_, k) => k === 'measureText' ? text => ({width: text.length * 6}) : () => {}, set: () => true});
  const document = {createElement: () => { bitmaps++; return {width: 0, height: 0, getContext: () => context}; }};
  const {LabelLayout} = modules({document, Path2D: class {roundRect(){} moveTo(){} lineTo(){} closePath(){}}})('lib/map/labels.ts');
  const layout = new LabelLayout();
  const boat = (id, x, y, extra = {}) => ({id, label: 'Equipe ' + id, type: 'cat', x, y, speed: 7.4, isFollowed: false, accentColor: '#2f86ff', size: 30, ...extra});
  // Two boats side by side, a support craft, and one off screen.
  const fleet = [boat('a', 200, 300, {isFollowed: true}), boat('b', 240, 300), boat('s', 100, 500, {type: 'jetski'}), boat('far', 2000, 300)];
  let placed = [];
  for (let t = 0; t <= 600; t += 16) placed = layout.layout(fleet, 400, 800, t, 2);
  const ids = placed.map(l => l.id);
  assert.deepEqual([...ids].sort(), ['a', 'b'], 'support craft only when followed; nothing for an off-screen boat');
  assert.equal(placed.at(-1).id, 'a', 'the followed name is drawn last, on top');
  assert.ok(placed.every(l => l.alpha === 1), 'faded in');
  const pad = 16, box = l => ({x: l.x + pad, y: l.y + pad, w: l.bitmap.width / 2 - pad * 2, h: 22});
  const [p, q] = placed.map(box);
  assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, 'labels do not overlap');
  for (const l of placed.map(box)) for (const b of fleet.slice(0, 2)) assert.ok(!(l.x < b.x + 12 && l.x + l.w > b.x - 12 && l.y < b.y + 12 && l.y + l.h > b.y - 12), 'no label covers a hull');
  // Steady frames reuse the bitmaps; a new speed with the same digit count re-renders one, without re-measuring the pill.
  const before = bitmaps;
  for (let t = 616; t <= 1000; t += 16) layout.layout(fleet, 400, 800, t, 2);
  assert.equal(bitmaps, before, 'no bitmap work while nothing changes');
  fleet[0].speed = 8.1; const width = layout.layout(fleet, 400, 800, 1016, 2).find(l => l.id === 'a').bitmap.width;
  assert.equal(bitmaps, before + 1, 'one re-render for the new speed');
  assert.ok(width > 0);
  // A boat that leaves the race takes its name with it.
  assert.ok(!layout.layout(fleet.slice(1), 400, 800, 1032, 2).some(l => l.id === 'a'));
});

test('frame budget: smooth while dragging, sharp while watching, and it remembers both', () => {
  const {FrameBudget} = modules()('lib/map/three/quality.ts');
  const store = new Map(), storage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};
  const budget = new FrameBudget(.57, storage);
  let now = 0;
  const run = (ms, elapsed, target, interactive) => { for (const end = now + ms; now < end; now += elapsed) budget.frame(elapsed, target, interactive, now); };
  // A weak GPU dragging the map: every other frame missed at 60 fps.
  run(3000, 25, 1000 / 60, true);
  assert.ok(budget.scale < 1 && !budget.halfRate, 'resolution goes first');
  run(20000, 25, 1000 / 60, true);
  assert.equal(budget.halfRate, true, 'then half frame rate');
  // At half rate it keeps up: the picture may sharpen again, but never above what failed at full rate first.
  run(4000, 1000 / 30, 1000 / 30, true);
  const dragging = budget.scale;
  assert.ok(dragging < .8, 'still light while dragging');
  // Hands off (eco, 30 fps) the same phone keeps up easily: its own, sharper level.
  run(60000, 1000 / 30, 1000 / 30, false);
  assert.equal(budget.scale, 1, 'sharp picture while watching');
  // Back to dragging: the light level comes back at once.
  run(100, 1000 / 30, 1000 / 30, true);
  assert.equal(budget.scale, dragging, 'the light level comes back as soon as the map is dragged');
  const saved = JSON.parse(store.get('dsb:map:quality-v3'));
  assert.equal(saved.eco, 1); assert.equal(saved.halfRate, true);
  const next = new FrameBudget(.57, storage);
  assert.equal(next.halfRate, true, 'a phone known to struggle opens at half rate');
  assert.equal(next.scale, 1, 'and opens sharp (eco) instead of blurry');
  assert.equal(new FrameBudget(.57, {getItem() { throw Error('blocked'); }}).scale, 1, 'storage errors are harmless');
  const weak = new FrameBudget(.4, null, 'k', .42, .7);
  assert.equal(weak.scale, .7, 'weak GPUs watch at a sharp level from the first visit');
  weak.frame(16, 1000 / 60, true, 0); assert.equal(weak.scale, .42, 'and drag at a light one');
});

test('entry-level GPUs start at a lower resolution; mid and high-end ones at full', () => {
  const {weakGpu} = modules()('lib/map/three/quality.ts');
  for (const gpu of ['ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)', 'Mali-G57 MC2', 'Mali-G57 MC3', 'Mali-T830 MP2', 'Mali-400 MP', 'ANGLE (Qualcomm, Adreno (TM) 610, OpenGL ES 3.2)', 'Adreno (TM) 506', 'PowerVR Rogue GE8320'])
    assert.equal(weakGpu(gpu), true, gpu);
  for (const gpu of ['ANGLE (ARM, Mali-G68 MC4, OpenGL ES 3.2)', 'Mali-G76 MP12', 'Mali-G710 MC10', 'Mali-G615 MC6', 'ANGLE (Qualcomm, Adreno (TM) 640, OpenGL ES 3.2)', 'Adreno (TM) 730', 'Apple GPU', ''])
    assert.equal(weakGpu(gpu), false, gpu);
});

test('refresh period is learnt from agreeing frames, not from a lone odd one', () => {
  const {refreshPeriod} = modules()('lib/map/pacing.ts');
  const near = (a, b) => Math.abs(a - b) < .2;
  assert.ok(near(refreshPeriod([...Array(30).fill(11.1), 5.6], 16.7), 11.1), 'an outlier is ignored (90 Hz)');
  assert.ok(near(refreshPeriod(Array(40).fill(16.7), 11.1), 16.7), 'follows a switch to 60 Hz');
  assert.ok(near(refreshPeriod([...Array(20).fill(22.2), ...Array(12).fill(11.1), ...Array(8).fill(33.3)], 16.7), 11.1), 'skipped frames do not hide the real period');
  assert.equal(refreshPeriod([8.3, 8.4], 16.7), 16.7, 'too few samples: keep the previous estimate');
});
