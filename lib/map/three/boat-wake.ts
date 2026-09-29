import * as T from 'three';

const MAX=128;
/** Kelvin wake half-angle: tan(19.47°). The V opens with distance behind the boat. */
const KELVIN=.354;

// Each stamp is a slice of water the boat has passed, laid with the hull's heading.
// Its age tells how far behind the boat it is, so the V opens and fades like a real
// wake: turbulent propeller wash in the middle, two thin diverging arms at the edges.
const vertexShader=`attribute vec4 iA,iB;
uniform float time,beam,scale,halfLength,lifeScale;
varying vec2 vLocal;varying vec2 vWorld;varying float vAge,vStrength,vHalf,vSeconds;
void main(){
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
  vLocal=vec2(local.x,position.z);vWorld=p;vAge=age;vStrength=iB.x;vHalf=halfW;vSeconds=seconds;
  gl_Position=projectionMatrix*viewMatrix*vec4(p.x,.05,p.y,1.);
}`;

const fragmentShader=`precision highp float;
uniform float time,scale,motors[3],motorCount;uniform vec3 foam,tint;
varying vec2 vLocal;varying vec2 vWorld;varying float vAge,vStrength,vHalf,vSeconds;
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
    if(float(i)>=motorCount)break;
    // (d*d, not pow(d,2.): pow is undefined for negative bases on some GPUs.)
    float d=(x-motors[i]*scale*(1.-age))/sigma;streams+=exp(-d*d);
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

/** Wake of one boat: a ring buffer of instanced foam stamps plus a live stamp at the stern. */
export class BoatWake {
  readonly mesh:T.Mesh<T.InstancedBufferGeometry,T.ShaderMaterial>;
  private a=new Float32Array((MAX+1)*4);
  private b=new Float32Array((MAX+1)*4);
  private geometry=new T.InstancedBufferGeometry();
  private next=0;
  private last:{x:number;z:number;time:number}|null=null;
  constructor(){
    const quad=new T.PlaneGeometry(2,2).rotateX(-Math.PI/2);
    this.geometry.index=quad.index;this.geometry.setAttribute('position',quad.getAttribute('position'));
    this.geometry.setAttribute('iA',new T.InstancedBufferAttribute(this.a,4).setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute('iB',new T.InstancedBufferAttribute(this.b,4).setUsage(T.DynamicDrawUsage));
    this.geometry.instanceCount=MAX+1;
    const material=new T.ShaderMaterial({vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:false,
      uniforms:{time:{value:0},scale:{value:1},halfLength:{value:3},lifeScale:{value:1},beam:{value:1.2},motors:{value:[0,0,0]},motorCount:{value:1},
        foam:{value:new T.Color('#f4fbf8')},tint:{value:new T.Color('#9fe0d4')}}});
    this.mesh=new T.Mesh(this.geometry,material);this.mesh.frustumCulled=false;this.mesh.renderOrder=6;
  }
  /** Outboard offsets in metres (unscaled) and the hull beam. */
  setStyle(motors:number[],beam:number){
    const value=this.mesh.material.uniforms.motors.value as number[];
    for(let i=0;i<3;i++)value[i]=motors[i]??0;
    this.mesh.material.uniforms.motorCount.value=Math.max(1,Math.min(3,motors.length));
    this.mesh.material.uniforms.beam.value=beam;
  }
  setLight(light:T.Color){this.mesh.material.uniforms.foam.value.setRGB(.96,.99,.98).multiply(light);this.mesh.material.uniforms.tint.value.setRGB(.62,.88,.83).multiply(light);}
  private lifeScale(scale:number){return Math.min(3.5,Math.pow(Math.max(1,scale),.85));}
  /** Stamps still visible at `time` (diagnostics and tests). */
  visible(time:number,scale=1){const k=this.lifeScale(scale);let n=0;for(let i=0;i<=MAX;i++){const age=time-this.a[i*4+3];if(this.b[i*4]>0&&age>=0&&age<=this.b[i*4+3]*k)n++;}return n;}
  /** True positions of laid stamps, oldest first (diagnostics and tests). */
  stamps(time:number,scale=1){
    const k=this.lifeScale(scale),out:{x:number;z:number;angle:number}[]=[];
    for(let j=0;j<MAX;j++){const i=(this.next+j)%MAX,age=time-this.a[i*4+3];if(this.b[i*4]>0&&age>=0&&age<=this.b[i*4+3]*k)out.push({x:this.a[i*4],z:this.a[i*4+1],angle:this.a[i*4+2]});}
    return out;
  }
  update(x:number,z:number,heading:number,speed:number,scale:number,time:number,active:boolean,length=6){
    const angle=heading*Math.PI/180;
    // Speed in knots drives everything: solar boats race at up to 10–12 knots.
    const knots=active&&Number.isFinite(speed)?Math.max(0,speed):0;
    const strength=Math.min(1,Math.max(0,(knots-.4)/9));
    // Real duration; stretched (up to 3.5×) in the shader while the hull is drawn larger than life.
    const life=900+220*Math.min(12,knots);
    const stampMs=life*3.5/(MAX*.75);
    // A reconnect/teleport must never draw a wake across the lake.
    if(this.last&&(time<this.last.time||Math.hypot(x-this.last.x,z-this.last.z)>80)){this.b.fill(0);this.last=null;}
    const set=(i:number,segment:number)=>{
      this.a[i*4]=x;this.a[i*4+1]=z;this.a[i*4+2]=angle;this.a[i*4+3]=time;
      this.b[i*4]=strength;this.b[i*4+1]=knots*.514444;this.b[i*4+2]=Math.max(.15,segment);this.b[i*4+3]=life;
    };
    const moved=this.last?Math.hypot(x-this.last.x,z-this.last.z):0;
    if(strength>0&&(!this.last||moved>=1.2||(time-this.last.time>=stampMs&&moved>.03))){
      set(this.next,moved||.3);this.next=(this.next+1)%MAX;this.last={x,z,time};
    }
    // The live stamp keeps the foam glued to the transom between laid stamps.
    set(MAX,Math.max(moved,.3));
    const u=this.mesh.material.uniforms;
    u.time.value=time;u.scale.value=scale;u.halfLength.value=length/2;u.lifeScale.value=this.lifeScale(scale);
    this.geometry.attributes.iA.needsUpdate=true;this.geometry.attributes.iB.needsUpdate=true;
  }
  dispose(){this.geometry.dispose();this.mesh.material.dispose();}
}
