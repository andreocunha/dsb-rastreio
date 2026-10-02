import * as T from 'three';
import type {MapState,MapConfig,Boat} from '../types';
import {solarBoat,disposeBoat,type BoatModel} from './boat';
import {BoatFx} from './boat-fx';
import {BoatWake} from './boat-wake';
import {Course} from './course';
import {LabelLayout} from '../labels';
import {LabelSprites} from './labels';
import {courseOverlay} from './course-overlay';
import {groundMaterial,groundUniforms} from './ground';
import {projection} from './geography';
import {Imagery} from './imagery';
import {sceneSun,sceneGrade,blendGrade,type Grade,type LightMode} from './lighting';
import {waterField,type WaterField} from './water-field';
import {isRecentPosition} from '../../tracker/freshness';
import type {TileCache} from '../tiles';

const FOV=30,TRANSITION_MS=1600;

export const boatStyle=(boat:Boat)=>({type:(['mono','jetski','support'] as const).find(t=>t===boat.type)??'cat' as const,motors:boat.type==='jetski'?1:Math.max(1,Math.min(3,boat.motors??1)),color:boat.accentColor});

interface BoatView {model:BoatModel;fx:BoatFx;wake:BoatWake}

export class RaceScene {
  private renderer:T.WebGLRenderer;
  private scene=new T.Scene();
  private camera=new T.PerspectiveCamera(FOV,1,1,30000);
  private hemi=new T.HemisphereLight('#cfe6f5','#6b6446',1.2);
  private key=new T.DirectionalLight('#ffffff',2.2);
  private uniforms=groundUniforms();
  private base=new T.Mesh(new T.PlaneGeometry(60000,60000).rotateX(-Math.PI/2),groundMaterial(this.uniforms,null));
  private project_:ReturnType<typeof projection>|null=null;
  private field:WaterField|null=null;
  private imagery:Imagery|null=null;
  private photographic=true;
  private course=new Course();
  private boats=new Map<string,BoatView>();
  private venue='';
  private size='';
  private frame=0;
  private mode:LightMode='live';
  private lightAt=0;
  private grade:Grade|null=null;
  private from:Grade|null=null;
  private target:Grade|null=null;
  private transitionAt=0;
  private cameraTarget=new T.Vector3();
  private cameraPosition=new T.Vector3();
  private pitch=74;
  private yaw=0;
  private initialized=false;
  private ray=new T.Raycaster();
  private plane=new T.Plane(new T.Vector3(0,1,0),0);
  private scratch=new T.Vector3();
  private low=false;
  private ratio=1;
  private lastTime=0;
  private slow=0;
  private interval=16.7;
  private boatScale=1;
  private buoyScale=1;
  private ppm=1;
  private dead=false;
  private onLoss:EventListener;
  private light=new T.Color(1,1,1);
  private shadow=new T.Vector2();
  private local=new T.Vector2();
  /** Frame budget. Drops to 30 while the device cannot sustain 60, and retries 60 later. */
  fps=60;
  /** Camera still easing (towards a boat, a bearing or a tilt): the engine keeps full frame rate. */
  moving=false;
  private rendered:number[]=[];
  private droppedAt=0;private retryAfter=10000;private sampled=0;
  /** Frames deliberately held back (page UI busy): don't mistake them for a slow device. */
  throttled=false;
  private labelLayout=new LabelLayout();
  private labels=new LabelSprites();
  /** Per boat, eased world offset that keeps an enlarged hull from cutting through an enlarged buoy. */
  private nudges=new Map<string,{x:number,z:number}>();
  constructor(private canvas:HTMLCanvasElement,private fallback:()=>void,private tiles:TileCache){
    this.low=window.innerWidth<700 || (navigator.hardwareConcurrency||4)<=4;
    this.renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',alpha:false});
    this.renderer.setClearColor('#0d2f33');this.renderer.outputColorSpace=T.SRGBColorSpace;
    this.renderer.toneMapping=T.NoToneMapping;
    this.base.renderOrder=-1000;this.base.frustumCulled=false;
    this.scene.add(this.hemi,this.key,this.key.target,this.base,this.course.root);
    this.onLoss=e=>{e.preventDefault();this.fallback();};canvas.addEventListener('webglcontextlost',this.onLoss);
  }
  setLighting(mode:LightMode){if(mode!==this.mode){this.mode=mode;this.lightAt=0;}}
  setPhotographic(enabled:boolean){this.photographic=enabled;}
  renderOverlay(ctx:CanvasRenderingContext2D,state:MapState){
    courseOverlay(ctx,state,p=>this.project(p.lat,p.lon,state));
  }
  project(lat:number,lon:number,state:MapState,height=0,id?:string){
    const p=this.project_?.point(lat,lon);if(!p)return{x:-1000,y:-1000};
    // A boat drawn nudged clear of a buoy: its label and tap target follow the drawn hull.
    const nudge=id?this.nudges.get(id):undefined;
    this.scratch.set(p.x+(nudge?.x??0),height,p.z+(nudge?.z??0)).project(this.camera);
    if(this.scratch.z>1)return{x:-1000,y:-1000};
    return{x:(this.scratch.x+1)*state.width/2,y:(1-this.scratch.y)*state.height/2};
  }
  /** Screen length of a hull, for label placement. */
  boatPixels(){return this.boatScale*6.5*this.ppm;}
  screenWorld(x:number,y:number,state:MapState){
    this.ray.setFromCamera(new T.Vector2(x/state.width*2-1,1-y/state.height*2),this.camera);
    const hit=this.ray.ray.intersectPlane(this.plane,this.scratch);return hit&&this.project_?this.project_.world(hit.x,hit.z):null;
  }
  private loadVenue(id:string){
    if(this.imagery){this.scene.remove(this.imagery.root);this.imagery.dispose();}
    this.field?.dispose();
    this.project_=projection(id);
    this.field=waterField(id,this.project_,this.low);
    this.uniforms.field.value=this.field.texture;this.uniforms.fieldBounds.value.copy(this.field.bounds);
    this.imagery=new Imagery(this.tiles,this.project_,this.uniforms);this.scene.add(this.imagery.root);
    this.venue=id;this.initialized=false;this.lightAt=0;
    for(const id of [...this.boats.keys()])this.removeBoat(id);
  }
  private updateGrade(now:number){
    const project=this.project_!;
    if(!this.lightAt||now-this.lightAt>30000){
      this.lightAt=now;
      const next=sceneGrade(sceneSun(new Date(),project.venue.lat,project.venue.lon,this.mode));
      this.from=this.grade??next;this.target=next;this.transitionAt=now;
      this.canvas.dataset.sunAltitude=sceneSun(new Date(),project.venue.lat,project.venue.lon,this.mode).altitude.toFixed(1);
    }
    const t=Math.min(1,(now-this.transitionAt)/TRANSITION_MS),eased=t*t*(3-2*t);
    const g=this.grade=blendGrade(this.from!,this.target!,eased);
    const u=this.uniforms;
    u.key.value.set(...g.key);u.keyColor.value.setRGB(...g.keyColor).multiplyScalar(g.keyIntensity/2.2);
    u.land.value.setRGB(...g.land);u.water.value.setRGB(...g.water);u.reflection.value.setRGB(...g.reflection);u.glow.value.setRGB(...g.glow);u.night.value=g.night;
    this.hemi.color.setRGB(...g.sky);this.hemi.groundColor.setRGB(...g.ground);this.hemi.intensity=1.1+.5*(1-g.night);
    this.key.color.setRGB(...g.keyColor);this.key.intensity=g.keyIntensity;
    this.light.setRGB(...g.land);
    // Shadows fall away from the key light, onto the water.
    const h=Math.max(.35,g.key[1]);this.shadow.set(-g.key[0]/h*1.2+.35,-g.key[2]/h*1.2+.45);
    this.renderer.setClearColor(new T.Color('#0d2f33').multiply(new T.Color(...g.water)));
    return g;
  }
  /** Offset that moves a hull (centre line along the heading) at least `clearance` from every buoy float. */
  private clearOfBuoys(c:{x:number,z:number},heading:number,half:number,clearance:number,buoys:{x:number,z:number}[],radius:number){
    const dx=Math.sin(heading),dz=-Math.cos(heading),out={x:0,z:0},need=clearance+radius;
    for(const b of buoys){
      const cx=c.x+out.x,cz=c.z+out.z;
      if(Math.abs(b.x-cx)>half+need||Math.abs(b.z-cz)>half+need)continue;
      const t=Math.max(-half,Math.min(half,(b.x-cx)*dx+(b.z-cz)*dz));
      let vx=cx+dx*t-b.x,vz=cz+dz*t-b.z,d=Math.hypot(vx,vz);
      if(d>=need)continue;
      // Dead on the centre line: step sideways rather than along the course.
      if(d<1e-3){vx=-dz;vz=dx;d=1;}
      out.x+=vx/d*(need-d);out.z+=vz/d*(need-d);
    }
    return out;
  }
  private removeBoat(id:string){
    const view=this.boats.get(id);if(!view)return;
    this.scene.remove(view.model.root,view.wake.mesh);view.fx.dispose();view.wake.dispose();disposeBoat(view.model);this.boats.delete(id);this.nudges.delete(id);
  }
  render(state:MapState,config:MapConfig,time:number){
    if(this.dead)return;
    const elapsed=this.lastTime?time-this.lastTime:16.7;
    const dt=Math.min(.1,elapsed/1000);
    if(!this.throttled&&this.lastTime){
      this.interval+=(Math.min(100,elapsed)-this.interval)*.05;this.sampled++;
      // Sustained slow frames: cap to 30 fps (then lower pixel density once). A busy spell
      // (a tile burst, a notification) must not cost the whole event: retry 60 later, backing off.
      if(this.fps===60&&this.sampled>90&&this.interval>24){this.fps=30;this.droppedAt=time;this.retryAfter=Math.min(300000,this.retryAfter*2);}
      if(elapsed>48)this.slow++;else this.slow=Math.max(0,this.slow-1);
    }
    if(this.fps===30&&time-this.droppedAt>this.retryAfter){this.fps=60;this.sampled=0;this.interval=1000/60;}
    this.lastTime=time;
    if(this.slow>60 && this.ratio>.75){this.ratio=Math.max(.75,this.ratio*.8);this.size='';this.slow=0;}
    if(this.venue!==(state.venueId??'imboassica'))this.loadVenue(state.venueId??'imboassica');
    const project=this.project_!;
    const size=`${state.width}/${state.height}/${this.ratio}`;
    if(size!==this.size){
      this.size=size;
      const dpr=Math.min(devicePixelRatio||1,this.low?1.75:2,Math.sqrt(3600000/(state.width*state.height)))*this.ratio;
      this.renderer.setPixelRatio(dpr);this.renderer.setSize(state.width,state.height,false);
      this.camera.aspect=state.width/state.height;this.camera.updateProjectionMatrix();
    }
    // --- Camera: north-up, almost overhead like a drone; tilts a little more while following.
    const ppm=this.ppm=2**state.zoom*config.tileSize/project.meters;
    const followed=state.boats.find(b=>b.id===state.followBoatId);
    // Camera: user bearing/tilt (Google Maps style) or the automatic near-overhead view.
    const pitchTarget=state.pitch??(followed?63:74);
    const ease=state.reducedMotion?1:1-Math.exp(-dt*(state.dragging?18:4));
    this.pitch+=(pitchTarget-this.pitch)*ease;
    const turn=((state.bearing-this.yaw+540)%360)-180;
    this.yaw=(this.yaw+turn*ease+360)%360;
    const distance=state.height/ppm/(2*Math.tan(FOV*Math.PI/360));
    const center=new T.Vector3((state.worldCX-project.origin.x)*project.meters,0,(state.worldCY-project.origin.y)*project.meters);
    const pitch=this.pitch*Math.PI/180,yaw=this.yaw*Math.PI/180;
    // Behind the target, opposite to the heading; screen-up points along the bearing.
    const desired=new T.Vector3(center.x-Math.sin(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,center.z+Math.cos(yaw)*Math.cos(pitch)*distance);
    const amount=!this.initialized||state.reducedMotion||state.dragging?1:1-Math.exp(-dt*9);
    if(!this.initialized){this.cameraPosition.copy(desired);this.cameraTarget.copy(center);this.initialized=true;}
    else{
      // Following: ease in, then lock on so the boat never drifts off-centre.
      const locked=followed&&this.cameraTarget.distanceTo(center)*ppm<6;
      if(locked){this.cameraPosition.copy(desired);this.cameraTarget.copy(center);}
      else{this.cameraPosition.lerp(desired,amount);this.cameraTarget.lerp(center,amount);}
      this.moving=!locked&&this.cameraTarget.distanceTo(center)*ppm>.5;
    }
    if(Math.abs(turn)>.05||Math.abs(pitchTarget-this.pitch)>.05)this.moving=true;
    // Orbiting must not cut through the chord: keep the exact orbit while it turns.
    if(Math.abs(turn)>.01||Math.abs(pitchTarget-this.pitch)>.01){const offset=desired.clone().sub(center);this.cameraPosition.copy(this.cameraTarget).add(offset);}
    const near=Math.max(1,distance/40),far=Math.max(6000,distance*12);
    if(Math.abs(this.camera.near-near)>.05||Math.abs(this.camera.far-far)>1){this.camera.near=near;this.camera.far=far;this.camera.updateProjectionMatrix();}
    this.camera.position.copy(this.cameraPosition);this.camera.lookAt(this.cameraTarget);this.camera.updateMatrixWorld();
    const mpp=1/ppm,pixelAngle=2*Math.tan(FOV*Math.PI/360)/state.height;
    const clock=state.reducedMotion?0:time/1000;
    this.uniforms.time.value=clock;this.uniforms.mpp.value=mpp;
    // --- Ground
    this.imagery!.root.visible=this.photographic;
    if(this.photographic){
      const corners=[[0,0],[state.width,0],[state.width,state.height],[0,state.height]].map(([x,y])=>this.screenWorld(x,y,state)).filter(p=>p!==null);
      if(corners.length===4)this.imagery!.update(corners,state.zoom);
    }
    const g=this.updateGrade(Date.now());
    // --- Boats keep a readable minimum size; the change is eased to avoid popping.
    // On-screen hull length when zoomed out, relative to the screen; true size when close.
    const short=Math.min(state.width,state.height),boatPixels=Math.max(28,Math.min(54,short*.075)),buoyPixels=Math.max(22,Math.min(30,short*.06));
    const scaleTarget=Math.max(1,Math.min(24,boatPixels/(6.5*ppm)));
    this.boatScale+=(scaleTarget-this.boatScale)*(this.frame?Math.min(1,dt*8):1);
    if(Math.abs(scaleTarget-this.boatScale)>this.boatScale*.01)this.moving=true;
    this.buoyScale=Math.max(1,Math.min(24,buoyPixels/(1.8*ppm)));
    const lightsOn=g.night>.25;
    // Buoy floats are ~.85 m in radius before the zoomed-out enlargement.
    const buoys=state.buoys.map(b=>project.point(b.lat,b.lon)),buoyRadius=.85*this.buoyScale;
    const nudgeEase=state.reducedMotion?1:Math.min(1,dt*6);
    for(const boat of state.boats){
      const style=boatStyle(boat),styleKey=`${style.type}/${style.motors}/${style.color}`;
      let view=this.boats.get(boat.id);
      if(view&&view.model.style!==styleKey){this.removeBoat(boat.id);view=undefined;}
      if(!view){
        const model=solarBoat(style),fx=new BoatFx(model),wake=new BoatWake();
        wake.setStyle(model.motorOffsets,model.beam);
        this.scene.add(model.root,wake.mesh);view={model,fx,wake};this.boats.set(boat.id,view);
      }
      const {model,fx,wake}=view;
      const p=project.point(boat.lat,boat.lon),heading=boat.heading*Math.PI/180;
      // Both boats and buoys are drawn larger than life when zoomed out, so a boat rounding a
      // mark a few metres off would visibly sail through it. Push the drawn hull just clear.
      const target=this.clearOfBuoys(p,heading,model.length*this.boatScale/2,(model.beam/2+.9)*this.boatScale,buoys,buoyRadius);
      let nudge=this.nudges.get(boat.id);if(!nudge){nudge={x:target.x,z:target.z};this.nudges.set(boat.id,nudge);}
      nudge.x+=(target.x-nudge.x)*nudgeEase;nudge.z+=(target.z-nudge.z)*nudgeEase;
      p.x+=nudge.x;p.z+=nudge.z;
      model.root.position.set(p.x,0,p.z);model.root.rotation.y=-heading;model.root.scale.setScalar(this.boatScale);
      const phase=p.x*.017+p.z*.011;
      const speedFactor=Math.min(1,Math.max(0,boat.speed/9));
      model.body.position.y=state.reducedMotion?0:Math.sin(clock*1.9+phase)*.05;
      // Bow lifts slightly with speed; gentle roll on the chop.
      model.body.rotation.x=state.reducedMotion?0:.035*speedFactor+Math.sin(clock*1.4+phase)*.012;
      model.body.rotation.z=state.reducedMotion?0:Math.sin(clock*1.1+phase*2)*.02;
      model.flag.material.uniforms.time.value=clock+phase;model.flag.material.uniforms.light.value=.35+.65*(1-g.night);
      model.lights.visible=lightsOn;
      const active=!!state.demo||isRecentPosition(boat.capturedAt);
      const c=Math.cos(heading),s=Math.sin(heading);
      this.local.set(c*this.shadow.x+s*this.shadow.y,-s*this.shadow.x+c*this.shadow.y);
      fx.update(active?boat.speed:0,time,boat.id===state.followBoatId?1:0,this.local,g.night,this.light);
      wake.setLight(this.light);
      wake.update(p.x,p.z,boat.heading,boat.speed,this.boatScale,state.animationTime,active,model.length);
    }
    for(const id of [...this.boats.keys()])if(!state.boats.some(b=>b.id===id))this.removeBoat(id);
    // --- Course
    this.course.update(state,project);
    this.course.frame(time,mpp,pixelAngle,this.buoyScale,state.reducedMotion,this.shadow,g.night,this.yaw);
    this.key.position.set(center.x+g.key[0]*200,g.key[1]*200,center.z+g.key[2]*200);this.key.target.position.copy(center);
    // --- Boat names, placed from this frame's camera and drawn over the scene.
    const pixelRatio=this.renderer.getPixelRatio(),hullPixels=this.boatPixels();
    const named=state.boats.map(b=>{const p=this.project(b.lat,b.lon,state,0,b.id);return{id:b.id,label:b.label,type:b.type,x:p.x,y:p.y,speed:b.speed,isFollowed:b.id===state.followBoatId,accentColor:b.accentColor,size:hullPixels};});
    this.labels.resize(state.width,state.height);
    this.labels.update(this.labelLayout.layout(named,state.width,state.height,time,pixelRatio),pixelRatio);
    this.labels.prune(new Set(state.boats.map(b=>b.id)));
    this.renderer.render(this.scene,this.camera);
    const calls=this.renderer.info.render.calls,triangles=this.renderer.info.render.triangles;
    this.renderer.autoClear=false;this.renderer.render(this.labels.scene,this.labels.camera);this.renderer.autoClear=true;
    this.frame++;
    // Frames actually rendered over the last second (diagnostics, next to the frame budget).
    this.rendered.push(time);while(this.rendered.length&&time-this.rendered[0]>1000)this.rendered.shift();
    if(this.frame%30===0){const d=this.canvas.dataset;d.drawCalls=String(calls);d.triangles=String(triangles);d.geometries=String(this.renderer.info.memory.geometries);d.textures=String(this.renderer.info.memory.textures);d.pixelRatio=this.renderer.getPixelRatio().toFixed(2);d.imageryTiles=String(this.imagery!.visibleCount);d.fps=String(this.fps);d.rendered=String(this.rendered.length);}
  }
  /** Smoothed camera heading in degrees, for the compass. */
  get heading(){return this.yaw;}
  get tilt(){return this.pitch;}
  resetClock(){this.lastTime=0;}
  dispose(){
    if(this.dead)return;this.dead=true;
    this.canvas.removeEventListener('webglcontextlost',this.onLoss);
    if(this.imagery){this.scene.remove(this.imagery.root);this.imagery.dispose();}
    for(const id of [...this.boats.keys()])this.removeBoat(id);
    this.course.dispose();this.field?.dispose();this.labels.dispose();
    this.base.geometry.dispose();this.base.material.dispose();
    this.renderer.dispose();
  }
}
