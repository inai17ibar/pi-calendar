import { DateTime } from 'luxon';
import { loadConfig, configuredClock } from './config';
import { MockCalendarProvider } from './mock';
import { eventsForDay } from '../domain/calendar';
const headers = { 'Cache-Control':'no-store' };
export function apiResponse(request: Request, path: string): Response {
 const url = new URL(request.url);
 const host = request.headers.get('host') ?? url.host;
 if (!/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host)) return Response.json({error:'Forbidden host'}, { status:403,headers });
 try {
  const config = loadConfig();
  const clock = configuredClock(config.clock);
  if (path === 'health/live') return Response.json({status:'ok'}, { headers });
  if (path === 'health/ready') return Response.json({status:'ok',mode:'mock',storage:'memory',googleConfigured:false}, { headers });
  if (path === 'version') return Response.json({releaseId:'m1-mock',commit:null,builtAt:null,schemaVersion:1}, { headers });
  if (path === 'events') {
   const day = url.searchParams.get('date');
   const month = url.searchParams.get('month') ?? day?.slice(0,7);
   if (!month || !/^\d{4}-\d{2}$/.test(month) || !DateTime.fromISO(`${month}-01`).isValid || day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !DateTime.fromISO(day).isValid || day.slice(0,7)!==month)) return Response.json({error:'Use a valid month=YYYY-MM or date=YYYY-MM-DD'}, {status:400,headers});
   const snapshot = new MockCalendarProvider().month(month,clock,config.timezone);
   if (day) snapshot.events = eventsForDay(snapshot.events,day,config.timezone);
   return Response.json(snapshot,{headers});
  }
  return Response.json({error:'Not found'},{status:404,headers});
 } catch { return Response.json({error:'Local configuration is not ready. Check calendar environment settings.'},{status:503,headers}); }
}
