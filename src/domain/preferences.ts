import {DateTime} from 'luxon';
export type Preferences={version:2;theme:'auto'|'light'|'dark';scale:'normal'|'large';weekStart:0|1;startupView:'month'|'week'|'day'};
export const defaultPreferences:Preferences={version:2,theme:'auto',scale:'normal',weekStart:0,startupView:'month'};
export function readPreferences(value:unknown):Preferences{
 if(!value || typeof value!=='object')return defaultPreferences;
 const p=value as Record<string,unknown>;
 return {
  version:2,
  theme:p.theme==='dark'?'dark':p.version===2 && p.theme==='light'?'light':'auto',
  scale:p.scale==='large'?'large':'normal',
  weekStart:p.version===2 && p.weekStart===1?1:0,
  startupView:p.startupView==='week'?'week':p.startupView==='day'?'day':'month',
 };
}
export function displayTheme(theme:Preferences['theme'],now:string,zone:string):'light'|'dark'{
 if(theme!=='auto')return theme;
 const hour=DateTime.fromISO(now).setZone(zone).hour;
 return hour>=22 || hour<7?'dark':'light';
}
