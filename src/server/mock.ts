import { DateTime } from 'luxon';
import type { CalendarEvent, CalendarProvider, Clock, Snapshot, SnapshotRepository } from '../domain/calendar';
import page1 from '../../fixtures/google/month-page-1.json';
import page2 from '../../fixtures/google/month-page-2.json';
interface FixtureEvent { id: string; summary: string; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string } }
export function fixtureEvents(): CalendarEvent[] {
 return [...page1.items, ...page2.items].map((item: FixtureEvent) => ({
  id: item.id, calendarId: 'primary', calendarName: 'プライベート', color: '#d87550', title: item.summary || '（件名なし）',
  kind: item.start.date ? 'allDay' : 'timed', start: item.start.date ?? item.start.dateTime!, end: item.end.date ?? item.end.dateTime!,
 }));
}
export class MemorySnapshotRepository implements SnapshotRepository {
 private snapshots = new Map<string, Snapshot>();
 read(month: string) { return this.snapshots.get(month); }
 write(month: string, snapshot: Snapshot) { this.snapshots.set(month, structuredClone(snapshot)); }
}
export class MockCalendarProvider implements CalendarProvider {
 month(month: string, clock: Clock, timezone: string): Snapshot {
  const today = DateTime.fromJSDate(clock.now(), { zone: timezone }).startOf('day');
  const anchor = DateTime.fromISO('2026-10-03', { zone: timezone });
  const shift = Math.round(today.diff(anchor, 'days').days);
  const events = fixtureEvents().map(e => ({ ...e,
   start: DateTime.fromISO(e.start, { setZone: true }).plus({ days: shift }).toISO()!,
   end: DateTime.fromISO(e.end, { setZone: true }).plus({ days: shift }).toISO()!,
  })).map(e => e.kind === 'allDay' ? { ...e, start: e.start.slice(0,10), end: e.end.slice(0,10) } : e);
  const extra: CalendarEvent[] = [
   { id:'demo-breakfast',calendarId:'family',calendarName:'家族',color:'#688e7b',title:'ゆっくり朝ごはん',kind:'timed',start:today.set({hour:8}).toISO()!,end:today.set({hour:9}).toISO()!,description:'これは合成のサンプル予定です。実際のGoogle Calendarには接続していません。' },
   { id:'demo-walk',calendarId:'family',calendarName:'家族',color:'#688e7b',title:'夕方の散歩と買い物 — いつもの道を少し遠回りして、週末の準備',kind:'timed',start:today.set({hour:17,minute:30}).toISO()!,end:today.set({hour:18,minute:30}).toISO()!,description:'長い件名・詳細表示の確認用。<script>alert("synthetic")</script> は文字列として表示します。' },
  ];
  const first = DateTime.fromISO(`${month}-01`, { zone: timezone });
  const last = first.plus({months:1});
  return { events:[...events,...extra].filter(e => e.kind === 'allDay' ? e.start < last.toISODate()! && e.end > first.toISODate()! : DateTime.fromISO(e.start) < last && DateTime.fromISO(e.end) > first), complete:true, fetchedAt:clock.now().toISOString(), state:'fresh', synthetic:true };
 }
}
