import type {WorldPoint} from '../types';

/** 3D camera: vertical field of view, and its tilt above the horizon when no boat is followed (degrees). */
export const FOV=30,OVERHEAD_PITCH=74;

/**
 * Ground seen by the opening 3D camera (north up, at OVERHEAD_PITCH), as world coordinates of the
 * four screen corners. Plain maths, so the engine can ask for the satellite imagery of that view
 * while the 3D code itself is still downloading.
 */
export function overheadCorners(view:{worldCX:number;worldCY:number;zoom:number;width:number;height:number},tileSize:number):WorldPoint[]{
  const half=Math.tan(FOV*Math.PI/360),pitch=OVERHEAD_PITCH*Math.PI/180,sin=Math.sin(pitch),cos=Math.cos(pitch);
  const distance=view.height/(2**view.zoom*tileSize)/(2*half),aspect=view.width/view.height;
  return [[-1,1],[1,1],[1,-1],[-1,-1]].map(([nx,ny])=>{
    // Ray through the corner, from a camera south of the centre looking north and down, down to the ground.
    const t=sin*distance/(sin-ny*half*cos);
    return {x:view.worldCX+t*nx*half*aspect,y:view.worldCY+cos*distance-t*(cos+ny*half*sin)};
  });
}

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
