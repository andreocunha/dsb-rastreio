import * as T from 'three';
import type {GeoPoint,MapState} from '../types';
import type {projection} from './geography';

type P={x:number;z:number};

/** Polyline as a ribbon whose width is expanded in the vertex shader, in screen pixels. */
function ribbon(points:P[],closed=false){
  const pts=closed?[...points,points[0]]:points;
  const positions:number[]=[],miter:number[]=[],side:number[]=[],dist:number[]=[],index:number[]=[];
  let along=0;
  for(let i=0;i<pts.length;i++){
    const p=pts[i];
    if(i)along+=Math.hypot(p.x-pts[i-1].x,p.z-pts[i-1].z);
    const prev=pts[i-1]??(closed?pts[pts.length-2]:null),next=pts[i+1]??(closed?pts[1]:null);
    const dirs:P[]=[];
    if(prev){const l=Math.hypot(p.x-prev.x,p.z-prev.z)||1;dirs.push({x:(p.x-prev.x)/l,z:(p.z-prev.z)/l});}
    if(next){const l=Math.hypot(next.x-p.x,next.z-p.z)||1;dirs.push({x:(next.x-p.x)/l,z:(next.z-p.z)/l});}
    const t=dirs.reduce((a,d)=>({x:a.x+d.x,z:a.z+d.z}),{x:0,z:0});
    const tl=Math.hypot(t.x,t.z)||1,nx=-t.z/tl,nz=t.x/tl;
    // Miter length, clamped so sharp turns never spike.
    const d0=dirs[0]??{x:1,z:0},dot=Math.abs(nx*-d0.z+nz*d0.x)||1,m=Math.min(2.2,1/dot);
    for(const s of [-1,1]){positions.push(p.x,0,p.z);miter.push(nx*m,nz*m);side.push(s);dist.push(along);}
    if(i){const a=(i-1)*2;index.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  g.setAttribute('aMiter',new T.Float32BufferAttribute(miter,2));
  g.setAttribute('aSide',new T.Float32BufferAttribute(side,1));
  g.setAttribute('aDist',new T.Float32BufferAttribute(dist,1));
  g.setAttribute('aDir',new T.Float32BufferAttribute(new Float32Array(side.length*2),2));
  g.setIndex(index);
  return g;
}

/**
 * One quad per segment, so the along-the-line coordinate is exact across the whole width:
 * marks drawn on it stay perpendicular. Neighbouring quads share a mitred edge at each
 * vertex, so the path reads as one continuous line with clean corners.
 */
function segments(points:P[]){
  const pts=points.filter((p,i)=>!i||Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z)>=.01);
  const dirs=pts.slice(1).map((b,i)=>{const a=pts[i],l=Math.hypot(b.x-a.x,b.z-a.z);return {x:(b.x-a.x)/l,z:(b.z-a.z)/l,l};});
  // Offset direction at each vertex: the bisector of both neighbours, scaled so the edges
  // stay half a width from each segment (clamped so sharp turns never spike).
  const miters=pts.map((_,i)=>{
    const a=dirs[i-1]??dirs[i],b=dirs[i]??dirs[i-1];
    let nx=-(a.z+b.z),nz=a.x+b.x;const l=Math.hypot(nx,nz);
    if(l<1e-6){nx=-b.z;nz=b.x;}else{nx/=l;nz/=l;}
    const m=Math.min(3,1/Math.max(1e-3,nx*-b.z+nz*b.x));
    return [nx*m,nz*m] as const;
  });
  const positions:number[]=[],miter:number[]=[],side:number[]=[],dist:number[]=[],dir:number[]=[],index:number[]=[];
  let along=0;
  dirs.forEach((d,i)=>{
    const base=positions.length/3;
    for(const [j,at] of [[i,along],[i+1,along+d.l]] as const)for(const s of [-1,1]){
      positions.push(pts[j].x,0,pts[j].z);miter.push(...miters[j]);side.push(s);dist.push(at);dir.push(d.x,d.z);
    }
    index.push(base,base+1,base+2,base+1,base+3,base+2);
    along+=d.l;
  });
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  g.setAttribute('aMiter',new T.Float32BufferAttribute(miter,2));
  g.setAttribute('aSide',new T.Float32BufferAttribute(side,1));
  g.setAttribute('aDist',new T.Float32BufferAttribute(dist,1));
  g.setAttribute('aDir',new T.Float32BufferAttribute(dir,2));
  g.setIndex(index);
  return g;
}

const ribbonVertex=`attribute vec2 aMiter,aDir;attribute float aSide,aDist;
uniform float pixelAngle,widthPx,lift;varying float vSide,vDist,vMpp;
void main(){vSide=aSide;vec4 w=modelMatrix*vec4(position,1.);
float mpp=length(cameraPosition-w.xyz)*pixelAngle;vMpp=mpp;
// Distance along the segment of the offset vertex itself: exact on mitred corners too.
vec2 offset=aMiter*aSide*widthPx*.5*mpp;vDist=aDist+dot(offset,aDir);
w.xz+=offset;w.y+=lift;
gl_Position=projectionMatrix*viewMatrix*w;}`;

const common=`precision highp float;uniform float time,mpp,dim;uniform vec3 color;varying float vSide,vDist,vMpp;`;
const routeFragment=`${common}uniform float widthPx;
// One small chevron anchored to the line (metres), constant size on screen.
float arrow(float along,float y,float spacing){
  float x=(mod(along+spacing*.5,spacing)-spacing*.5)/vMpp;
  float halfWidth=5.*clamp((4.5-x)/9.,0.,1.);
  float d=max(max(-4.5-x,x-4.5),(abs(y)-halfWidth)*.9);
  return 1.-smoothstep(-.5,.5,d);
}
void main(){
  float y=vSide*widthPx*.5,e=fwidth(y);
  float core=1.-smoothstep(1.6-e,1.6+e,abs(y));
  float halo=(1.-smoothstep(2.,3.8,abs(y)))*.3;
  // Spacing snaps to powers of two in metres (~140 px apart): arrows never slide when
  // zooming; half of them fade in or out between levels.
  float level=log2(140.*vMpp),l0=floor(level),k=smoothstep(.15,.85,level-l0);
  float fine=exp2(l0),coarse=fine*2.;
  float a=max(arrow(vDist,y,coarse),arrow(vDist,y,fine)*(1.-k));
  vec3 line=mix(color,vec3(1.),.2);
  vec3 col=mix(vec3(.02,.09,.10),line,core);
  col=mix(col,vec3(1.),a*.8);
  gl_FragColor=vec4(col*dim,max(max(halo,core*.85),a*.7));
  #include <colorspace_fragment>
}`;
const finishFragment=`${common}
void main(){
  float v=abs(vSide);
  float idx=floor(vDist/(mpp*8.)),row=step(0.,vSide);
  float check=mod(idx+row,2.);
  float border=smoothstep(.82,.9,v);
  vec3 col=mix(vec3(.97),vec3(.07),check);
  col=mix(col,vec3(.03,.08,.09),border);
  gl_FragColor=vec4(col*dim,.96);
  #include <colorspace_fragment>
}`;
const outlineFragment=`${common}
void main(){
  float v=abs(vSide);
  float halo=(1.-smoothstep(.5,1.,v))*.3;
  float core=1.-smoothstep(.3,.45,v);
  vec3 col=mix(vec3(.03,.08,.09),color,core);
  gl_FragColor=vec4(col*dim,max(halo,core*.9));
  #include <colorspace_fragment>
}`;
const fillVertex=`varying vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
const fillFragment=`precision highp float;uniform float mpp,dim;uniform vec3 color;varying vec3 vWorld;
void main(){gl_FragColor=vec4(color*dim,.16);
#include <colorspace_fragment>
}`;

// Floating markers: the tall orange inflatable used on the course, and the pink finish cube.
const buoyGeometry=(()=>{
  const profile=[new T.Vector2(0,-.35),new T.Vector2(.82,-.35),new T.Vector2(.85,.2),new T.Vector2(.84,1.35),new T.Vector2(.72,1.62),new T.Vector2(.4,1.74),new T.Vector2(0,1.76)];
  return new T.LatheGeometry(profile,24);
})();
const numbers=new Map<number,T.CanvasTexture>();
/** Buoy number painted in white on the top of the float, read from above. */
function numberTexture(n:number){
  let texture=numbers.get(n);if(texture)return texture;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d')!;
  ctx.font=`900 ${n>9?76:96}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign='center';ctx.textBaseline='middle';
  // White figure painted on the orange top; a soft dark edge keeps it crisp when small.
  ctx.lineJoin='round';ctx.lineWidth=10;ctx.strokeStyle='rgba(120,30,0,.45)';ctx.strokeText(String(n),64,70);
  ctx.fillStyle='#ffffff';ctx.fillText(String(n),64,70);
  texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;numbers.set(n,texture);
  return texture;
}
const discGeometry=new T.CircleGeometry(.72,32).rotateX(-Math.PI/2);
const cubeGeometry=new T.BoxGeometry(1.25,1.25,1.25,1,1,1);
const buoyFxVertex=`varying vec2 vLocal;void main(){vLocal=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const buoyFxFragment=`precision highp float;uniform float time,phase,shade;uniform vec2 offset;varying vec2 vLocal;
void main(){float r=length(vLocal);
  // One slow, faint ring: the float sits calmly on the water.
  float t=fract(time*.2+phase);float ripple=smoothstep(.06,0.,abs(r-(.34+t*.55)))*pow(1.-t,1.5)*.2;
  float contact=smoothstep(.36,.31,r)*smoothstep(.22,.31,r)*.3;
  float s=smoothstep(.42,.12,length(vLocal-offset))*shade;
  float a=max(max(ripple,contact),s);
  gl_FragColor=vec4(mix(vec3(0.,.05,.06),vec3(.96,1.,.98),max(ripple,contact)/(a+.001)),a);
  #include <colorspace_fragment>
}`;

/** Text painted on the water, beneath the boats. Sized in screen pixels each frame. */
interface Decal {mesh:T.Mesh<T.PlaneGeometry,T.MeshBasicMaterial>;centre:P;normal:P;dir:P;aspect:number;px:number;gap:number}
function textTexture(text:string,color:string){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
  const font='800 64px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.font=font;ctx.letterSpacing='14px';
  const width=Math.ceil(ctx.measureText(text).width)+40;
  canvas.width=width;canvas.height=110;
  ctx.font=font;ctx.letterSpacing='14px';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.shadowColor='rgba(0,25,28,.55)';ctx.shadowBlur=10;ctx.shadowOffsetY=3;
  ctx.fillStyle=color;ctx.fillText(text,width/2+7,57);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
  return {texture,aspect:width/110};
}

interface Marker {group:T.Group;model:T.Mesh;fx:T.Mesh<T.PlaneGeometry,T.ShaderMaterial>;phase:number;disc?:T.Mesh}

export class Course {
  readonly root=new T.Group();
  private key='';
  private uniforms={time:{value:0},mpp:{value:1},pixelAngle:{value:.001},dim:{value:1}};
  private markers:Marker[]=[];
  private decals:Decal[]=[];
  private orange=new T.MeshLambertMaterial({color:'#ff5b1f',transparent:true});
  private pink=new T.MeshLambertMaterial({color:'#ef2f7d',transparent:true});
  private band=new T.MeshLambertMaterial({color:'#fff6ee',transparent:true});
  private fxGeometry=new T.PlaneGeometry(4.6,4.6).rotateX(-Math.PI/2);

  update(state:MapState,project:ReturnType<typeof projection>){
    const key=JSON.stringify([state.buoys,state.routes,state.finishLine,state.maintenanceArea,state.waitingArea,state.courseId]);
    if(key===this.key)return;this.key=key;this.clear();
    const to=(p:GeoPoint)=>project.point(p.lat,p.lon);
    const line=(points:P[],fragment:string,widthPx:number,color:string,order:number,closed=false,lift=0,split=false)=>{
      const mesh=new T.Mesh(split?segments(points):ribbon(points,closed),new T.ShaderMaterial({vertexShader:ribbonVertex,fragmentShader:fragment,transparent:true,depthWrite:false,depthTest:false,
        uniforms:{...this.uniforms,widthPx:{value:widthPx},lift:{value:lift},color:{value:new T.Color(color)}}}));
      mesh.renderOrder=order;mesh.frustumCulled=false;this.root.add(mesh);
    };
    const area=(points:GeoPoint[],name:string,color:string)=>{
      if(points.length<3)return;
      const pts=points.map(to),shape=new T.Shape(pts.map(p=>new T.Vector2(p.x,-p.z)));
      const geometry=new T.ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);
      const fill=new T.Mesh(geometry,new T.ShaderMaterial({vertexShader:fillVertex,fragmentShader:fillFragment,transparent:true,depthWrite:false,depthTest:false,
        uniforms:{...this.uniforms,color:{value:new T.Color(color)}}}));
      fill.renderOrder=1;fill.frustumCulled=false;this.root.add(fill);
      line(pts,outlineFragment,5,color,2,true);
      this.decal(name,color,{x:pts.reduce((s,p)=>s+p.x,0)/pts.length,z:pts.reduce((s,p)=>s+p.z,0)/pts.length},{x:1,z:0},{x:0,z:1},11,0);
    };
    area(state.maintenanceArea,'APOIO','#ffc94d');
    if(['match-race','slalom'].includes(state.courseId))area(state.waitingArea,'ESPERA','#bfe0ff');
    for(const route of state.routes)if(route.points.length>=2)line(route.points.map(to),routeFragment,13,route.color,3,false,0,true);
    const {p1,p2}=state.finishLine;
    if(p1&&p2){
      line([to(p1),to(p2)],finishFragment,12,'#ffffff',4);
      for(const p of [p1,p2])this.marker(to(p),'finish');
      const a=to(p1),b=to(p2),l=Math.hypot(b.x-a.x,b.z-a.z)||1;
      // Text runs along the line and always reads upright on a north-up map.
      let dir={x:(b.x-a.x)/l,z:(b.z-a.z)/l};if(dir.x<0)dir={x:-dir.x,z:-dir.z};
      // Put the text on the side of the line away from nearby buoys.
      let normal={x:-dir.z,z:dir.x};
      const centre={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
      const pull=state.buoys.map(to).reduce((sum,q)=>{const dx=q.x-centre.x,dz=q.z-centre.z,d=Math.hypot(dx,dz);return d<120?sum+(dx*normal.x+dz*normal.z)/(d+10):sum;},0);
      if(pull>0||(pull===0&&normal.z<0))normal={x:-normal.x,z:-normal.z};
      this.decal('CHEGADA','#ffffff',{x:(a.x+b.x)/2,z:(a.z+b.z)/2},dir,normal,12,15);
    }
    for(const buoy of state.buoys)this.marker(to(buoy),'buoy',buoy.number);
  }
  private decal(text:string,color:string,centre:P,dir:P,normal:P,px:number,gap:number){
    const {texture,aspect}=textTexture(text,color);
    const geometry=new T.PlaneGeometry(1,1);geometry.rotateX(-Math.PI/2);
    const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
    mesh.rotation.y=-Math.atan2(dir.z,dir.x);mesh.renderOrder=5;mesh.frustumCulled=false;
    this.root.add(mesh);this.decals.push({mesh,centre,normal,dir,aspect,px,gap});
  }
  private marker(p:P,kind:'buoy'|'finish',number=0){
    const group=new T.Group();group.position.set(p.x,0,p.z);
    let model:T.Mesh,discRef:T.Mesh|undefined;
    if(kind==='buoy'){
      model=new T.Mesh(buoyGeometry,this.orange);
      const disc=new T.Mesh(discGeometry,new T.MeshBasicMaterial({map:numberTexture(number),transparent:true,toneMapped:false}));
      disc.position.y=1.78;disc.renderOrder=21;model.add(disc);discRef=disc;
    }
    else{
      model=new T.Mesh(cubeGeometry,this.pink);model.position.y=.4;
      const band=new T.Mesh(new T.BoxGeometry(1.27,.22,1.27),this.band);band.position.y=.25;model.add(band);
    }
    model.renderOrder=20;group.add(model);
    const fx=new T.Mesh(this.fxGeometry,new T.ShaderMaterial({vertexShader:buoyFxVertex,fragmentShader:buoyFxFragment,transparent:true,depthWrite:false,depthTest:false,
      uniforms:{time:this.uniforms.time,phase:{value:Math.random()},shade:{value:.3},offset:{value:new T.Vector2()}}}));
    fx.position.y=.06;fx.renderOrder=7;group.add(fx);
    this.root.add(group);
    this.markers.push({group,model,fx,phase:(p.x*.13+p.z*.07)%6.28,disc:discRef});
  }
  /** Per frame: pixel-constant widths, gentle bobbing and exaggerated size when zoomed out. */
  frame(time:number,mpp:number,pixelAngle:number,scale:number,reducedMotion:boolean,shadow:T.Vector2,night:number,heading=0){
    const yaw=heading*Math.PI/180,right={x:Math.cos(yaw),z:Math.sin(yaw)};
    this.uniforms.time.value=reducedMotion?0:time/1000;this.uniforms.mpp.value=mpp;this.uniforms.pixelAngle.value=pixelAngle;
    this.uniforms.dim.value=1-night*.18;
    for(const d of this.decals){
      const h=d.px*1.7*mpp,offset=(d.gap+d.px)*mpp;
      d.mesh.scale.set(h*d.aspect,1,h);
      // Keep text reading left-to-right on a rotated map.
      const flip=d.dir.x*right.x+d.dir.z*right.z<0;
      d.mesh.rotation.y=-Math.atan2(d.dir.z,d.dir.x)+(flip?Math.PI:0);
      d.mesh.position.set(d.centre.x+d.normal.x*offset,.04,d.centre.z+d.normal.z*offset);
      d.mesh.material.opacity=1-night*.25;
    }
    for(const m of this.markers){
      m.group.scale.setScalar(scale);
      const t=reducedMotion?0:time/1000+m.phase;
      m.model.position.y=(m.model.geometry===cubeGeometry?.4:0)+Math.sin(t*.9)*.05;
      m.model.rotation.x=Math.sin(t*.7)*.035;m.model.rotation.z=Math.cos(t*.6)*.035;
      m.fx.material.uniforms.offset.value.set(shadow.x/4.6*2,shadow.y/4.6*2);
      m.fx.material.uniforms.shade.value=.32*(1-night*.7);
      // Buoy numbers stay upright on screen whatever the bearing.
      if(m.disc)m.disc.rotation.y=-yaw;
    }
  }
  private clear(){
    this.root.traverse(o=>{if(o instanceof T.Mesh){if(o.geometry!==buoyGeometry&&o.geometry!==cubeGeometry&&o.geometry!==discGeometry&&o.geometry!==this.fxGeometry)o.geometry.dispose();const m=o.material as T.Material;if(m!==this.orange&&m!==this.pink&&m!==this.band)m.dispose();}});
    for(const d of this.decals)d.mesh.material.map?.dispose();
    this.root.clear();this.markers=[];this.decals=[];
  }
  dispose(){this.clear();this.orange.dispose();this.pink.dispose();this.band.dispose();this.fxGeometry.dispose();}
}
