export interface MotionFix {lat:number;lon:number;heading:number;time:number}
const angle=(a:number)=>((a%360)+360)%360;
const turn=(from:number,to:number)=>((to-from+540)%360)-180;
const METRES=111320;
/**
 * Playback delay. The boat is shown this far behind real time so a fix that arrives
 * a little late (network jitter), or even one lost 1 Hz fix, is already buffered: motion
 * never stops and restarts. Kept short because spectators also watch the real boats.
 */
export const PLAYBACK_DELAY=3000;
const SETTLE_MS=450;

/**
 * Display interpolation only, over the received GPS track. Positions follow a smooth
 * (Hermite) curve through the fixes; nothing is extrapolated beyond the latest fix.
 */
export class LiveMotion {
  private fixes:MotionFix[];
  /** Local clock minus device clock, tracking the fastest observed delivery. */
  private offset:number;
  private received:number;
  /** Visual error left by a retarget, decayed smoothly instead of jumping. */
  private error={x:0,y:0,heading:0,at:0};
  constructor(fix:MotionFix,now:number){
    this.fixes=[{...fix,heading:angle(fix.heading)}];this.offset=now-fix.time;this.received=now;
  }
  push(fix:MotionFix,now:number):boolean {
    const latest=this.fixes[this.fixes.length-1];
    if(fix.time<=latest.time)return false;
    const gap=fix.time-latest.time,arrival=now-this.received;
    const metres=METRES*Math.hypot(fix.lat-latest.lat,(fix.lon-latest.lon)*Math.cos(fix.lat*Math.PI/180));
    // Long outages/GPS jumps are corrections, never an accelerated historical replay.
    if(gap>10000||arrival>10000||metres>150||metres/(gap/1000)>35){
      this.fixes=[{...fix,heading:angle(fix.heading)}];this.offset=now-fix.time;this.received=now;
      this.error={x:0,y:0,heading:0,at:now};
      return false;
    }
    const before=this.raw(now);
    const observed=now-fix.time;
    // Faster deliveries pull the clock quickly; slower ones drift it gently.
    this.offset+=(observed-this.offset)*(observed<this.offset?.1:.04);
    this.fixes.push({...fix,heading:angle(fix.heading)});
    if(this.fixes.length>12)this.fixes.shift();
    this.received=now;
    const after=this.raw(now),remaining=this.decay(now);
    this.error={x:(before.lat-after.lat)*METRES+remaining.x,y:(before.lon-after.lon)*METRES+remaining.y,heading:turn(after.heading,before.heading)+remaining.heading,at:now};
    return true;
  }
  isMoving(now:number):boolean {
    const t=now-this.offset-PLAYBACK_DELAY,first=this.fixes[0],last=this.fixes[this.fixes.length-1];
    return (this.fixes.length>1&&t>first.time&&t<last.time)||now-this.error.at<SETTLE_MS*3;
  }
  sample(now:number,reducedMotion=false):MotionFix {
    const last=this.fixes[this.fixes.length-1];
    if(reducedMotion)return {...last};
    const pose=this.raw(now),e=this.decay(now);
    return {lat:pose.lat+e.x/METRES,lon:pose.lon+e.y/METRES,heading:angle(pose.heading+e.heading),time:last.time};
  }
  private decay(now:number){
    const k=Math.exp(-(now-this.error.at)/SETTLE_MS);
    return {x:this.error.x*k,y:this.error.y*k,heading:this.error.heading*k};
  }
  /** Pose on the buffered track at the delayed playback time. */
  private raw(now:number):MotionFix {
    const f=this.fixes,t=now-this.offset-PLAYBACK_DELAY,last=f[f.length-1];
    if(f.length<2||t<=f[0].time)return {...f[0]};
    if(t>=last.time)return {...last};
    let i=0;while(f[i+1].time<t)i++;
    const a=f[i],b=f[i+1],span=b.time-a.time,u=(t-a.time)/span;
    const cos=Math.cos(a.lat*Math.PI/180);
    // Tangents from neighbouring fixes (Catmull–Rom style), scaled to this segment.
    const velocity=(k:number)=>{
      const p=f[Math.max(0,k-1)],q=f[Math.min(f.length-1,k+1)],dt=(q.time-p.time)||1;
      return {lat:(q.lat-p.lat)/dt*span,lon:(q.lon-p.lon)/dt*span};
    };
    const va=velocity(i),vb=velocity(i+1);
    const h00=2*u**3-3*u**2+1,h10=u**3-2*u**2+u,h01=-2*u**3+3*u**2,h11=u**3-u**2;
    const lat=h00*a.lat+h10*va.lat+h01*b.lat+h11*vb.lat;
    const lon=h00*a.lon+h10*va.lon+h01*b.lon+h11*vb.lon;
    // Heading follows the curve while under way; reported headings when drifting.
    const d00=6*u**2-6*u,d10=3*u**2-4*u+1,d01=-6*u**2+6*u,d11=3*u**2-2*u;
    const dLat=d00*a.lat+d10*va.lat+d01*b.lat+d11*vb.lat,dLon=(d00*a.lon+d10*va.lon+d01*b.lon+d11*vb.lon)*cos;
    const speed=Math.hypot(dLat,dLon)*METRES/(span/1000);
    const s=u*u*(3-2*u),reported=angle(a.heading+turn(a.heading,b.heading)*s);
    const heading=speed>.6?angle(Math.atan2(dLon,dLat)*180/Math.PI):reported;
    return {lat,lon,heading,time:b.time};
  }
}
