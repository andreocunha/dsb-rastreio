import * as T from 'three';
import type {TileCache} from '../tiles';
import type {WorldPoint} from '../types';
import type {projection} from './geography';
import {imageryGrid} from './imagery-grid';
import {groundMaterial,groundUniforms,type GroundUniforms} from './ground';

/** Reuses the 2D image cache and its service-worker cache; only GPU textures are new. */
export class Imagery {
  root=new T.Group();
  private meshes=new Map<string,T.Mesh<T.PlaneGeometry,T.ShaderMaterial>>();
  private geometry=new T.PlaneGeometry(1,1);
  private key='';
  ready=false;
  visibleCount=0;
  constructor(private tiles:TileCache,private project:ReturnType<typeof projection>,private uniforms:GroundUniforms=groundUniforms()){ }
  update(corners:WorldPoint[],zoom:number){
    const g=imageryGrid(corners,zoom),key=`${g.z}/${g.x0}/${g.x1}/${g.y0}/${g.y1}/${this.tiles.revision}`;
    if(key===this.key)return;this.key=key;
    for(const mesh of this.meshes.values())mesh.visible=false;
    for(let x=g.x0;x<=g.x1;x++)for(let y=g.y0;y<=g.y1;y++){
      const wrapped=((x%g.n)+g.n)%g.n,k=`${g.z}/${wrapped}/${y}`;
      this.tiles.load(k,g.z,wrapped,y);
      let z=g.z,tx=x,ty=y,image=this.tiles.get(k);
      // Existing coarser tiles cover the ground while a new level is loading.
      while(!image&&z>Math.max(0,g.z-4)){
        z--;tx=Math.floor(tx/2);ty=Math.floor(ty/2);
        const n=2**z;image=this.tiles.get(`${z}/${((tx%n)+n)%n}/${ty}`);
      }
      if(!image)continue;
      const id=`${z}/${tx}/${ty}`;
      let mesh=this.meshes.get(id);
      if(!mesh){
        const texture=new T.Texture(image);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;texture.needsUpdate=true;
        const material=groundMaterial(this.uniforms,texture);
        mesh=new T.Mesh(this.geometry,material);mesh.rotation.x=-Math.PI/2;mesh.renderOrder=-100+z;mesh.frustumCulled=false;
        const n=2**z,size=this.project.meters/n;
        mesh.scale.set(size,size,1);
        mesh.position.set(((tx+.5)/n-this.project.origin.x)*this.project.meters,.001*z,((ty+.5)/n-this.project.origin.y)*this.project.meters);
        this.root.add(mesh);this.meshes.set(id,mesh);
      }
      mesh.visible=true;
    }
    // Bound memory even after a long camera tour; the shared cache owns the images.
    for(const [id,mesh]of this.meshes){
      if(this.meshes.size<=64)break;
      if(!mesh.visible){this.root.remove(mesh);mesh.material.uniforms.map.value?.dispose();mesh.material.dispose();this.meshes.delete(id);}
    }
    this.visibleCount=[...this.meshes.values()].filter(m=>m.visible).length;
    this.ready=this.visibleCount>0;
  }
  dispose(){for(const mesh of this.meshes.values()){mesh.material.uniforms.map.value?.dispose();mesh.material.dispose();}this.geometry.dispose();this.meshes.clear();this.root.clear();}
}
