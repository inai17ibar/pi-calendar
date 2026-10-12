import {useRef,type ReactNode} from 'react';
// Touch uses the browser's native scrolling/inertia. Mouse dragging supplements wheel/trackpad.
export default function AgendaScroll({children}:{children:ReactNode}){
 const drag=useRef<{id:number;y:number;top:number;moved:boolean}|null>(null);
 const suppressClick=useRef(false);
 return <div className="agenda-list" tabIndex={0} aria-label="予定一覧。上下にスクロールできます"
  onPointerDown={e=>{
   suppressClick.current=false;
   if(e.pointerType!=='mouse' || e.button!==0 || (e.target as HTMLElement).closest('.empty-state'))return;
   if(e.clientX>=e.currentTarget.getBoundingClientRect().left+e.currentTarget.clientWidth)return;
   drag.current={id:e.pointerId,y:e.clientY,top:e.currentTarget.scrollTop,moved:false};
  }}
  onPointerMove={e=>{
   const d=drag.current;if(!d || d.id!==e.pointerId)return;
   if(Math.abs(e.clientY-d.y)>6 && !d.moved){d.moved=true;e.currentTarget.setPointerCapture(e.pointerId);}
   if(d.moved){e.currentTarget.scrollTop=d.top+d.y-e.clientY;suppressClick.current=true;e.preventDefault();}
  }}
  onPointerLeave={()=>{if(!drag.current?.moved)drag.current=null;}}
  onPointerUp={()=>{drag.current=null;}}
  onPointerCancel={()=>{drag.current=null;suppressClick.current=false;}}
  onLostPointerCapture={()=>{drag.current=null;}}
  onClickCapture={e=>{if(suppressClick.current && e.detail!==0){e.preventDefault();e.stopPropagation();suppressClick.current=false;}}}
 >{children}</div>;
}
