import * as T from 'three';
import type {BoatModel} from './boat';

// All boats in one draw: each instance carries its pose, its hull ellipses and its state.
const vertexShader=`attribute vec4 iPose,iShape,iMisc,iH0,iH1,iH2;
varying vec2 vLocal;varying vec4 vShape,vMisc,vH0,vH1,vH2;
void main(){
  // Boat-local metres (bow is −y here), as when this was a child of the boat model.
  vec2 local=position.xz*iShape.x;
  vLocal=vec2(local.x,local.y);vShape=iShape;vMisc=iMisc;vH0=iH0;vH1=iH1;vH2=iH2;
  float c=cos(iPose.z),s=sin(iPose.z);vec2 w=local*iPose.w;
  vec3 p=vec3(iPose.x+w.x*c+w.y*s,.08,iPose.y-w.x*s+w.y*c);
  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
}`;

// Shadow and selection halo, in boat-local metres (bow is −y here).
const fragmentShader=`precision highp float;
uniform float time,shadowStrength,night;uniform vec3 foam;
varying vec2 vLocal;varying vec4 vShape,vMisc,vH0,vH1,vH2;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float ellipse(vec2 p,vec4 h){vec2 q=(p-h.xy)/h.zw;return length(q);}
void main(){
  vec2 p=vec2(vLocal.x,vLocal.y),shadowOffset=vMisc.xy;
  float radius=vShape.y,selected=vShape.z,hullCount=vShape.w;
  float shade=0.;
  for(int i=0;i<3;i++){
    if(float(i)>=hullCount)break;
    vec4 h=i==0?vH0:i==1?vH1:vH2;
    float s=ellipse(p-shadowOffset,vec4(h.xy,h.z*1.25+.25,h.w*1.08+.2));
    shade=max(shade,smoothstep(1.25,.55,s));
  }
  // Selection halo.
  float ring=selected*smoothstep(.16,0.,abs(length(p)-radius-.25*sin(time*2.4)))*.8;
  vec3 color=foam;
  float alpha=ring;
  // Shadow darkens below the foam.
  gl_FragColor=vec4(mix(vec3(0.01,.05,.06),color,alpha/(alpha+shade*shadowStrength+.0001)),max(alpha,shade*shadowStrength*(1.-night*.7)));
  #include <colorspace_fragment>
}`;

const MAX_BOATS=64;
const ATTRIBUTES=['iPose','iShape','iMisc','iH0','iH1','iH2'] as const;

/** Soft shadows on the water and the selection halo of every boat, in a single draw call. */
export class BoatShadows {
  readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
  private geometry=new T.InstancedBufferGeometry();
  private data=Object.fromEntries(ATTRIBUTES.map(name=>[name,new Float32Array(MAX_BOATS*4)])) as Record<typeof ATTRIBUTES[number],Float32Array>;
  private slots=new Map<string,number>();
  private ids:string[]=[];
  constructor(){
    const quad=new T.PlaneGeometry(1,1).rotateX(-Math.PI/2);
    this.geometry.index=quad.index;this.geometry.setAttribute('position',quad.getAttribute('position'));
    for(const name of ATTRIBUTES)this.geometry.setAttribute(name,new T.InstancedBufferAttribute(this.data[name],4).setUsage(T.DynamicDrawUsage));
    this.geometry.instanceCount=0;
    this.mesh=new T.Mesh(this.geometry,new T.ShaderMaterial({vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:false,
      uniforms:{time:{value:0},shadowStrength:{value:.55},night:{value:0},foam:{value:new T.Color(1,1,1)}}}));
    this.mesh.renderOrder=8;this.mesh.frustumCulled=false;
  }
  /** Adds a boat, or reshapes it after its model changed. */
  set(id:string,model:BoatModel){
    let i=this.slots.get(id);
    if(i===undefined){if(this.ids.length>=MAX_BOATS)return;i=this.ids.length;this.ids.push(id);this.slots.set(id,i);this.geometry.instanceCount=this.ids.length;}
    this.data.iShape.set([model.length+7,model.length/2+1.9,0,model.hulls.length],i*4);
    for(const [k,name] of (['iH0','iH1','iH2'] as const).entries()){const h=model.hulls[k];this.data[name].set(h?[h.x,h.y,h.z,h.w]:[0,0,0,0],i*4);}
    this.dirty();
  }
  remove(id:string){
    const i=this.slots.get(id);if(i===undefined)return;
    const last=this.ids.length-1,moved=this.ids[last];
    if(i!==last){for(const name of ATTRIBUTES)this.data[name].copyWithin(i*4,last*4,last*4+4);this.ids[i]=moved;this.slots.set(moved,i);}
    this.ids.pop();this.slots.delete(id);this.geometry.instanceCount=this.ids.length;this.dirty();
  }
  /** Per frame: where the boat is drawn, how large, whether it is followed, where its shadow falls (boat-local). */
  update(id:string,x:number,z:number,angle:number,scale:number,selected:number,shadow:T.Vector2){
    const i=this.slots.get(id);if(i===undefined)return;
    this.data.iPose.set([x,z,angle,scale],i*4);this.data.iShape[i*4+2]=selected;
    this.data.iMisc[i*4]=shadow.x;this.data.iMisc[i*4+1]=shadow.y;
  }
  /** Once per frame, after the boats: shared light and time, and one upload of the moving data. */
  frame(time:number,night:number,light:T.Color){
    const u=this.mesh.material.uniforms;
    u.time.value=time/1000;u.night.value=night;u.foam.value.setRGB(.95,.99,.98).multiply(light);
    const n=this.ids.length*4;
    for(const name of ['iPose','iShape','iMisc'] as const){const a=this.geometry.attributes[name] as T.InstancedBufferAttribute;a.clearUpdateRanges();a.addUpdateRange(0,n);a.needsUpdate=true;}
  }
  private dirty(){for(const name of ATTRIBUTES){const a=this.geometry.attributes[name] as T.InstancedBufferAttribute;a.clearUpdateRanges();a.needsUpdate=true;}}
  dispose(){this.geometry.dispose();this.mesh.material.dispose();}
}
