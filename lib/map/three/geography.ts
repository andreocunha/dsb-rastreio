import {geoToWorld} from '../geo';
import {venueById} from '../venues';
export function projection(venueId:string) {
  const venue=venueById(venueId),origin=geoToWorld(venue.lat,venue.lon);
  const meters=40075016.686*Math.cos(venue.lat*Math.PI/180);
  return {venue,origin,meters,
    point:(lat:number,lon:number)=>{const w=geoToWorld(lat,lon);return {x:(w.x-origin.x)*meters,z:(w.y-origin.y)*meters};},
    world:(x:number,z:number)=>({x:x/meters+origin.x,y:z/meters+origin.y})};
}
export function inside(x:number,z:number,points:{x:number;z:number}[]) {
  let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)hit=!hit;
  }return hit;
}
export function seeded(seed=8271){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};}
