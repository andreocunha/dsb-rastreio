import * as T from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {BoatType} from '../types';

export interface BoatStyle {type:BoatType;motors:number;color:string}
export interface BoatModel {
  root:T.Group;
  body:T.Group;
  flag:T.Mesh<T.BufferGeometry,T.ShaderMaterial>;
  lights:T.Group;
  /** Stern-mounted outboards, metres from the centre line. */
  motorOffsets:number[];
  length:number;
  beam:number;
  /** Ellipses (x, z, rx, rz) where the hulls meet the water, for the foam collar. */
  hulls:T.Vector4[];
  style:string;
}

/**
 * A slender hull lofted from elliptical sections: pointed bow (−z), flat transom (+z).
 * Group 0 is the topside, group 1 the deck.
 */
function hull(length:number,beam:number,freeboard:number,sheer=.12){
  const sections=22,ring=10,positions:number[]=[],index:number[]=[];
  const width=(t:number)=>t<.62?(.84+.16*Math.sin(t/.62*Math.PI/2)):Math.sqrt(Math.max(0,1-((t-.62)/.38)**2.2));
  for(let s=0;s<=sections;s++){
    const t=s/sections,z=length/2-t*length,w=beam/2*width(t),top=freeboard+sheer*t*t;
    for(let r=0;r<=ring;r++){
      const a=r/ring*Math.PI,x=Math.cos(a)*w,y=top-(top+.18)*Math.pow(Math.sin(a),.55);
      positions.push(x,y,z);
    }
  }
  for(let s=0;s<sections;s++)for(let r=0;r<ring;r++){
    const a=s*(ring+1)+r,b=a+ring+1;index.push(a,b,a+1,a+1,b,b+1);
  }
  const sideCount=index.length;
  // Deck: a strip between the left and right sheer lines, plus the transom.
  const base=positions.length/3;
  for(let s=0;s<=sections;s++){
    const right=s*(ring+1),left=right+ring;
    positions.push(positions[right*3],positions[right*3+1],positions[right*3+2],positions[left*3],positions[left*3+1],positions[left*3+2]);
  }
  for(let s=0;s<sections;s++){const a=base+s*2;index.push(a,a+1,a+2,a+1,a+3,a+2);}
  const transom=positions.length/3;
  for(let r=0;r<=ring;r++)positions.push(positions[r*3],positions[r*3+1],positions[r*3+2]);
  for(let r=1;r<ring;r++)index.push(transom,transom+r+1,transom+r);
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setIndex(index);
  geometry.addGroup(0,sideCount,0);geometry.addGroup(sideCount,index.length-sideCount,1);
  geometry.computeVertexNormals();
  // Sheer line (deck edge), starboard stern→bow then port bow→stern: for gunwale rails.
  const sheerLine:T.Vector3[]=[];
  for(let k=0;k<=sections;k++)sheerLine.push(new T.Vector3().fromArray(positions,k*(ring+1)*3));
  for(let k=sections;k>=0;k--)sheerLine.push(new T.Vector3().fromArray(positions,(k*(ring+1)+ring)*3));
  geometry.userData.sheer=sheerLine;
  return geometry;
}

let panelTexture:T.CanvasTexture|null=null;
/** Photovoltaic cells: dark blue with fine silver bus bars, generated once. */
function panels(){
  if(panelTexture)return panelTexture;
  // Seen from above the array is only ~30–60 px wide, so the pattern is bold:
  // a light aluminium frame, silver module joints and a visible cell grid.
  const W=512,H=512,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#dfe6ec';ctx.fillRect(0,0,W,H);
  const frame=18,gap=10,cols=2,rows=3;
  const mw=(W-frame*2-gap*(cols-1))/cols,mh=(H-frame*2-gap*(rows-1))/rows;
  for(let c=0;c<cols;c++)for(let r=0;r<rows;r++){
    const x=frame+c*(mw+gap),y=frame+r*(mh+gap);
    const g=ctx.createLinearGradient(x,y,x+mw,y+mh);g.addColorStop(0,'#1d3b7c');g.addColorStop(1,'#10275c');
    ctx.fillStyle=g;ctx.fillRect(x,y,mw,mh);
    ctx.strokeStyle='rgba(150,180,225,.55)';ctx.lineWidth=3;ctx.beginPath();
    for(let i=1;i<4;i++){ctx.moveTo(x+mw*i/4,y);ctx.lineTo(x+mw*i/4,y+mh);}
    for(let i=1;i<4;i++){ctx.moveTo(x,y+mh*i/4);ctx.lineTo(x+mw,y+mh*i/4);}
    ctx.stroke();
  }
  panelTexture=new T.CanvasTexture(canvas);panelTexture.colorSpace=T.SRGBColorSpace;panelTexture.anisotropy=8;
  return panelTexture;
}

const flagVertex=`uniform float time;varying vec2 vUv;
void main(){vUv=uv;vec3 p=position;float t=uv.x;p.z+=sin(t*5.-time*7.)*.09*t;p.y+=sin(t*3.-time*5.)*.03*t;
gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
const flagFragment=`uniform vec3 color;uniform float light;varying vec2 vUv;
void main(){gl_FragColor=vec4(color*light*(.82+.18*sin(vUv.x*5.)),1.);
#include <colorspace_fragment>
}`;

// Opaque (opacity 1) but `transparent` for draw order. Double-sided ones must be single pass: otherwise
// three.js draws them twice and flips needsUpdate between passes, re-validating the shader on every draw.
const shared={
  white:new T.MeshLambertMaterial({color:"#f4f2ea",transparent:true,side:T.DoubleSide,forceSinglePass:true}),
  dark:new T.MeshLambertMaterial({color:'#20262d',transparent:true}),
  metal:new T.MeshLambertMaterial({color:'#9aa3ab',transparent:true}),
  vest:new T.MeshLambertMaterial({color:'#ff6a1a',transparent:true}),
  helmet:new T.MeshLambertMaterial({color:'#f7f7f2',transparent:true}),
  skin:new T.MeshLambertMaterial({color:'#c88d68',transparent:true}),
  cockpit:new T.MeshLambertMaterial({color:'#2b3238',transparent:true}),
};
let panelMaterial:T.MeshLambertMaterial|null=null;
const lightGeometry=new T.SphereGeometry(.09,8,6);

/**
 * Team colour on the whole hull: a lit deck and darker topsides read as a volume.
 * A little self-illumination keeps the colour legible at sunset and at night.
 */
function hullMaterials(color:string){
  const base=new T.Color(color);
  const accent=new T.MeshLambertMaterial({color:base,emissive:base.clone().multiplyScalar(.34),transparent:true,side:T.DoubleSide,forceSinglePass:true});
  const topside=new T.MeshLambertMaterial({color:base.clone().multiplyScalar(.62),emissive:base.clone().multiplyScalar(.16),transparent:true,side:T.DoubleSide,forceSinglePass:true});
  return {accent,topside};
}

const craftMaterials={
  white:new T.MeshPhongMaterial({color:'#f3f5f6',shininess:60,specular:new T.Color('#3a4046'),transparent:true,side:T.DoubleSide,forceSinglePass:true}),
  grey:new T.MeshLambertMaterial({color:'#c3cad0',transparent:true,side:T.DoubleSide,forceSinglePass:true}),
  charcoal:new T.MeshLambertMaterial({color:'#343b42',transparent:true}),
  aluminium:new T.MeshPhongMaterial({color:'#d3dadf',shininess:60,specular:new T.Color('#4a5157'),transparent:true,side:T.DoubleSide,forceSinglePass:true}),
  floor:new T.MeshLambertMaterial({color:'#b3bdc4',transparent:true,side:T.DoubleSide,forceSinglePass:true}),
  rail:new T.MeshPhongMaterial({color:'#d5dbdf',shininess:80,transparent:true}),
  shirt:new T.MeshLambertMaterial({color:'#2f6fd6',transparent:true}),
  sleeve:new T.MeshLambertMaterial({color:'#1d232a',transparent:true}),
  tank:new T.MeshLambertMaterial({color:'#d8312c',transparent:true}),
};
/** Seated crew member: blue event shirt, dark sleeves, as in the support-boat photo. */
function crew(add:(m:T.Mesh,x:number,y:number,z:number)=>T.Mesh,x:number,y:number,z:number,facing=0){
  const torso=new T.Mesh(new T.CapsuleGeometry(.19,.26,4,10),craftMaterials.shirt);torso.scale.set(1.15,1,.85);add(torso,x,y+.3,z);
  for(const side of [-1,1]){const arm=new T.Mesh(new T.CapsuleGeometry(.06,.34,3,6),craftMaterials.sleeve);arm.rotation.x=Math.PI/2.3;arm.rotation.y=facing;add(arm,x+side*.23,y+.26,z-.18);}
  const legs=new T.Mesh(new T.CapsuleGeometry(.09,.42,3,6),craftMaterials.sleeve);legs.rotation.x=Math.PI/2;legs.scale.x=2.1;add(legs,x,y+.02,z-.35);
  add(new T.Mesh(new T.SphereGeometry(.14,12,8),shared.skin),x,y+.66,z);
  add(new T.Mesh(new T.SphereGeometry(.145,12,8,0,Math.PI*2,0,Math.PI/2),craftMaterials.charcoal),x,y+.68,z+.01);
}

/** Rescue jet ski and aluminium support skiff, in the event's white and grey. */
function craft(style:BoatStyle):BoatModel{
  const root=new T.Group(),body=new T.Group(),lights=new T.Group();root.add(body);body.add(lights);
  const m=craftMaterials;
  const add=<M extends T.Mesh>(mesh:M,x:number,y:number,z:number)=>{mesh.position.set(x,y,z);body.add(mesh);return mesh;};
  const box=(w:number,h:number,l:number,mat:T.Material,x:number,y:number,z:number)=>add(new T.Mesh(new T.BoxGeometry(w,h,l),mat),x,y,z);
  const jet=style.type==='jetski';
  let length:number,beam:number;
  if(jet){
    length=3.3;beam=1.2;
    add(new T.Mesh(hull(length,beam,.4,.14),[m.grey,m.white]),0,0,0);
    // Rounded hood over the engine, with a dark windscreen line.
    const hood=new T.Mesh(new T.SphereGeometry(1,20,12,0,Math.PI*2,0,Math.PI/2),m.white);hood.scale.set(.46,.28,.85);add(hood,0,.4,-.62);
    box(.5,.05,.12,m.charcoal,0,.64,-.2);
    // Handlebar, saddle and footwells.
    const bar=new T.Mesh(new T.CylinderGeometry(.03,.03,.78,8),m.charcoal);bar.rotation.z=Math.PI/2;add(bar,0,.8,-.12);
    const seat=new T.Mesh(new T.CapsuleGeometry(.2,1.05,4,12),m.charcoal);seat.rotation.x=Math.PI/2;seat.scale.set(1.1,1,.8);add(seat,0,.56,.55);
    for(const side of [-1,1])box(.22,.04,1.1,m.grey,side*.4,.42,.5);
    box(.14,.14,.2,m.charcoal,0,.22,length/2+.06);
    // Rescue sled on the stern.
    const sled=new T.Mesh(new T.BoxGeometry(1.05,.08,.85),m.grey);add(sled,0,.3,length/2+.55);
    for(const side of [-1,1])box(.05,.06,.7,m.charcoal,side*.47,.37,length/2+.55);
    crew(add,0,.5,.35);
  }else{
    length=5.1;beam=1.95;
    const shell=hull(length,beam,.62,.16);
    add(new T.Mesh(shell,[m.aluminium,m.floor]),0,0,0);
    // Open skiff: rolled gunwale, benches, bow deck, red fuel tank, tiller outboard.
    const sheer=(shell.userData.sheer as T.Vector3[]).map(p=>p.clone().setY(p.y+.03));
    add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(sheer,false),96,.05,6,false),m.rail),0,0,0);
    for(const z of [-.55,.75])box(1.62,.07,.34,m.aluminium,0,.62,z);
    box(1.05,.05,.8,m.aluminium,0,.66,-length/2+.85);
    box(.34,.26,.5,m.tank,.45,.72,1.65);
    const cowl=new T.CapsuleGeometry(.18,.26,4,10);cowl.rotateX(Math.PI/2);add(new T.Mesh(cowl,m.charcoal),0,.8,length/2+.22);
    box(.36,.06,.24,m.grey,0,.98,length/2+.26);
    const tiller=new T.Mesh(new T.CylinderGeometry(.025,.025,.7,6),m.charcoal);tiller.rotation.x=Math.PI/2.2;add(tiller,-.1,.9,length/2-.2);
    crew(add,-.35,.62,1.55);
  }
  const lamp=(color:string,x:number,y:number,z:number)=>{const l=new T.Mesh(lightGeometry,new T.MeshBasicMaterial({color,transparent:true}));l.position.set(x,y,z);lights.add(l);};
  lamp('#ff3b30',-beam/2+.1,.8,-length/2+.6);lamp('#34ff7a',beam/2-.1,.8,-length/2+.6);lamp('#fff6d8',0,1.6,.2);
  // Invisible stand-in keeps the flag API uniform.
  const flag=new T.Mesh(new T.PlaneGeometry(.01,.01),new T.ShaderMaterial({vertexShader:flagVertex,fragmentShader:flagFragment,visible:false,uniforms:{time:{value:0},color:{value:new T.Color()},light:{value:1}}}));
  body.add(flag);
  merge(body,new Set<T.Object3D>([flag,lights]));
  return {root,body,flag,lights,motorOffsets:[0],length,beam,hulls:[new T.Vector4(0,0,beam/2,length/2)],style:`${style.type}/${style.motors}/${style.color}`};
}

export function solarBoat(style:BoatStyle):BoatModel{
  if(style.type==='jetski'||style.type==='support')return craft(style);
  const root=new T.Group(),body=new T.Group(),lights=new T.Group();root.add(body);body.add(lights);
  const {accent,topside}=hullMaterials(style.color);
  panelMaterial??=new T.MeshLambertMaterial({map:panels(),color:'#b9c0cc',emissive:'#0b1633',transparent:true});
  const add=<M extends T.Mesh>(mesh:M,x:number,y:number,z:number)=>{mesh.position.set(x,y,z);body.add(mesh);return mesh;};
  const box=(w:number,h:number,l:number,m:T.Material,x:number,y:number,z:number)=>add(new T.Mesh(new T.BoxGeometry(w,h,l),m),x,y,z);
  const cat=style.type!=='mono';
  // Only two hull forms race: catamaran (two floats) and monohull.
  const length=cat?6.4:6.8,beam=cat?3:1.25;
  const hulls:T.Vector4[]=[];
  let deck=0,motorBase:number[],pilotX=0;
  const array=(w:number,l:number,y:number,z:number)=>add(new T.Mesh(new T.BoxGeometry(w,.05,l),[shared.metal,shared.metal,panelMaterial!,shared.metal,shared.metal,shared.metal]),0,y,z);
  if(cat){
    const float=hull(6.4,.72,.5);
    for(const x of [-1.14,1.14]){add(new T.Mesh(float,[topside,accent]),x,0,0);hulls.push(new T.Vector4(x,0,.38,3.25));}
    for(const z of [-1.7,-.35,2.75])box(2.3,.07,.12,shared.metal,0,.6,z);
    deck=.7;
    // The pilot sits in the port float, ahead of an array bridging both floats.
    array(3,3.3,deck,1.05);
    pilotX=-1.14;
    motorBase=style.motors===1?[0]:style.motors===2?[-1.14,1.14]:[-1.14,0,1.14];
    if(style.motors!==2)box(.16,.05,.6,shared.metal,0,.58,2.95);
    add(new T.Mesh(new T.CylinderGeometry(.27,.29,.12,14),shared.cockpit),pilotX,.52,-1.35).scale.z=1.5;
  }else{
    const main=hull(6.8,1.25,.52,.16);add(new T.Mesh(main,[topside,accent]),0,0,0);hulls.push(new T.Vector4(0,0,.66,3.45));
    deck=.7;
    // Panels overhang the narrow hull on both sides, as on the event boats.
    array(2.5,3.3,deck,1.2);
    for(const z of [-.2,2.6])box(2.4,.06,.1,shared.metal,0,.6,z);
    add(new T.Mesh(new T.CylinderGeometry(.34,.36,.12,14),shared.cockpit),0,.56,-1.3).scale.z=1.5;
    motorBase=style.motors===1?[0]:style.motors===2?[-.3,.3]:[-.42,0,.42];
  }
  // Pilot: orange life vest and helmet, the most recognisable detail from above.
  const pilotZ=-1.3;
  const torso=new T.Mesh(new T.CapsuleGeometry(.2,.26,4,10),shared.vest);torso.scale.set(1.15,1,.85);add(torso,pilotX,.95,pilotZ+.05);
  for(const side of [-1,1]){const arm=new T.Mesh(new T.CapsuleGeometry(.065,.32,3,6),shared.vest);arm.rotation.x=Math.PI/2.4;add(arm,pilotX+side*.24,.92,pilotZ-.18);}
  add(new T.Mesh(new T.SphereGeometry(.15,14,10),shared.helmet),pilotX,1.33,pilotZ);
  // Outboards with a white cowling band; they visibly trail the transom.
  const stern=length/2;
  const cowl=new T.CapsuleGeometry(.15,.22,4,10);cowl.rotateX(Math.PI/2);
  for(const x of motorBase){
    const motor=new T.Mesh(cowl,shared.dark);motor.scale.set(1,1.15,1);add(motor,x,.62,stern+.26);
    box(.31,.05,.22,shared.white,x,.8,stern+.3);
    box(.06,.5,.08,shared.dark,x,.25,stern+.3);
  }
  // Yellow race flag on a thin mast, as in the event photos.
  const mastX=cat?1.14:-.45,mastZ=stern-.35;
  const mast=new T.Mesh(new T.CylinderGeometry(.025,.03,2.3,6),shared.metal);add(mast,mastX,deck+1.15,mastZ);
  const flagGeometry=new T.PlaneGeometry(.75,.48,8,1);flagGeometry.translate(.375,0,0);flagGeometry.rotateY(-Math.PI/2);
  const flag=new T.Mesh(flagGeometry,new T.ShaderMaterial({vertexShader:flagVertex,fragmentShader:flagFragment,side:T.DoubleSide,forceSinglePass:true,transparent:true,
    uniforms:{time:{value:0},color:{value:new T.Color('#ffd21f')},light:{value:1}}}));
  add(flag,mastX,deck+2.02,mastZ);
  // Navigation lights: port red, starboard green, stern white. Only visible at night.
  const lamp=(color:string,x:number,y:number,z:number)=>{const m=new T.Mesh(lightGeometry,new T.MeshBasicMaterial({color,transparent:true}));m.position.set(x,y,z);lights.add(m);};
  lamp('#ff3b30',-beam/2+.1,deck+.12,-length/2+.9);lamp('#34ff7a',beam/2-.1,deck+.12,-length/2+.9);lamp('#fff6d8',mastX,deck+2.3,mastZ);
  merge(body,new Set<T.Object3D>([flag,lights]));
  return {root,body,flag,lights,motorOffsets:motorBase,length,beam,hulls,style:`${style.type}/${style.motors}/${style.color}`};
}

/** Static parts become one mesh per material: a handful of draw calls per boat. */
function merge(body:T.Group,keep:Set<T.Object3D>){
  const parts=new Map<T.Material,T.BufferGeometry[]>();
  for(const child of [...body.children]){
    if(keep.has(child)||!(child instanceof T.Mesh))continue;
    child.updateMatrix();
    const materials=[child.material].flat() as T.Material[];
    const source=child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone();
    const groups=source.groups.length?source.groups:[{start:0,count:source.getAttribute('position').count,materialIndex:0}];
    for(const g of groups){
      const piece=new T.BufferGeometry();
      for(const name of ['position','normal','uv'] as const){
        const attribute=source.getAttribute(name) as T.BufferAttribute|undefined;
        if(attribute)piece.setAttribute(name,new T.BufferAttribute((attribute.array as Float32Array).slice(g.start*attribute.itemSize,(g.start+g.count)*attribute.itemSize),attribute.itemSize));
      }
      if(!piece.getAttribute('uv'))piece.setAttribute('uv',new T.BufferAttribute(new Float32Array(g.count*2),2));
      piece.applyMatrix4(child.matrix);
      const m=materials[g.materialIndex??0];
      if(!parts.has(m))parts.set(m,[]);parts.get(m)!.push(piece);
    }
    source.dispose();body.remove(child);
  }
  for(const [material,pieces] of parts){
    const mesh=new T.Mesh(mergeGeometries(pieces)!,material);mesh.renderOrder=20;body.add(mesh);
    pieces.forEach(p=>p.dispose());
  }
  for(const o of keep)o.traverse(c=>{if(c instanceof T.Mesh)c.renderOrder=20;});
}

export function disposeBoat(model:BoatModel){
  const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();
  model.root.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of [o.material].flat())materials.add(m);}});
  geometries.forEach(g=>{if(g!==lightGeometry)g.dispose();});
  // Shared materials live for the whole session; only per-boat materials are released.
  const keep=new Set<T.Material>([...Object.values(shared),...Object.values(craftMaterials)]);
  materials.forEach(m=>{if(!keep.has(m)&&m!==panelMaterial)m.dispose();});
}
