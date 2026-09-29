import {getPosition,getTimes} from 'suncalc';
export type LightMode='live'|'morning'|'noon'|'sunset'|'night';
export function sceneSun(now:Date,lat:number,lon:number,mode:LightMode){
  // Fixed presets use the event's solar day, independent of the spectator's time zone.
  const times=getTimes(now,lat,lon);
  const noon=times.solarNoon;
  const date=mode==='live'?now:mode==='sunset'?(times.sunsetStart??noon):new Date(noon.getTime()+({morning:-4,noon:0,night:9}[mode]??0)*3600000);
  const position=getPosition(date,lat,lon),alt=position.altitude*Math.PI/180,az=position.azimuth*Math.PI/180;
  const day=Math.max(0,Math.min(1,(position.altitude+6)/22));
  const warm=Math.max(0,1-Math.abs(position.altitude-3)/20)*day;
  return {date,day,warm,altitude:position.altitude,
    x:Math.sin(az)*Math.cos(alt),y:Math.sin(alt),z:-Math.cos(az)*Math.cos(alt)};
}

type RGB=[number,number,number];
/** Everything the scene needs to look like one time of day. Colours are linear RGB. */
export interface Grade {
  night:number;
  /** Direction towards the key light (sun, or moon at night), world axes. */
  key:RGB;
  keyColor:RGB;
  keyIntensity:number;
  sky:RGB;
  ground:RGB;
  /** Multiplies the satellite photograph. */
  land:RGB;
  /** Multiplies the stylised water. */
  water:RGB;
  /** Sky colour reflected by the water. */
  reflection:RGB;
  /** Colour of the small wave glints. */
  sparkle:RGB;
  /** Added light that tints the whole scene (golden hour haze). */
  glow:RGB;
}
const mix=(a:RGB,b:RGB,t:number):RGB=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const scale=(a:RGB,s:number):RGB=>[a[0]*s,a[1]*s,a[2]*s];
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

const DAY={glow:[0,0,0] as RGB,keyColor:[1,.96,.88] as RGB,keyIntensity:2.3,sky:[.62,.78,.95] as RGB,ground:[.42,.40,.30] as RGB,land:[1.04,1.02,.98] as RGB,water:[1,1,1] as RGB,reflection:[.55,.74,.92] as RGB,sparkle:[1,1,1] as RGB};
const GOLDEN={glow:[.16,.06,.015] as RGB,keyColor:[1,.6,.32] as RGB,keyIntensity:1.9,sky:[.85,.6,.62] as RGB,ground:[.40,.28,.20] as RGB,land:[1.05,.80,.60] as RGB,water:[.92,.86,.95] as RGB,reflection:[.62,.44,.48] as RGB,sparkle:[1,.8,.5] as RGB};
const NIGHT={glow:[0,.008,.03] as RGB,keyColor:[.55,.66,1] as RGB,keyIntensity:.55,sky:[.10,.15,.32] as RGB,ground:[.05,.06,.10] as RGB,land:[.16,.20,.34] as RGB,water:[.22,.30,.52] as RGB,reflection:[.10,.16,.36] as RGB,sparkle:[.62,.72,1] as RGB};

/**
 * Art-directed grade from the true solar altitude: soft daylight, golden hour
 * near the horizon, a moonlit blue night. Continuous, so "Horário real" drifts smoothly.
 */
export function sceneGrade(sun:ReturnType<typeof sceneSun>):Grade{
  const altitude=sun.altitude;
  const dayness=smooth(4,32,altitude);
  const night=1-smooth(-9,-1,altitude);
  const lit=(key:keyof typeof DAY)=>mix(GOLDEN[key] as RGB,DAY[key] as RGB,dayness);
  const blend=(key:keyof typeof DAY)=>mix(lit(key),NIGHT[key] as RGB,night);
  // Keep a readable minimum sun height so lighting never skims the ground.
  const sunDir:RGB=[sun.x,Math.max(.28,sun.y),sun.z];
  const moonDir:RGB=[-.35,.8,.45];
  const key=mix(sunDir,moonDir,night);
  const length=Math.hypot(...key)||1;
  return {night,key:scale(key,1/length),
    keyColor:blend('keyColor'),keyIntensity:GOLDEN.keyIntensity+(DAY.keyIntensity-GOLDEN.keyIntensity)*dayness+(NIGHT.keyIntensity-(GOLDEN.keyIntensity+(DAY.keyIntensity-GOLDEN.keyIntensity)*dayness))*night,
    sky:blend('sky'),ground:blend('ground'),land:blend('land'),water:blend('water'),reflection:blend('reflection'),sparkle:blend('sparkle'),glow:blend('glow')};
}
/** Eases every channel; used for a smooth transition between presets. */
export function blendGrade(from:Grade,to:Grade,t:number):Grade{
  const out={...to};
  for(const key of Object.keys(to) as (keyof Grade)[]){
    const a=from[key],b=to[key];
    (out as Record<string,unknown>)[key]=Array.isArray(a)&&Array.isArray(b)?mix(a as RGB,b as RGB,t):(a as number)+((b as number)-(a as number))*t;
  }
  return out;
}
