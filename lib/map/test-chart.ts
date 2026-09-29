import geography from './data/vitoria-test.json';
import water from './data/vitoria-water.json';
import { geoToWorld, worldScale } from './geo';
import type { MapState, MapConfig } from './types';

const origin=geoToWorld(-20.265221,-40.260797), base=2**16*256;
let shapes: {kind:string; major:boolean; path:Path2D}[] | undefined;
function path(points:number[][],closed:boolean) {
  const p=new Path2D();points.forEach(([lon,lat],i)=>{const w=geoToWorld(lat,lon);const x=(w.x-origin.x)*base,y=(w.y-origin.y)*base;if(i===0)p.moveTo(x,y);else p.lineTo(x,y);});
  if(closed)p.closePath();return p;
}
function prepare() {
  if(shapes)return;
  shapes=geography.features.filter(f=>!['coastline','water'].includes(f.kind)).map(f=>({kind:f.kind,major:f.major,path:path(f.points,f.kind!=='road')}));
  // The shoreline is traced from the satellite imagery, not the OSM coastline.
  for(const p of water.ocean)shapes.push({kind:'sea',major:false,path:path(p,true)},{kind:'coastline',major:false,path:path(p,true)});
}
/** Bundled OSM geometry: the test venue also works offline, without tile requests. */
export function renderTestChart(ctx:CanvasRenderingContext2D,state:MapState,config:MapConfig) {
  prepare();const scale=worldScale(state.zoom,config.tileSize),f=scale/base;
  ctx.fillStyle='#edf0e4';ctx.fillRect(0,0,state.width,state.height);
  ctx.save();ctx.translate((origin.x-state.worldCX)*scale+state.width/2,(origin.y-state.worldCY)*scale+state.height/2);ctx.scale(f,f);ctx.lineJoin='round';ctx.lineCap='round';
  for(const s of shapes!) {
    if(s.kind==='road'||s.kind==='coastline'||s.kind==='sea')continue;
    ctx.fillStyle=({sea:'#b7d7d5',water:'#72b0a4',wood:'#d4e2cd',park:'#d4e2cd',wetland:'#ccddc8',beach:'#f4e8c9'} as Record<string,string>)[s.kind]??'#d9e3ce';ctx.fill(s.path);
  }
  for(const s of shapes!) {
    if(s.kind!=='road')continue;
    ctx.lineWidth=(s.major?7:3.5)/Math.sqrt(f);ctx.strokeStyle='#d6d9c9';ctx.stroke(s.path);
    ctx.lineWidth=(s.major?4.5:2)/Math.sqrt(f);ctx.strokeStyle='#fafaf2';ctx.stroke(s.path);
  }
  for(const s of shapes!)if(s.kind==='sea'){ctx.fillStyle='#b7d7d5';ctx.fill(s.path);}
  for(const s of shapes!)if(s.kind==='coastline'){ctx.strokeStyle='#f3e6c7';ctx.lineWidth=6/f;ctx.stroke(s.path);}
  ctx.restore();
  const x=(origin.x-state.worldCX)*scale+state.width/2,y=(origin.y-state.worldCY)*scale+state.height/2;
  ctx.save();ctx.fillStyle='#583b93';ctx.strokeStyle='white';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeText('LOCAL DE TESTE',x,y-17);ctx.fillText('LOCAL DE TESTE',x,y-17);ctx.restore();
}
