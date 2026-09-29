'use client';
import {useEffect, useState} from 'react';
import type {PublicSos} from '@/lib/tracker/sos-notices';
import {Icon} from './Icon';

export function SosNotice({notice,onClose,onFollow,canFollow}:{notice:PublicSos;onClose:()=>void;onFollow:()=>void;canFollow:boolean}) {
  const [paused,setPaused]=useState(false);
  const noticeId=notice[0];
  useEffect(()=>{
    if(paused)return;
    const timer=setTimeout(onClose,10000);
    return ()=>clearTimeout(timer);
  },[noticeId,paused,onClose]);
  return <aside className="sos-notice" aria-label="Aviso de SOS" onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPaused(false);}}>
    <span className="sos-notice-symbol" aria-hidden="true">SOS</span>
    <div className="sos-notice-body"><div role="status" aria-live="polite" aria-atomic="true"><strong>{notice[2]} solicitou apoio</strong><span>SOS recebido</span></div>
      {canFollow && <button className="sos-notice-follow" onClick={onFollow}>Ver barco <span aria-hidden="true">↗</span></button>}
    </div>
    <button className="sos-notice-close" onClick={onClose} aria-label="Dispensar aviso de SOS"><Icon name="close" size={16}/></button>
  </aside>;
}
