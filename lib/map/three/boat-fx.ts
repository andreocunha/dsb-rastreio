import * as T from 'three';
import type {BoatModel} from './boat';

const vertexShader=`varying vec2 vLocal;uniform vec2 size;
void main(){vLocal=vec2(uv.x-.5,.5-uv.y)*size;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

// Shadow and selection halo, in boat-local metres (bow is −y here).
const fragmentShader=`precision highp float;
uniform vec4 hulls[3];uniform float radius,hullCount,speed,time,selected,shadowStrength,night;uniform vec2 shadowOffset;uniform vec3 foam;
varying vec2 vLocal;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float ellipse(vec2 p,vec4 h){vec2 q=(p-h.xy)/h.zw;return length(q);}
void main(){
  vec2 p=vec2(vLocal.x,vLocal.y);
  float shade=0.;
  for(int i=0;i<3;i++){
    if(float(i)>=hullCount)break;
    vec4 h=hulls[i];
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

/** One draw per boat: the soft shadow on the water and the selection halo. */
export class BoatFx {
  readonly mesh:T.Mesh<T.PlaneGeometry,T.ShaderMaterial>;
  constructor(model:BoatModel){
    const side=model.length+7,size=new T.Vector2(side,side);
    const geometry=new T.PlaneGeometry(size.x,size.y);geometry.rotateX(-Math.PI/2);
    const hulls=[0,1,2].map(i=>{const h=model.hulls[i]??new T.Vector4();return new T.Vector4(h.x,h.y,h.z,h.w);});
    this.mesh=new T.Mesh(geometry,new T.ShaderMaterial({vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:false,
      uniforms:{size:{value:size},radius:{value:model.length/2+1.9},hulls:{value:hulls},hullCount:{value:model.hulls.length},speed:{value:0},time:{value:0},selected:{value:0},
        shadowStrength:{value:.55},shadowOffset:{value:new T.Vector2()},night:{value:0},foam:{value:new T.Color(1,1,1)}}}));
    this.mesh.position.y=.08;this.mesh.renderOrder=8;this.mesh.frustumCulled=false;
    model.root.add(this.mesh);
  }
  update(speed:number,time:number,selected:number,shadow:T.Vector2,night:number,light:T.Color){
    const u=this.mesh.material.uniforms;
    u.speed.value=Math.min(1,Math.max(0,(speed-.3)/8));u.time.value=time/1000;u.selected.value=selected;
    u.shadowOffset.value.copy(shadow);u.night.value=night;u.foam.value.setRGB(.95,.99,.98).multiply(light);
  }
  dispose(){this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
