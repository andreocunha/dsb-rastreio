import * as T from 'three';

const MAX=128;
/** Kelvin wake half-angle: tan(19.47°). The V opens with distance behind the boat. */
const KELVIN=.354;

// Each stamp is a slice of water the boat has passed, laid with the hull's heading.
// Its age tells how far behind the boat it is, so the V opens and fades like a real
// wake: turbulent propeller wash in the middle, two thin diverging arms at the edges.
const vertexShader=`attribute vec4 iA,iB,iC,iM;
uniform float time,scale,lifeScale;
varying vec2 vLocal;varying vec2 vWorld;varying float vAge,vReal,vStrength,vHalf,vSeconds,vCount;varying vec3 vMotors;
void main(){
  // Per boat (all boats share this draw): iC = beam, half length, outboard count; iM = outboard offsets.
  float beam=iC.x,halfLength=iC.y;vCount=iC.z;vMotors=iM.xyz;
  // Stamps store the boat's true position; the (zoom-dependent) stern is derived here,
  // so zooming rescales the whole wake consistently instead of shifting old foam.
  float life=iB.w*lifeScale,age=(time-iA.w)/life;
  if(age<0.||age>1.||iB.x<=0.){gl_Position=vec4(2.,2.,2.,1.);return;}
  float seconds=(time-iA.w)/1000.,speed=iB.y;
  // Half-width: the hull, then the real Kelvin spread behind it.
  float halfW=scale*beam*.42+${KELVIN}*speed*seconds+.3;
  float halfL=iB.z*1.6;
  vec2 local=vec2(position.x*halfW,position.z*halfL);
  float a=iA.z;vec2 fwd=vec2(sin(a),-cos(a)),side=vec2(cos(a),sin(a));
  vec2 p=iA.xy-fwd*halfLength*scale+side*local.x-fwd*local.y;
  // Real age (not stretched by zoom) for what happens in time: the outboard streams merging.
  vReal=min(1.,(time-iA.w)/iB.w);
  vLocal=vec2(local.x,position.z);vWorld=p;vAge=age;vStrength=iB.x;vHalf=halfW;vSeconds=seconds;
  gl_Position=projectionMatrix*viewMatrix*vec4(p.x,.05,p.y,1.);
}`;

const fragmentShader=`precision highp float;
uniform float time,scale;uniform vec3 foam,tint;
varying vec2 vLocal;varying vec2 vWorld;varying float vAge,vReal,vStrength,vHalf,vSeconds,vCount;varying vec3 vMotors;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
void main(){
  float x=vLocal.x,age=vAge,life=1.-age;
  float window=1.-smoothstep(.45,1.,abs(vLocal.y));
  vec2 q=vWorld*.9+vec2(0.,time*.0002);
  float grain=noise(q)*.6+noise(q*2.7+4.)*.4;
  // Propeller wash: one narrow turbulent stream per outboard, merging and dying first.
  float sigma=scale*.18+.35+vSeconds*.3,streams=0.;
  for(int i=0;i<3;i++){
    if(float(i)>=vCount)break;
    float motor=i==0?vMotors.x:i==1?vMotors.y:vMotors.z;
    // (d*d, not pow(d,2.): pow is undefined for negative bases on some GPUs.)
    float d=(x-motor*scale*(1.-vReal))/sigma;streams+=exp(-d*d);
  }
  float wash=clamp(streams,0.,1.2)*(.5+.6*grain)*pow(max(0.,1.-age*1.25),1.2);
  // Kelvin arms: thin, broken lines at the edge of the V, fading as they spread.
  float edge=abs(abs(x)-vHalf*.9);
  float arms=smoothstep(.5+vSeconds*.3,0.,edge)*(.4+.6*grain)*pow(life,1.3)*.8;
  // Faint disturbed water inside the V.
  float inner=(1.-smoothstep(vHalf*.5,vHalf,abs(x)))*pow(life,2.)*.14;
  float alpha=clamp(wash+arms+inner,0.,1.)*vStrength*window;
  vec3 color=mix(tint,foam,clamp((wash+arms)*1.3,0.,1.));
  gl_FragColor=vec4(color,alpha*.9);
  #include <colorspace_fragment>
}`;

const SLOT=MAX+1,MAX_BOATS=32;

/** Every boat's wake in one draw call: each boat owns a block of instanced foam stamps. */
export class WakeBatch {
  readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
  readonly a=new Float32Array(MAX_BOATS*SLOT*4);
  readonly b=new Float32Array(MAX_BOATS*SLOT*4);
  readonly c=new Float32Array(MAX_BOATS*SLOT*4);
  readonly m=new Float32Array(MAX_BOATS*SLOT*4);
  readonly geometry=new T.InstancedBufferGeometry();
  private used:boolean[]=[];
  constructor(){
    const quad=new T.PlaneGeometry(2,2).rotateX(-Math.PI/2);
    this.geometry.index=quad.index;this.geometry.setAttribute('position',quad.getAttribute('position'));
    for(const [name,array] of [['iA',this.a],['iB',this.b],['iC',this.c],['iM',this.m]] as const)
      this.geometry.setAttribute(name,new T.InstancedBufferAttribute(array,4).setUsage(T.DynamicDrawUsage));
    this.geometry.instanceCount=0;
    const material=new T.ShaderMaterial({vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:false,
      uniforms:{time:{value:0},scale:{value:1},lifeScale:{value:1},foam:{value:new T.Color('#f4fbf8')},tint:{value:new T.Color('#9fe0d4')}}});
    this.mesh=new T.Mesh(this.geometry,material);this.mesh.frustumCulled=false;this.mesh.renderOrder=6;
  }
  attr(name:'iA'|'iB'|'iC'|'iM'){return this.geometry.attributes[name] as T.InstancedBufferAttribute;}
  /** First stamp index of a free block, or -1 when full. */
  claim(){
    let slot=this.used.indexOf(false);if(slot<0){if(this.used.length>=MAX_BOATS)return -1;slot=this.used.length;this.used.push(true);}else this.used[slot]=true;
    this.geometry.instanceCount=Math.max(this.geometry.instanceCount,(slot+1)*SLOT);
    return slot*SLOT;
  }
  release(start:number){
    this.b.fill(0,start*4,(start+SLOT)*4);const iB=this.attr('iB');iB.clearUpdateRanges();iB.needsUpdate=true;
    this.used[start/SLOT]=false;
    while(this.used.length&&!this.used[this.used.length-1])this.used.pop();
    this.geometry.instanceCount=this.used.length*SLOT;
  }
  private eased=0;private easedAt=0;
  /**
   * Shared by every wake: the race clock and the on-screen boat size. The wake's visible length
   * follows the boat's drawn size, but eases over about a second: a zoom gesture must not make the
   * foam jump or slide.
   */
  frame(time:number,scale:number,lifeScale:number){
    const now=typeof performance!=='undefined'?performance.now():time;
    if(!this.easedAt||now-this.easedAt>500)this.eased=lifeScale;else this.eased+=(lifeScale-this.eased)*(1-Math.exp(-(now-this.easedAt)/900));
    this.easedAt=now;
    const u=this.mesh.material.uniforms;u.time.value=time;u.scale.value=scale;u.lifeScale.value=this.eased;
  }
  setLight(light:T.Color){const u=this.mesh.material.uniforms;u.foam.value.setRGB(.96,.99,.98).multiply(light);u.tint.value.setRGB(.62,.88,.83).multiply(light);}
  dispose(){this.geometry.dispose();this.mesh.material.dispose();}
}

/** Wake of one boat: a ring buffer of foam stamps plus a live stamp at the stern, inside a shared batch. */
export class BoatWake {
  /** The batch's mesh (a boat's wake is not drawn on its own). */
  readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
  private batch:WakeBatch;
  private start:number;
  private next=0;
  private last:{x:number;z:number;time:number}|null=null;
  /** Every stamp changed (a reset): the next upload sends the whole block. */
  private cleared=false;
  /** Created alone (tests, a single boat): owns its batch and frees it on dispose. */
  private own:boolean;
  constructor(batch?:WakeBatch){
    this.own=!batch;this.batch=batch??new WakeBatch();this.mesh=this.batch.mesh;this.start=this.batch.claim();
  }
  /** Outboard offsets in metres (unscaled) and the hull beam. */
  setStyle(motors:number[],beam:number){
    if(this.start<0)return;
    for(let i=0;i<SLOT;i++){const k=(this.start+i)*4;this.batch.c[k]=beam;this.batch.c[k+2]=Math.max(1,Math.min(3,motors.length));for(let j=0;j<3;j++)this.batch.m[k+j]=motors[j]??0;}
    for(const name of ['iC','iM'] as const){const a=this.batch.attr(name);a.clearUpdateRanges();a.needsUpdate=true;}
  }
  setLight(light:T.Color){this.batch.setLight(light);}
  private lifeScale(scale:number){return Math.min(3.5,Math.pow(Math.max(1,scale),.85));}
  private get a(){return this.batch.a;}
  private get b(){return this.batch.b;}
  /** Stamps still visible at `time` (diagnostics and tests). */
  visible(time:number,scale=1){
    if(this.start<0)return 0;const k=this.lifeScale(scale);let n=0;
    for(let j=0;j<SLOT;j++){const i=this.start+j,age=time-this.a[i*4+3];if(this.b[i*4]>0&&age>=0&&age<=this.b[i*4+3]*k)n++;}return n;
  }
  /** True positions of laid stamps, oldest first (diagnostics and tests). */
  stamps(time:number,scale=1){
    const k=this.lifeScale(scale),out:{x:number;z:number;angle:number}[]=[];if(this.start<0)return out;
    for(let j=0;j<MAX;j++){const i=this.start+(this.next+j)%MAX,age=time-this.a[i*4+3];if(this.b[i*4]>0&&age>=0&&age<=this.b[i*4+3]*k)out.push({x:this.a[i*4],z:this.a[i*4+1],angle:this.a[i*4+2]});}
    return out;
  }
  update(x:number,z:number,heading:number,speed:number,scale:number,time:number,active:boolean,length=6){
    if(this.start<0)return;
    const angle=heading*Math.PI/180;
    // Speed in knots drives everything: solar boats race at up to 10–12 knots.
    const knots=active&&Number.isFinite(speed)?Math.max(0,speed):0;
    const strength=Math.min(1,Math.max(0,(knots-.4)/9));
    // Real duration; stretched (up to 3.5×) in the shader while the hull is drawn larger than life.
    const life=900+220*Math.min(12,knots);
    const stampMs=life*3.5/(MAX*.75);
    const base=this.start;
    // A reconnect/teleport must never draw a wake across the lake.
    if(this.last&&(time<this.last.time||Math.hypot(x-this.last.x,z-this.last.z)>80)){this.b.fill(0,base*4,(base+SLOT)*4);this.last=null;this.cleared=true;}
    const set=(slot:number,segment:number)=>{
      const i=(base+slot)*4;
      this.a[i]=x;this.a[i+1]=z;this.a[i+2]=angle;this.a[i+3]=time;
      this.b[i]=strength;this.b[i+1]=knots*.514444;this.b[i+2]=Math.max(.15,segment);this.b[i+3]=life;
    };
    const iA=this.batch.attr('iA'),iB=this.batch.attr('iB'),iC=this.batch.attr('iC');
    // Upload only the stamps that changed (usually just the live one), not the whole ring every frame.
    const touch=(slot:number)=>{iA.addUpdateRange((base+slot)*4,4);iB.addUpdateRange((base+slot)*4,4);};
    if(this.cleared){this.cleared=false;iB.addUpdateRange(base*4,SLOT*4);iA.addUpdateRange(base*4,SLOT*4);}
    const moved=this.last?Math.hypot(x-this.last.x,z-this.last.z):0;
    if(strength>0&&(!this.last||moved>=1.2||(time-this.last.time>=stampMs&&moved>.03))){
      set(this.next,moved||.3);touch(this.next);this.next=(this.next+1)%MAX;this.last={x,z,time};
    }
    // The live stamp keeps the foam glued to the transom between laid stamps.
    set(MAX,Math.max(moved,.3));touch(MAX);
    // Hull half length lives with the boat's stamps (it follows the on-screen size).
    const half=length/2;
    if(this.batch.c[base*4+1]!==half){for(let j=0;j<SLOT;j++)this.batch.c[(base+j)*4+1]=half;iC.addUpdateRange(base*4,SLOT*4);iC.needsUpdate=true;}
    this.batch.frame(time,scale,this.lifeScale(scale));
    iA.needsUpdate=iB.needsUpdate=true;
  }
  dispose(){if(this.start>=0)this.batch.release(this.start);this.start=-1;if(this.own)this.batch.dispose();}
}
