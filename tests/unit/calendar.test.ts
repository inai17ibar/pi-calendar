import { describe,it,expect } from 'vitest';
import { DateTime } from 'luxon';
import { mergeSnapshots,dayBounds,eventsForDay,monthDays,eventPhase,dateInZone,type CalendarEvent } from '../../src/domain/calendar';
import {fixtureEvents} from '../../src/server/mock';
import cases from '../../fixtures/cases.json';
const zone='Asia/Tokyo';
const clock={now:()=>new Date(cases.clock)};
const events=fixtureEvents();
describe('fixture date boundaries',()=>{
 for(const c of cases.cases) {
  if('event' in c) {
   for(const day of c.visibleDates ?? []) it(`${c.id} visible ${day}`,()=>expect(eventsForDay(events,day,zone).some(e=>e.id===c.event)).toBe(true));
   for(const day of c.notVisibleDates ?? []) it(`${c.id} absent ${day}`,()=>expect(eventsForDay(events,day,zone).some(e=>e.id===c.event)).toBe(false));
  }
 }
 it('converts foreign offset to Tokyo',()=>expect(DateTime.fromISO(events.find(e=>e.id==='demo-foreign')!.start).setZone(zone).toISO()).toBe('2026-10-04T01:00:00.000+09:00'));
 it('fall-back day is 25 hours',()=>{const {start,end}=dayBounds('2026-11-01','America/New_York');expect(end.diff(start,'hours').hours).toBe(25);});
 it('spring-forward day is 23 hours',()=>{const {start,end}=dayBounds('2026-03-08','America/New_York');expect(end.diff(start,'hours').hours).toBe(23);});
 it('orders all-day before timed',()=>expect(eventsForDay(events,'2026-10-03',zone).map(e=>e.id)).toEqual(['demo-allday','demo-timed','demo-midnight']));
 it('does not merge identical IDs from separate calendars',()=>{const e=events[0];expect(eventsForDay([e,{...e,calendarId:'family'}],'2026-10-03',zone)).toHaveLength(2);});
 it('end is exclusive at midnight',()=>{const e:CalendarEvent={...events[1],kind:'timed',start:'2026-10-03T22:00:00+09:00',end:'2026-10-04T00:00:00+09:00'};expect(eventsForDay([e],'2026-10-04',zone)).toHaveLength(0);});
 it('creates 42 cells and Monday start',()=>{const days=monthDays('2026-10',1);expect(days).toHaveLength(42);expect(days[0]).toBe('2026-09-28');expect(days[41]).toBe('2026-11-08');});
 it('supports Sunday start',()=>expect(monthDays('2026-10',0)[0]).toBe('2026-09-27'));
 it('handles leap month',()=>expect(monthDays('2028-02',1)).toContain('2028-02-29'));
 it('uses explicit timezone for clock',()=>expect(dateInZone({now:()=>new Date('2026-10-03T23:59:00Z')},zone)).toBe('2026-10-04'));
 it('classifies current and next events',()=>{expect(eventPhase(events[1],clock)).toBe('upcoming');expect(eventPhase(events[1],{now:()=>new Date('2026-10-03T15:30:00+09:00')})).toBe('ongoing');expect(eventPhase(events[1],{now:()=>new Date('2026-10-03T16:00:00+09:00')})).toBe('ended');});
});

import {weekDays,timedSegments} from '../../src/domain/calendar';
it('week crosses month and year with either week start',()=>{
 expect(weekDays('2026-10-01',1)).toEqual(['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04']);
 expect(weekDays('2027-01-01',0)[0]).toBe('2026-12-27');
});
it('splits midnight events on both days and preserves exclusive end',()=>{
 const e=events.find(e=>e.id==='demo-midnight')!;
 expect(timedSegments([e],'2026-10-03',zone)[0]).toMatchObject({start:1410,end:1440,continuesAfter:true});
 expect(timedSegments([e],'2026-10-04',zone)[0]).toMatchObject({start:0,end:30,continuesBefore:true});
 expect(timedSegments([{...e,end:'2026-10-04T00:00:00+09:00'}],'2026-10-04',zone)).toHaveLength(0);
 expect(timedSegments(events,'2026-10-03',zone).every(s=>s.event.kind==='timed')).toBe(true);
});
it('overlap columns include connected groups but touching events share a column',()=>{
 const e=events.find(e=>e.kind==='timed')!;
 const make=(id:string,start:string,end:string)=>({...e,id,start:`2026-10-03T${start}:00+09:00`,end:`2026-10-03T${end}:00+09:00`});
 const s=timedSegments([make('a','09:00','10:00'),make('b','09:30','11:00'),make('c','10:00','10:30'),make('d','11:00','12:00')],'2026-10-03',zone);
 expect(s.map(e=>[e.lane,e.lanes])).toEqual([[0,2],[1,2],[0,2],[0,1]]);
});
describe('multi-month merge (week view)',()=>{
 const base={events:[],complete:true,available:true,fetchedAt:'2026-10-03T00:00:00Z',state:'fresh' as const,synthetic:false,calendars:[{id:'a',name:'A',color:'#000',fetched:true}]};
 it('worst state, oldest fetch, all-month availability, dedupe',()=>{
  const e=events[0];
  const m=mergeSnapshots([{...base,events:[e]},{...base,events:[e],state:'offline',fetchedAt:'2026-10-02T00:00:00Z',available:false,complete:false,calendars:[{id:'a',name:'A',color:'#000',fetched:false}]}]);
  expect(m).toMatchObject({state:'offline',fetchedAt:'2026-10-02T00:00:00Z',available:false,complete:false});
  expect(m.events).toHaveLength(1);
  expect(m.calendars![0].fetched).toBe(false);
 });
 it('missing fetch time in any month means unknown',()=>expect(mergeSnapshots([base,{...base,fetchedAt:null}]).fetchedAt).toBeNull());
});
