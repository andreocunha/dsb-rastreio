import * as T from 'three';
import {FIELD_RANGE} from './water-field';

const NOISE=256;
let noiseLattice:T.DataTexture|null=null;
/**
 * Value-noise lattice, filled with the very hash the shader used to compute: one texture read per
 * noise instead of four hashes. The water samples noise ~15 times per pixel, which is what kept
 * entry-level GPUs from a sharp picture. (The pattern now repeats every 256 noise cells.)
 */
function noiseTexture(){
  if(noiseLattice)return noiseLattice;
  const fract=(x:number)=>x-Math.floor(x),data=new Uint8Array(NOISE*NOISE*4);
  for(let y=0;y<NOISE;y++)for(let x=0;x<NOISE;x++){
    let px=fract(x*123.34),py=fract(y*456.21);const d=px*(px+45.32)+py*(py+45.32);px+=d;py+=d;
    data.fill(Math.round(fract(px*py)*255),(y*NOISE+x)*4,(y*NOISE+x)*4+4);
  }
  noiseLattice=new T.DataTexture(data,NOISE,NOISE);
  noiseLattice.wrapS=noiseLattice.wrapT=T.RepeatWrapping;noiseLattice.magFilter=noiseLattice.minFilter=T.LinearFilter;
  noiseLattice.generateMipmaps=false;noiseLattice.needsUpdate=true;
  return noiseLattice;
}

/** Shared by every ground tile; updating one uniform updates the whole ground. */
export function groundUniforms(){
  return {
    noiseTex:{value:noiseTexture()},
    field:{value:null as T.Texture|null},fieldBounds:{value:new T.Vector4(0,0,1,1)},
    time:{value:0},mpp:{value:1},
    key:{value:new T.Vector3(.3,.8,.2)},keyColor:{value:new T.Color(1,1,1)},
    land:{value:new T.Color(1,1,1)},water:{value:new T.Color(1,1,1)},
    reflection:{value:new T.Color(.55,.74,.92)},glow:{value:new T.Color(0,0,0)},night:{value:0},
  };
}
export type GroundUniforms=ReturnType<typeof groundUniforms>;

const vertexShader=`varying vec2 vUv;varying vec3 vWorld;
void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;

const fragmentShader=`precision highp float;
uniform sampler2D map,field,noiseTex;uniform float hasMap,time,mpp,night;uniform vec4 fieldBounds;
uniform vec3 key,keyColor,land,water,reflection,glow;
varying vec2 vUv;varying vec3 vWorld;
#define RANGE ${FIELD_RANGE.toFixed(1)}
// Smooth value noise in one bilinear read: the smoothstep is applied to the coordinate inside the cell.
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return texture2D(noiseTex,(i+f+.5)/${NOISE}.).r;}
float fbm(vec2 p){return noise(p)*.5+noise(p*2.03+7.1)*.3+noise(p*4.1+3.7)*.2;}
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}

void main(){
  vec2 p=vWorld.xz;
  // --- land: the satellite photograph, gently graded; illustrated fallback offline.
  vec3 photo=hasMap>.5?texture2D(map,vUv).rgb:mix(vec3(.16,.20,.10),vec3(.33,.30,.17),fbm(p*.012));
  float l=luma(photo);
  vec3 ground=mix(vec3(l),photo,1.16);
  ground=pow(max(ground,0.),vec3(1.04))*land;
  // --- water, from the satellite-traced signed distance field.
  vec2 fuv=(p-fieldBounds.xy)/fieldBounds.zw;
  vec4 f=texture2D(field,fuv);
  float e=f.r*2.-1.;float d=sign(e)*e*e*RANGE;
  float inside=step(0.,fuv.x)*step(fuv.x,1.)*step(0.,fuv.y)*step(fuv.y,1.);
  vec2 border=min(fuv,1.-fuv)*fieldBounds.zw;
  float fade=inside*smoothstep(0.,350.,min(border.x,border.y));
  float aa=max(fwidth(d),.02);
  float wet=smoothstep(-aa,aa,d)*fade;
  float sea=f.g;
  // Damp sand/mud at the waterline.
  ground*=1.-.22*smoothstep(-6.*max(1.,mpp),0.,d)*(1.-wet);

  vec3 color=ground;
  // Water costs ~15 noise lookups per pixel: skip it on land, and the foam away from the shore.
  // GPUs branch cheaply on large coherent regions, and weak phones are fill-rate bound.
  if(wet>0.){
    float depth=mix(smoothstep(0.,55.,d),smoothstep(0.,320.,d),sea);
    vec3 shallow=mix(vec3(.060,.235,.180),vec3(.130,.420,.380),sea);
    vec3 deep=mix(vec3(.022,.120,.100),vec3(.012,.120,.200),sea);
    vec3 w=mix(shallow,deep,depth);
    w*=.90+.20*fbm(p*.0045+vec2(time*.004,0.));
    // Keep the real turbidity of the lagoon: the photograph modulates brightness.
    if(hasMap>.5)w*=mix(1.,clamp(.72+l*3.2,.78,1.28),.45*(1.-sea));

    float t=time;
    float calm=mix(.6,1.,sea);
    // Irregular chop from drifting noise: no repeating stripes.
    float amp=calm*.9/(1.+mpp*.8);
    vec2 q1=p*.45+vec2(t*.22,t*.13),q2=p*1.3-vec2(t*.31,-t*.18);
    vec2 slope=(vec2(noise(q1),noise(q1+17.3))-.5)*.9+(vec2(noise(q2),noise(q2+5.1))-.5)*.5;
    vec3 n=normalize(vec3(-slope.x*amp,1.,-slope.y*amp));
    vec3 view=normalize(cameraPosition-vWorld);
    float fres=pow(1.-max(dot(n,view),0.),4.);
    w=mix(w,reflection*.55,.06+fres*.5);
    w*=water;
    // Soft drifting light patches: movement without distracting specks.
    w*=.96+.08*noise(p*.035+vec2(t*.05,-t*.03));

    float fw=max(.9,1.8*mpp);
    // Every foam term fades out a few widths from the waterline (surf: 70 m on the open sea).
    if(d<max(fw*3.,max(10.,4.*mpp))||(sea>0.&&d<70.)){
      // Lagoon edge: a thin breathing line of foam. Sea: surf bands rolling in towards the beach.
      float lap=(1.-smoothstep(0.,fw,d))*(.25+.35*noise(p*.35+t*.25));
      float ring=smoothstep(fw*.55,0.,abs(d-fw*(1.8+.6*sin(t*.9+noise(p*.05)*6.))))*.18*noise(p*.2-t*.1);
      float surfZone=1.-smoothstep(0.,70.,d);
      float bands=smoothstep(.72,1.,sin(d*.16+t*1.15+fbm(p*.02)*5.))*surfZone*(.4+.6*noise(p*.15+t*.2));
      float wash=(1.-smoothstep(0.,max(10.,4.*mpp),d))*(.6+.4*noise(p*.2-t*.3));
      float foam=mix(lap+ring*(1.-sea),max(bands,wash),sea);
      w=mix(w,vec3(.92,.97,.96)*land,clamp(foam,0.,1.)*.85);
    }

    color=mix(ground,w,wet);
  }
  // Atmosphere: warm lift at golden hour, faint blue at night.
  color+=glow*(1.-color)*mix(1.,.3,wet);
  gl_FragColor=vec4(color,1.);
  #include <colorspace_fragment>
}`;

/**
 * The ground is several overlapping layers (sharp tiles, coarser tiles still standing in while
 * they load, a plane under everything). Each pixel is shaded once: the first layer drawn marks
 * it in the stencil and the stencil test rejects the others before this costly shader runs.
 * Layers are drawn most detailed first (see renderOrder in imagery.ts and scene.ts).
 */
export function groundMaterial(uniforms:GroundUniforms,map:T.Texture|null){
  return new T.ShaderMaterial({vertexShader,fragmentShader,toneMapped:false,depthTest:false,depthWrite:false,
    stencilWrite:true,stencilRef:1,stencilFunc:T.NotEqualStencilFunc,stencilZPass:T.ReplaceStencilOp,
    uniforms:{...uniforms,map:{value:map},hasMap:{value:map?1:0}}});
}
