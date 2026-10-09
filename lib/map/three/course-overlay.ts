import type {GeoPoint,MapState,ScreenPoint} from '../types';
import {editHandles} from '../editing';

/**
 * Lines, areas, markers and on-water text are drawn in WebGL beneath the boats.
 * The overlay only shows the organizer's edit handles, so editing works in 3D too.
 */
export function courseOverlay(ctx:CanvasRenderingContext2D,state:MapState,project:(p:GeoPoint)=>ScreenPoint){
  ctx.clearRect(0,0,state.width,state.height);
  if(!state.editTool)return;
  for(const {point,routeId} of editHandles(state)){
    const p=project(point);
    if(p.x<-20||p.y<-20||p.x>state.width+20||p.y>state.height+20)continue;
    // Only the selected route is at full strength: it is the one the buttons act on.
    ctx.globalAlpha=routeId&&routeId!==state.activeRouteId?.4:1;
    ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fillStyle='#fffff7';ctx.fill();
    ctx.strokeStyle='#256d5a';ctx.lineWidth=2.5;ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fillStyle='#256d5a';ctx.fill();
  }
  ctx.globalAlpha=1;
}
