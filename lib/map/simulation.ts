import type { Boat, GeoPoint, MapState, Route } from './types';
import { bearing } from './geo';
import { WAITING_AREA, MAINTENANCE_AREA } from './courses';
import geography from './data/imboassica.json';

const METERS_LAT = 111320;
const METERS_LON = METERS_LAT * Math.cos(22.414 * Math.PI / 180);
const lake = geography.features.find(f => f.id === 132616186)!.points.map(([lon, lat]) => ({lat, lon}));
export const distanceMeters = (a: GeoPoint, b: GeoPoint) => Math.hypot((b.lon - a.lon) * METERS_LON, (b.lat - a.lat) * METERS_LAT);
const offset = (p: GeoPoint, east: number, north: number): GeoPoint => ({lat: p.lat + north / METERS_LAT, lon: p.lon + east / METERS_LON});
export function insideArea(p: GeoPoint, area: GeoPoint[]) {
  let inside = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const a = area[i], b = area[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}
function safeCircle(p: GeoPoint, area: GeoPoint[], radius: number) {
  return insideArea(p, area) && [[radius,0],[-radius,0],[0,radius],[0,-radius]].every(([x,y]) => insideArea(offset(p,x,y),area));
}
function bounds(points: GeoPoint[]) {
  return points.reduce((b,p) => ({west:Math.min(b.west,p.lon),east:Math.max(b.east,p.lon),south:Math.min(b.south,p.lat),north:Math.max(b.north,p.lat)}), {west:Infinity,east:-Infinity,south:Infinity,north:-Infinity});
}
function center(points: GeoPoint[]) {
  return {lat: points.reduce((s,p)=>s+p.lat,0)/points.length, lon: points.reduce((s,p)=>s+p.lon,0)/points.length};
}
/** Choose spaced berths inside the editable waiting polygon. */
function waitingSlots(area: GeoPoint[], count: number) {
  const polygon = area.length >= 3 ? area : WAITING_AREA;
  const b = bounds(polygon), candidates: GeoPoint[] = [];
  for (let y=1;y<16;y++) for (let x=1;x<16;x++) {
    const p={lat:b.south+(b.north-b.south)*y/16,lon:b.west+(b.east-b.west)*x/16};
    if (safeCircle(p,polygon,2)) candidates.push(p);
  }
  const slots: GeoPoint[] = [];
  for (let i=0;i<count;i++) {
    const target={lon:b.west+(b.east-b.west)*(i%2 ? .7 : .3),lat:b.north-(b.north-b.south)*(Math.floor(i/2)+1)/4};
    const available=candidates.filter(p=>slots.every(q=>distanceMeters(p,q)>13));
    available.sort((a,b)=>distanceMeters(a,target)-distanceMeters(b,target));
    slots.push(available[0] ?? candidates[i % candidates.length] ?? center(polygon));
  }
  return slots;
}
export function distanceToRoutes(point: GeoPoint, routes: Route[]) {
  let nearest=Infinity;
  for (const route of routes) for(let i=0;i<route.points.length;i++) {
    const a=route.points[i], b=route.points[(i+1)%route.points.length];
    const x=(point.lon-a.lon)*METERS_LON, y=(point.lat-a.lat)*METERS_LAT;
    const dx=(b.lon-a.lon)*METERS_LON, dy=(b.lat-a.lat)*METERS_LAT;
    const length=dx*dx+dy*dy, t=length ? Math.max(0,Math.min(1,(x*dx+y*dy)/length)) : 0;
    nearest=Math.min(nearest,Math.hypot(x-dx*t,y-dy*t));
  }
  return nearest;
}
/** Patrol locations are selected once, outside race lanes and on the lake. */
function patrolSlots(state: MapState) {
  const routePoints=state.routes.flatMap(r=>r.points);
  const b=bounds(routePoints.length ? routePoints : MAINTENANCE_AREA);
  const targets=[{lat:(b.north+b.south)/2,lon:b.east+.0004},{lat:b.south,lon:b.west},{lat:b.north,lon:b.west}];
  const candidates: GeoPoint[]=[];
  for(let lat=-22.4163;lat< -22.406;lat+=.00045) for(let lon=-41.836;lon< -41.8128;lon+=.00055) {
    const p={lat,lon};
    if (distanceToRoutes(p,state.routes)<35 || state.buoys.some(b=>distanceMeters(p,b)<30) || state.routes.some(r=>insideArea(p,r.points)) || insideArea(p,state.waitingArea) || insideArea(p,state.maintenanceArea)) continue;
    if (safeCircle(p,lake,9)) candidates.push(p);
  }
  const result: GeoPoint[]=[];
  for(const target of targets) {
    const available=candidates.filter(p=>result.every(q=>distanceMeters(p,q)>45));
    available.sort((a,b)=>distanceMeters(a,target)-distanceMeters(b,target));
    result.push(available[0] ?? center(MAINTENANCE_AREA));
  }
  return result;
}
function turn(boat: Boat, heading: number, dt: number) {
  heading=(heading%360+360)%360;
  boat.headingTarget=heading;
  const diff=((heading-boat.heading+540)%360)-180;
  boat.heading=(boat.heading+diff*(1-Math.exp(-dt/300))+360)%360;
}
function idle(boat: Boat, anchor: GeoPoint, time: number, dt: number, support: boolean) {
  const radius=support ? 5 : .7, seconds=support ? 100 : 80;
  const phase=time/1000/seconds*Math.PI*2+boat.speedPhaseOffset;
  const p=offset(anchor,Math.cos(phase)*radius,Math.sin(phase)*radius);
  boat.lat=p.lat; boat.lon=p.lon;
  boat.speed=radius*2*Math.PI/seconds/.514444;
  turn(boat,(360-phase*180/Math.PI)%360,dt);
}

/** Pure local demo: roles are separate from race paths, no GPS or network involved. */
export function createSimulation(state: MapState) {
  const slots=waitingSlots(state.waitingArea,6), patrol=patrolSlots(state);
  const competitors=state.boats.filter(b=>b.type!=='jetski' && b.type!=='support');
  const maxRacing=state.courseId==='match-race' ? 2 : state.courseId==='slalom' ? 1 : competitors.length;
  const paths=state.routes.map(route => {
    const lengths=route.points.map((p,i)=>distanceMeters(p,route.points[(i+1)%route.points.length]));
    const cumulative=[0]; for(const length of lengths) cumulative.push(cumulative[cumulative.length-1]+length);
    return {route,lengths,cumulative,total:cumulative[cumulative.length-1]};
  });
  const actors=state.boats.map(boat=>{
    const index=competitors.indexOf(boat), support=index<0;
    // Match Race assigns exactly one competitor to each of its first two lanes.
    const path=paths[index % Math.max(1,paths.length)];
    const racing=!support && index<maxRacing && !!path && path.total>.01 && (state.courseId!=='match-race' || index<paths.length);
    boat.activity=support ? 'support' : racing ? 'racing' : 'waiting';
    boat.raceRouteId=racing ? path.route.id : null;
    boat.trail=[];
    return {boat,path:racing ? path : null,distance:racing && maxRacing>2 ? path.total*index/competitors.length : 0,
      anchor:support ? patrol[Math.max(0,Number(boat.id.slice(1))-1)%patrol.length] : slots[index]};
  });
  function tick(dt: number) {
    for(const actor of actors) {
      const {boat,path}=actor;
      if (!path) { idle(boat,actor.anchor,state.animationTime,dt,boat.activity==='support'); continue; }
      boat.speed=Math.max(1,boat.baseSpeed+Math.sin(state.animationTime/3000+boat.speedPhaseOffset)*1.2);
      actor.distance=(actor.distance+boat.speed*.514444*dt/1000)%path.total;
      let index=0;
      while(index<path.lengths.length-1 && path.cumulative[index+1]<=actor.distance) index++;
      const a=path.route.points[index], b=path.route.points[(index+1)%path.route.points.length];
      const t=path.lengths[index] ? (actor.distance-path.cumulative[index])/path.lengths[index] : 0;
      boat.routeIndex=index; boat.routeT=t;
      boat.lat=a.lat+(b.lat-a.lat)*t; boat.lon=a.lon+(b.lon-a.lon)*t;
      turn(boat,bearing([a.lat,a.lon],[b.lat,b.lon]),dt);
    }
  }
  tick(0);
  return tick;
}
