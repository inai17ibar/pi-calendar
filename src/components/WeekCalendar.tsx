import {useEffect,useRef} from 'react';
import {DateTime} from 'luxon';
import {eventsForDay,timedSegments,type CalendarEvent} from '../domain/calendar';
const format=(day:string,pattern:string)=>DateTime.fromISO(day).setLocale('ja').toFormat(pattern);
type Props={days:string[];today:string;selected:string;events:CalendarEvent[];complete:boolean;timezone:string;now:string;onChoose:(day:string)=>void;onDetail:(event:CalendarEvent)=>void;onMove:(delta:number)=>void};
export default function WeekCalendar({days,today,selected,events,complete,timezone,now,onChoose,onDetail,onMove}:Props){
 const scroll=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(scroll.current)scroll.current.scrollTop=7*72;},[]);
 const current=DateTime.fromISO(now).setZone(timezone);
 return <section className="week-panel" aria-label="週間カレンダー">
  <div className="section-heading"><div><h1>{format(days[0],'yyyy年 M月d日')} – {format(days[6],days[0].slice(0,4)===days[6].slice(0,4)?'M月d日':'yyyy年 M月d日')}</h1><p className="week-zone">{timezone} · 終日 / 時刻付き</p></div><div className="month-actions"><button aria-label="前週" onClick={()=>onMove(-1)}>‹</button><button aria-label="翌週" onClick={()=>onMove(1)}>›</button></div></div>
  <div className="week-scroll" ref={scroll} tabIndex={0} aria-label="週の時間軸。縦横にスクロールできます">
   <div className="week-canvas">
    <div className="week-header"><span className="zone-label">終日</span>{days.map(day=><div key={day} className="week-day-header"><button className={day===today?'is-today':''} aria-pressed={day===selected} aria-label={`${day} を選択`} onClick={()=>onChoose(day)}><span>{format(day,'ccc')}</span><strong>{format(day,'M/d')}</strong></button><div className="all-day-events">{!complete?<span className="unfetched">未取得</span>:eventsForDay(events,day,timezone).filter(e=>e.kind==='allDay').map(e=><button className="all-day-event" style={{background:e.color}} key={`${e.calendarId}:${e.id}`} onClick={()=>onDetail(e)}>{e.start<day?'← ':''}{e.title}{e.end>DateTime.fromISO(day).plus({days:1}).toISODate()!?' →':''}</button>)}</div></div>)}</div>
    <div className="week-time-grid"><div className="time-labels">{Array.from({length:24},(_,h)=><span key={h} style={{top:h*72}}>{String(h).padStart(2,'0')}:00</span>)}</div>{days.map(day=><div key={day} className="time-column" aria-label={`${day} 時刻付き予定`}>
     {complete&&timedSegments(events,day,timezone).map(s=><button key={`${s.event.calendarId}:${s.event.id}`} className="week-event" style={{top:s.start*1.2,height:Math.max(48,(s.end-s.start)*1.2),left:`${s.lane/s.lanes*100}%`,width:`${100/s.lanes}%`,background:s.event.color}} onClick={()=>onDetail(s.event)} aria-label={`${day} ${s.continuesBefore?'前日から ':''}${s.event.title} ${s.continuesAfter?'翌日へ':''}`}><strong>{s.event.title}</strong><span>{s.continuesBefore?'← ':''}{formatTime(s.start)} – {formatTime(s.end)}{s.continuesAfter?' →':''}</span></button>)}
     {day===today&&<div className="now-line" aria-label="現在時刻" style={{top:(current.hour*60+current.minute)*1.2}}/>}
    </div>)}</div>
   </div>
  </div>
 </section>;
}
function formatTime(minutes:number){return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
