import * as T from 'three';
import imboassica from '../data/imboassica-water.json';
import vitoria from '../data/vitoria-water.json';
import type {projection} from './geography';

export const waterData=(venueId:string)=>venueId==='vitoria-test'?vitoria:imboassica;
/** Signed distances are stored as sign·sqrt(|d|/RANGE): sub-metre precision at the shore. */
export const FIELD_RANGE=260;

/** 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f:Float32Array,n:number,d:Float32Array,v:Int32Array,z:Float32Array){
  let k=0;v[0]=0;z[0]=-1e20;z[1]=1e20;
  for(let q=1;q<n;q++){
    let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);
    while(s<=z[k]){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*q-2*v[k]);}
    k++;v[k]=q;z[k]=s;z[k+1]=1e20;
  }
  k=0;
  for(let q=0;q<n;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])*(q-v[k])+f[v[k]];}
}
/** Distance, in pixels, from every pixel to the nearest pixel where `target` is true. */
export function distanceField(target:Uint8Array,width:number,height:number){
  const out=new Float32Array(width*height),n=Math.max(width,height);
  const f=new Float32Array(n),d=new Float32Array(n),v=new Int32Array(n),z=new Float32Array(n+1);
  for(let i=0;i<out.length;i++)out[i]=target[i]?0:1e20;
  for(let x=0;x<width;x++){
    for(let y=0;y<height;y++)f[y]=out[y*width+x];
    edt1d(f,height,d,v,z);for(let y=0;y<height;y++)out[y*width+x]=d[y];
  }
  for(let y=0;y<height;y++){
    const row=y*width;f.set(out.subarray(row,row+width));
    edt1d(f,width,d,v,z);for(let x=0;x<width;x++)out[row+x]=Math.sqrt(d[x]);
  }
  return out;
}

export interface WaterField {
  texture:T.DataTexture;
  /** World rectangle covered by the field: minX, minZ, sizeX, sizeZ (metres). */
  bounds:T.Vector4;
  /** Positive metres inside water, negative on land. */
  distance(x:number,z:number):number;
  dispose():void;
}

/**
 * R: signed distance to the shoreline; G: open sea (vs. lagoon).
 * Rasterised once per venue from the satellite-traced polygons.
 */
export function waterField(venueId:string,project:ReturnType<typeof projection>,low:boolean):WaterField{
  const data=waterData(venueId),[west,south,east,north]=data.bounds;
  const a=project.point(north,west),b=project.point(south,east);
  const sizeX=b.x-a.x,sizeZ=b.z-a.z;
  const long=low?1536:2048,width=sizeX>=sizeZ?long:Math.round(long*sizeX/sizeZ),height=sizeX>=sizeZ?Math.round(long*sizeZ/sizeX):long;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  const draw=(polygons:number[][][],color:string)=>{
    ctx.fillStyle=color;ctx.beginPath();
    for(const polygon of polygons)polygon.forEach(([lon,lat],i)=>{
      const p=project.point(lat,lon),x=(p.x-a.x)/sizeX*width,y=(p.z-a.z)/sizeZ*height;
      if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
    });
    ctx.fill('evenodd');
  };
  ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
  draw(data.lagoon,'#f00');draw(data.ocean,'#ff0');
  const pixels=ctx.getImageData(0,0,width,height).data;
  const wet=new Uint8Array(width*height),dry=new Uint8Array(width*height),sea=new Uint8Array(width*height);
  for(let i=0;i<wet.length;i++){wet[i]=pixels[i*4]>127?1:0;dry[i]=1-wet[i];sea[i]=pixels[i*4+1]>127?1:0;}
  const toShore=distanceField(dry,width,height),toWater=distanceField(wet,width,height);
  const metres=sizeX/width,signed=new Float32Array(width*height);
  // Near the shore, replace the pixel-stepped distance with the exact distance to the
  // traced polygon edges, so the waterline stays smooth when zoomed in.
  const BAND=4,CELL=8,cols=Math.ceil(width/CELL),rows=Math.ceil(height/CELL);
  const buckets=new Map<number,number[]>(),segments:number[]=[];
  for(const polygon of [...data.lagoon,...data.ocean]){
    const pts=polygon.map(([lon,lat])=>{const q=project.point(lat,lon);return [(q.x-a.x)/sizeX*width,(q.z-a.z)/sizeZ*height];});
    for(let i=0;i<pts.length;i++){
      const [x1,y1]=pts[i],[x2,y2]=pts[(i+1)%pts.length],id=segments.length/4;
      segments.push(x1,y1,x2,y2);
      const c0=Math.max(0,Math.floor((Math.min(x1,x2)-BAND)/CELL)),c1=Math.min(cols-1,Math.floor((Math.max(x1,x2)+BAND)/CELL));
      const r0=Math.max(0,Math.floor((Math.min(y1,y2)-BAND)/CELL)),r1=Math.min(rows-1,Math.floor((Math.max(y1,y2)+BAND)/CELL));
      for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){const k=r*cols+c;let list=buckets.get(k);if(!list)buckets.set(k,list=[]);list.push(id);}
    }
  }
  const exact=(px:number,py:number)=>{
    const list=buckets.get(Math.floor(py/CELL)*cols+Math.floor(px/CELL));if(!list)return Infinity;
    let best=Infinity;
    for(const id of list){
      const x1=segments[id*4],y1=segments[id*4+1],dx=segments[id*4+2]-x1,dy=segments[id*4+3]-y1;
      const l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/l)):0;
      best=Math.min(best,Math.hypot(px-x1-dx*t,py-y1-dy*t));
    }
    return best;
  };
  const bytes=new Uint8Array(width*height*4);
  for(let i=0;i<wet.length;i++){
    // Half-pixel offset: the shoreline sits between the last wet and first dry pixel.
    let d=(wet[i]?toShore[i]-.5:-(toWater[i]-.5))*metres;
    if(Math.abs(d)<BAND*metres){const e=exact(i%width+.5,Math.floor(i/width)+.5);if(e<BAND+1)d=Math.sign(d||1)*e*metres;}
    signed[i]=d;
    const e=Math.sign(d)*Math.sqrt(Math.min(1,Math.abs(d)/FIELD_RANGE));
    bytes[i*4]=Math.round((e*.5+.5)*255);bytes[i*4+1]=sea[i]*255;bytes[i*4+3]=255;
  }
  // Soften the lagoon/sea flag so colour transitions never show pixel steps.
  const texture=new T.DataTexture(bytes,width,height,T.RGBAFormat);
  texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;texture.generateMipmaps=false;
  texture.wrapS=texture.wrapT=T.ClampToEdgeWrapping;texture.needsUpdate=true;
  return {texture,bounds:new T.Vector4(a.x,a.z,sizeX,sizeZ),
    distance(x,z){
      const px=Math.floor((x-a.x)/sizeX*width),py=Math.floor((z-a.z)/sizeZ*height);
      if(px<0||py<0||px>=width||py>=height)return -FIELD_RANGE;
      return signed[py*width+px];
    },
    dispose(){texture.dispose();}};
}
