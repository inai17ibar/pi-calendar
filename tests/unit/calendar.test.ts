import { describe,it,expect } from 'vitest';
import { DateTime } from 'luxon';
import { dayBounds,eventsForDay,monthDays,eventPhase,dateInZone,type CalendarEvent } from '../../src/domain/calendar';
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
