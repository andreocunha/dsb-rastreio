'use client';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

// Bottom sheets with the feel of the DSB app's (its components/ui.tsx): they follow the finger and a
// long or quick pull decides where they land. Phones only; larger screens keep their side panels.
const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Same breakpoint as the map's CSS. */
const isPhone = () => window.matchMedia('(max-width: 699px)').matches;
/** Past the ends the sheet resists instead of stopping dead. */
const RESIST = 6;
/** Where the sheet is drawn right now; empty values hand it back to the stylesheet. */
const place = (el: HTMLElement, transform: string, transition: string) => { el.style.transition = transition; el.style.transform = transform; };

/**
 * A sheet that is mounted while open (the organization panel). Dragging down anywhere closes it,
 * unless the finger started on a list that is scrolled (then the gesture scrolls the list) or on a
 * form field. Returns `dismiss`, which slides it out and then calls onClose (the caller unmounts it).
 */
export function useBottomSheet(sheet: RefObject<HTMLElement | null>, backdrop: RefObject<HTMLElement | null>, onClose: (() => void) | undefined, enabled = true) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const leaving = useRef(false);

  function dismiss(fromY = 0, ms = 220) {
    if (leaving.current) return;
    const el = sheet.current;
    if (!el || !enabled || !isPhone() || reduceMotion()) { close.current?.(); return; }
    leaving.current = true;
    let done = false;
    const finish = () => { if (!done) { done = true; close.current?.(); } };
    // Out from wherever the finger left it, at once (no React render in the middle of the slide).
    place(el, 'translateY(100%)', 'none');
    el.animate([{transform: `translateY(${fromY}px)`}, {transform: 'translateY(100%)'}], {duration: ms, easing: EASE}).finished.then(finish, finish);
    backdrop.current?.animate([{opacity: 1}, {opacity: 0}], {duration: ms, fill: 'forwards'});
    // A tab in the background does not advance animations, but the sheet still has to close.
    setTimeout(finish, ms + 200);
  }
  // The touch listeners below are attached once and call whatever `dismiss` is current.
  const dismissNow = useRef(dismiss);
  useEffect(() => { dismissNow.current = dismiss; });

  useEffect(() => {
    const el = sheet.current;
    if (!el || !enabled) return;
    let gesture: {x: number; y: number; dy: number; lastY: number; lastT: number; speed: number; state: 'pending' | 'drag' | 'skip'} | null = null;
    const onStart = (e: TouchEvent) => {
      gesture = null;
      const target = e.target as HTMLElement;
      if (e.touches.length !== 1 || !isPhone() || leaving.current || target.closest('input, textarea, select, [contenteditable="true"], [data-no-sheet-drag]')) return;
      // A scrollable area between the finger and the sheet that is not at its top keeps the gesture.
      let scrolled = false;
      for (let node: HTMLElement | null = target; node && node !== el; node = node.parentElement) {
        if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) { scrolled = true; break; }
      }
      const touch = e.touches[0];
      gesture = {x: touch.clientX, y: touch.clientY, dy: 0, lastY: touch.clientY, lastT: e.timeStamp, speed: 0, state: scrolled ? 'skip' : 'pending'};
    };
    const onMove = (e: TouchEvent) => {
      if (!gesture || gesture.state === 'skip') return;
      const touch = e.touches[0];
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (gesture.state === 'pending') {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        // Up or sideways belongs to the content (the list, the tab strip).
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { gesture.state = 'skip'; return; }
        gesture.state = 'drag';
        el.style.transition = 'none';
        el.style.willChange = 'transform';
      }
      e.preventDefault();
      const dt = Math.max(e.timeStamp - gesture.lastT, 1);
      gesture.speed = gesture.speed * .3 + (touch.clientY - gesture.lastY) / dt * .7;
      gesture.lastY = touch.clientY; gesture.lastT = e.timeStamp; gesture.dy = dy;
      el.style.transform = `translateY(${dy > 0 ? dy : dy / RESIST}px)`;
    };
    const onEnd = () => {
      if (gesture?.state === 'drag') {
        const {dy, speed} = gesture;
        el.style.willChange = '';
        if (speed > -.2 && (dy > Math.min(140, el.offsetHeight * .25) || (dy > 24 && speed > .5))) {
          // Keeps the finger's pace: a quick pull leaves quickly.
          const rest = Math.max(el.offsetHeight - dy, 0);
          dismissNow.current(dy, Math.round(Math.min(Math.max(rest / Math.max(speed, 1.4), 140), 260)));
        } else {
          el.style.transition = `transform .2s ${EASE}`;
          el.style.transform = '';
        }
      }
      gesture = null;
    };
    el.addEventListener('touchstart', onStart, {passive: true});
    el.addEventListener('touchmove', onMove, {passive: false});
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [sheet, enabled]);

  return dismiss;
}

/**
 * A sheet docked at the bottom with two stops (the course editor): the peek shows `main`, the open
 * one also shows `more`, which otherwise hangs below the screen. The CSS places the stops; this
 * measures them (--editor-more on the panel, --editor-peek on its parent, for what sits above the
 * sheet) and returns the pointer handler of the grab area: drag between the stops, or tap to toggle.
 */
export function useSheetStops(panel: RefObject<HTMLElement | null>, main: RefObject<HTMLElement | null>, more: RefObject<HTMLElement | null>, open: boolean, setOpen: (open: boolean) => void, active: boolean) {
  // Before the first paint, so the sheet never shows open for a frame on its way to the peek.
  useLayoutEffect(() => {
    const el = panel.current, top = main.current, extra = more.current, host = el?.parentElement;
    if (!active || !el || !top || !extra || !host) return;
    const measure = () => {
      el.style.setProperty('--editor-more', `${extra.offsetHeight}px`);
      host.style.setProperty('--editor-peek', `${top.offsetHeight}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(top); observer.observe(extra);
    return () => { observer.disconnect(); host.style.removeProperty('--editor-peek'); };
  }, [panel, main, more, active]);

  return (event: React.PointerEvent) => {
    const el = panel.current, extra = more.current;
    if (!active || !el || !extra || event.button !== 0 || (event.target as HTMLElement).closest('button, select, a, input')) return;
    const hidden = extra.offsetHeight, base = open ? 0 : hidden, startY = event.clientY;
    let dy = 0, lastY = startY, lastT = event.timeStamp, speed = 0, moved = false;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => {
      dy = e.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      speed = speed * .3 + (e.clientY - lastY) / Math.max(e.timeStamp - lastT, 1) * .7;
      lastY = e.clientY; lastT = e.timeStamp;
      const y = base + dy;
      place(el, `translateY(${y < 0 ? y / RESIST : y > hidden ? hidden + (y - hidden) / RESIST : y}px)`, 'none');
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('lostpointercapture', onUp);
      // Back to the stylesheet, which animates to the stop that was chosen.
      place(el, '', '');
      if (!moved) setOpen(!open);
      else setOpen(speed < -.4 ? true : speed > .4 ? false : base + dy < hidden / 2);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('lostpointercapture', onUp);
  };
}
