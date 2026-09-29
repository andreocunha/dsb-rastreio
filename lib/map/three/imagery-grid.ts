import type {WorldPoint} from '../types';

/** Web Mercator tiles, with a hard download/texture budget for the visible ground. */
export function imageryGrid(corners:WorldPoint[],preferredZoom:number){
  const west=Math.min(...corners.map(p=>p.x)),east=Math.max(...corners.map(p=>p.x));
  const north=Math.max(0,Math.min(...corners.map(p=>p.y))),south=Math.min(1-Number.EPSILON,Math.max(...corners.map(p=>p.y)));
  let z=Math.max(0,Math.min(18,Math.floor(preferredZoom)));
  for(;;){
    const n=2**z,x0=Math.floor(west*n),x1=Math.floor(east*n),y0=Math.floor(north*n),y1=Math.floor(south*n);
    if((x1-x0+1)*(y1-y0+1)<=48||z===0)return {z,n,x0,x1,y0,y1};
    z--;
  }
}
