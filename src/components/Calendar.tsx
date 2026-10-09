"use client";
import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import WeekCalendar from './WeekCalendar';
import { dateInZone, eventPhase, eventsForDay, monthDays, weekDays, type CalendarEvent, type Snapshot, type SyncState } from '../domain/calendar';
type Preferences = { theme:'light'|'dark'; scale:'normal'|'large'; weekStart:0|1; startupView:'month'|'week'|'day' };
const defaults: Preferences = {theme:'light',scale:'normal',weekStart:1,startupView:'month'};
const states: Record<SyncState,string> = {fresh:'接続済み',syncing:'同期中',stale:'取得情報が古くなっています',offline:'オフライン · 保存済みのサンプルを表示',auth_required:'再認証が必要 · 保存済みのサンプルを表示',partial_error:'一部のカレンダーを取得できません',not_configured:'未取得 · データを準備してください'};
const fmt = (day:string, pattern:string) => DateTime.fromISO(day).setLocale('ja').toFormat(pattern);
export default function Calendar({initialNow,fixedClock,timezone}:{initialNow:string;fixedClock:boolean;timezone:string}) {
 const [now,setNow] = useState(initialNow);
 const clock = {now:()=>new Date(now)};
 const today = dateInZone(clock,timezone);
 const [selected,setSelected] = useState(today);
 const [month,setMonth] = useState(today.slice(0,7));
 const [view,setView] = useState<'month'|'week'|'day'>('month');
 const [prefs,setPrefs] = useState<Preferences>(defaults);
 const week=weekDays(selected,prefs.weekStart);
 const requestMonths=view==='week' ? [...new Set(week.map(d=>d.slice(0,7)))].join(',') : month;
 const [snapshot,setSnapshot] = useState<Snapshot|null>(null);
 const [snapshotMonth,setSnapshotMonth] = useState('');
 const [networkError,setNetworkError] = useState(false);
 const [scenario,setScenario] = useState<SyncState>('fresh');
 const [settings,setSettings] = useState(false);
 const [detail,setDetail] = useState<CalendarEvent|null>(null);
 const [retry,setRetry] = useState(0);
 const [followingToday,setFollowingToday] = useState(true);
 const previousToday = useRef(today);
 const settingsDialog = useRef<HTMLDialogElement>(null);
 const detailDialog = useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const frame=requestAnimationFrame(()=>{try { const p=JSON.parse(localStorage.getItem('pi-calendar-preferences') ?? 'null');
   if(p && ['light','dark'].includes(p.theme) && ['normal','large'].includes(p.scale) && [0,1].includes(p.weekStart) && ['month','week','day'].includes(p.startupView)) {
    setPrefs(p);setView(p.startupView);
   }
  } catch { /* Storage is optional; safe defaults remain usable. */ }});
  return ()=>cancelAnimationFrame(frame);
 },[]);
 useEffect(()=>{
  if (fixedClock) return;
  const tick=setInterval(()=>setNow(new Date().toISOString()),15000);return ()=>clearInterval(tick);
 },[fixedClock]);
 useEffect(()=>{
  if(previousToday.current !== today && followingToday) {setSelected(today);setMonth(today.slice(0,7));}
  previousToday.current=today;
 },[today,followingToday]);
 useEffect(()=>{
  const abort=new AbortController();
  Promise.all(requestMonths.split(',').map(async m=>{
   const res=await fetch(`/api/events?month=${m}`,{cache:'no-store',signal:abort.signal});
   if(!res.ok) throw new Error('Unavailable');return await res.json() as Snapshot;
  })).then(data=>{
   if(abort.signal.aborted)return;
   const unique=new Map(data.flatMap(s=>s.events).map(e=>[`${e.calendarId}:${e.id}`,e]));
   setSnapshot({...data[0],complete:data.every(s=>s.complete),events:[...unique.values()]});
   setSnapshotMonth(requestMonths);setNetworkError(false);
  }).catch(()=>{if(!abort.signal.aborted)setNetworkError(true);});
  return ()=>abort.abort();
 },[requestMonths,retry]);
 useEffect(()=>{ const d=settingsDialog.current;if(settings && !d?.open)d?.showModal();else if(!settings && d?.open)d.close(); },[settings]);
 useEffect(()=>{ const d=detailDialog.current;if(detail && !d?.open)d?.showModal();else if(!detail && d?.open)d.close(); },[detail]);
 const state: SyncState = networkError ? 'offline' : scenario;
 // Only retain samples for the same requested month range.
 const complete=Boolean(snapshot?.complete) && snapshotMonth===requestMonths && scenario!=='not_configured';
 const events=scenario==='not_configured' || snapshotMonth!==requestMonths ? [] : snapshot?.events ?? [];
 const agenda=eventsForDay(events,selected,timezone);
 const upcoming=agenda.find(e=>eventPhase(e,clock)==='upcoming');
 const days=monthDays(month,prefs.weekStart);
 const weekdays=prefs.weekStart===1 ? ['月','火','水','木','金','土','日'] : ['日','月','火','水','木','金','土'];
 function save(p:Preferences){setPrefs(p);try{localStorage.setItem('pi-calendar-preferences',JSON.stringify(p));}catch{ /* Private-mode storage may be unavailable. */ }}
 function goToday(){setSelected(today);setMonth(today.slice(0,7));setFollowingToday(true);}
 function choose(day:string){setSelected(day);setFollowingToday(day===today);if(day.slice(0,7)!==month)setMonth(day.slice(0,7));}
 function move(delta:number){const next=DateTime.fromISO(`${month}-01`).plus({months:delta});setMonth(next.toFormat('yyyy-MM'));setSelected(next.toISODate()!);setFollowingToday(false);}
 function timeLabel(e:CalendarEvent){
  if(e.kind==='allDay')return '終日';
  const start=DateTime.fromISO(e.start).setZone(timezone),end=DateTime.fromISO(e.end).setZone(timezone);
  return `${start.toISODate()!<selected?'前日 '+start.toFormat('HH:mm'):start.toFormat('HH:mm')} – ${end.toISODate()!>selected?'翌日 '+end.toFormat('HH:mm'):end.toFormat('HH:mm')}`;
 }
 return <main className={`calendar-app ${prefs.theme} ${prefs.scale}`}>
  <header className="topbar">
   <div className="brand"><span className="brand-symbol" aria-hidden="true">31</span><span>pi calendar<small>カレンダー</small></span></div>
   <div className="clock"><strong>{DateTime.fromISO(now).setZone(timezone).toFormat('HH:mm')}</strong><span>{fmt(today,'M月d日（ccc）')} <small>{timezone}</small></span></div>
   <nav aria-label="表示切替"><button onClick={goToday}>今日</button><div className="segmented"><button aria-pressed={view==='month'} onClick={()=>setView('month')}>月</button><button aria-pressed={view==='week'} onClick={()=>setView('week')}>週</button><button aria-pressed={view==='day'} onClick={()=>setView('day')}>日</button></div><button aria-label="設定" onClick={()=>setSettings(true)}>⚙ <span className="settings-label">設定</span></button></nav>
  </header>
  <div className="demo-note"><span className="demo-badge">DEMO</span> 合成の予定を表示しています。Google Calendarには接続していません。</div>
  <div className={`workspace ${view==='day'?'day-view':view==='week'?'week-view':''}`}>
   {view==='month' && <section className="month-panel" aria-label="月間カレンダー">
    <div className="section-heading"><div><p className="eyebrow">YOUR MONTH</p><h1>{fmt(`${month}-01`,'yyyy年 M月')}</h1></div><div className="month-actions"><button aria-label="前月" onClick={()=>move(-1)}>‹</button><button aria-label="翌月" onClick={()=>move(1)}>›</button></div></div>
    <div className="weekdays">{weekdays.map(d=><span key={d}>{d}</span>)}</div>
    <div className="month-grid">{days.map(day=>{
     const inMonth=day.slice(0,7)===month;
     const items=eventsForDay(events,day,timezone);
     return <button key={day} className={`day-cell ${!inMonth?'outside':''} ${day===selected?'selected':''} ${day===today?'today':''}`} aria-label={`${day}${day===today?' 今日':''} ${inMonth&&complete?items.length+'件':'未取得'}`} aria-pressed={day===selected} onClick={()=>choose(day)}>
      <span className="day-number">{fmt(day,inMonth?'d':'M/d')}{day===today&&<small>今日</small>}{inMonth&&complete&&items.length>2&&<small className="cell-total">{items.length}件</small>}</span>
      {(!inMonth||!complete)?<span className="unfetched">未取得</span>:<span className="cell-events">{items.slice(0,2).map(e=><span key={`${e.calendarId}:${e.id}`} className="cell-event"><i style={{background:e.color}}/>{e.title}</span>)}{items.length>2&&<small>他{items.length-2}件</small>}</span>}
     </button>;
    })}</div>
    <div className="calendar-legend"><span><i style={{background:'#d87550'}}/>プライベート</span><span><i style={{background:'#688e7b'}}/>家族</span><span>すべてサンプル</span></div>
   </section>}
   {view==='week'&&<WeekCalendar days={week} today={today} selected={selected} events={events} complete={complete} timezone={timezone} now={now} onChoose={choose} onDetail={setDetail} onMove={delta=>choose(DateTime.fromISO(selected).plus({days:delta*7}).toISODate()!)}/>}
   {view!=='week'&&<section className="agenda-panel" aria-label="日別予定">
    <div className="section-heading"><div><p className="eyebrow">{selected===today?'TODAY’S AGENDA':'DAY AGENDA'}</p><h2>{fmt(selected,'M月d日')} <span>{fmt(selected,'ccc')}曜日</span></h2></div><span className="count">{complete?`${agenda.length}件`:'未取得'}</span></div>
    {view==='day'&&<div className="day-navigation"><button aria-label="前日" onClick={()=>choose(DateTime.fromISO(selected).minus({days:1}).toISODate()!)}>‹ 前日</button><button aria-label="翌日" onClick={()=>choose(DateTime.fromISO(selected).plus({days:1}).toISODate()!)}>翌日 ›</button></div>}
    <div className="agenda-list">
     {!complete&&<div className="empty-state"><span>◌</span><h3>{snapshot?'この日の予定は未取得です':'予定を読み込んでいます'}</h3><p>取得できていない日を、予定ゼロとは表示しません。</p>{networkError&&<button onClick={()=>setRetry(v=>v+1)}>再接続</button>}</div>}
     {complete&&agenda.length===0&&<div className="empty-state"><span>☀</span><h3>予定はありません</h3><p>余白のある一日を。</p></div>}
     {agenda.map(e=>{const phase=eventPhase(e,clock);return <button className={`event-card ${phase==='ended'?'ended':''}`} key={`${e.calendarId}:${e.id}`} onClick={()=>setDetail(e)} style={{borderLeftColor:e.color}}>
      <div className="event-meta"><span>{timeLabel(e)}</span>{phase==='ongoing'&&<em>進行中</em>}{e===upcoming&&<em className="next-tag">次の予定</em>}</div><h3>{e.title}</h3><span className="event-calendar"><i style={{background:e.color}}/>{e.calendarName}</span><span className="event-arrow" aria-hidden="true">↗</span>
     </button>;})}
    </div>
    <div className="agenda-footnote">{timezone}</div>
   </section>}
  </div>
  <footer className="statusbar" role="status"><span className={state==='fresh'?'status-good':'status-warning'}>● <span>{states[state]}（デモ）</span></span><span>最終サンプル取得 {snapshot?.fetchedAt?DateTime.fromISO(snapshot.fetchedAt).setZone(timezone).toFormat('HH:mm'):'—'}</span><button className="reconnect" onClick={()=>setRetry(v=>v+1)}>再取得</button><span className="version">m1 · mock</span></footer>
  <dialog ref={settingsDialog} onCancel={()=>setSettings(false)} onClose={()=>setSettings(false)} aria-labelledby="settings-title">
   <div className="dialog-heading"><h2 id="settings-title">表示の設定</h2><button aria-label="設定を閉じる" onClick={()=>setSettings(false)}>✕</button></div>
   <label>テーマ<select value={prefs.theme} onChange={e=>save({...prefs,theme:e.target.value as Preferences['theme']})}><option value="light">明るい</option><option value="dark">暗い</option></select></label>
   <label>文字サイズ<select value={prefs.scale} onChange={e=>save({...prefs,scale:e.target.value as Preferences['scale']})}><option value="normal">標準</option><option value="large">大きい</option></select></label>
   <label>週の始まり<select value={prefs.weekStart} onChange={e=>save({...prefs,weekStart:Number(e.target.value) as 0|1})}><option value={1}>月曜日</option><option value={0}>日曜日</option></select></label>
   <label>起動時の表示<select value={prefs.startupView} onChange={e=>save({...prefs,startupView:e.target.value as Preferences['startupView']})}><option value="month">月</option><option value="week">週</option><option value="day">日</option></select></label>
   <label>デモの取得状態<select value={scenario} onChange={e=>setScenario(e.target.value as SyncState)}>{Object.entries(states).map(([s,label])=><option key={s} value={s}>{label}</option>)}</select></label>
   <p className="dialog-note">表示設定はこのブラウザに保存します。取得状態の切替はデモ専用です。Google認証やOS設定は行いません。</p>
  </dialog>
  <dialog ref={detailDialog} onCancel={()=>setDetail(null)} onClose={()=>setDetail(null)} aria-labelledby="detail-title">
   <div className="dialog-heading"><span className="eyebrow">EVENT DETAILS · DEMO</span><button aria-label="詳細を閉じる" onClick={()=>setDetail(null)}>✕</button></div>
   {detail&&<><h2 id="detail-title">{detail.title}</h2><p>{detail.kind==='allDay' ? `${fmt(detail.start,'yyyy/M/d')} – ${fmt(DateTime.fromISO(detail.end).minus({days:1}).toISODate()!,'yyyy/M/d')} · 終日` : `${DateTime.fromISO(detail.start).setZone(timezone).toFormat('yyyy/M/d HH:mm')} – ${DateTime.fromISO(detail.end).setZone(timezone).toFormat('yyyy/M/d HH:mm')}`}</p><p>{detail.calendarName}</p><p className="description">{detail.description ?? 'これは合成データのサンプル予定です。'}</p></>}
  </dialog>
 </main>;
}
