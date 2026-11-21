/**
 * Presents the deck full screen: arrow keys, Space, Page Up/Down or a click
 * move through the slides, N shows the speaker notes, Esc ends. The voice
 * agent moves through the same slides (control_deck), so "next slide" works
 * while presenting.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DeckSpec } from '../../engine/deck';
import { Icon } from '../context';
import { prefersReducedMotion } from '../domTransitions';
import { SLIDE_PX, SlideCanvas } from './SlideCanvas';

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

export function PresentMode({
  deck,
  index,
  setIndex,
  onExit,
}: {
  deck: DeckSpec;
  index: number;
  setIndex: (i: number) => void;
  onExit: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState(false);
  const [idle, setIdle] = useState(false);
  const { w, h } = useViewport();
  const count = deck.slides.length;
  const i = Math.max(0, Math.min(count - 1, index));
  const notesH = notes ? Math.min(240, Math.max(150, h * 0.3)) : 0;
  const width = Math.min(w, ((h - notesH) * SLIDE_PX.w) / SLIDE_PX.h);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  // Full screen when the browser allows it (a click does; a voice command may not)
  useEffect(() => {
    const el = rootRef.current;
    if (el != null && document.fullscreenElement == null && el.requestFullscreen) {
      el.requestFullscreen().catch(() => undefined);
    }
    let wasFull = false;
    const onChange = () => {
      if (document.fullscreenElement === el) wasFull = true;
      else if (wasFull) exitRef.current();
    };
    document.addEventListener('fullscreenchange', onChange);
    el?.focus();
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement === el) document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  // Keys go to the presentation first (Space would otherwise start the microphone)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      let handled = true;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          setIndex(Math.min(count - 1, i + 1));
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          setIndex(Math.max(0, i - 1));
          break;
        case 'Home':
          setIndex(0);
          break;
        case 'End':
          setIndex(count - 1);
          break;
        case 'n':
        case 'N':
          setNotes((v) => !v);
          break;
        case 'Escape':
          onExit();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [i, count, setIndex, onExit]);

  // The controls fade out while the mouse rests
  useEffect(() => {
    let t = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), 2500);
    };
    window.addEventListener('mousemove', wake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('mousemove', wake);
    };
  }, []);

  // Time since the presentation started, shown with the speaker notes
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!notes) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [notes]);
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  const slide = deck.slides[i];
  const nextW = Math.round(Math.min(260, (notesH - 48) * SLIDE_PX.w / SLIDE_PX.h));
  return createPortal(
    <div
      ref={rootRef}
      className={`deck-present${idle ? ' idle' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Presenting ${deck.title}`}
      tabIndex={-1}
    >
      <div className="deck-present-stage" style={{ height: h - notesH }} onClick={() => setIndex(Math.min(count - 1, i + 1))}>
        <div key={i} className={prefersReducedMotion() ? '' : 'deck-present-fade'}>
          <SlideCanvas deck={deck} index={i} width={width} />
        </div>
      </div>
      <div className="deck-present-progress" aria-hidden="true">
        <span style={{ width: `${((i + 1) / count) * 100}%` }} />
      </div>
      {notes && (
        <div className="deck-present-notes" style={{ height: notesH }}>
          <div className="deck-present-notes-text" aria-live="polite">
            <p className="deck-present-notes-head">
              <strong>Notes · slide {i + 1}</strong>
              <span className="deck-present-clock" aria-label={`Elapsed ${clock}`}>{clock}</span>
            </p>
            <p>{slide?.notes ?? 'No speaker notes on this slide.'}</p>
          </div>
          <div className="deck-present-next">
            <strong>{i < count - 1 ? 'Next' : 'End of deck'}</strong>
            {i < count - 1 && nextW > 80 && <SlideCanvas deck={deck} index={i + 1} width={nextW} />}
          </div>
        </div>
      )}
      <div className="deck-present-controls" role="toolbar" aria-label="Presentation controls" style={notes ? { bottom: notesH + 16 } : undefined}>
        <button type="button" aria-label="Previous slide" disabled={i === 0} onClick={() => setIndex(Math.max(0, i - 1))}>
          <Icon name="arrow_back" size={20} />
        </button>
        <span className="deck-present-count" aria-live="polite">{i + 1} / {count}</span>
        <button type="button" aria-label="Next slide" disabled={i >= count - 1} onClick={() => setIndex(Math.min(count - 1, i + 1))}>
          <Icon name="arrow_forward" size={20} />
        </button>
        <button type="button" aria-label={notes ? 'Hide speaker notes' : 'Show speaker notes'} aria-pressed={notes} onClick={() => setNotes((v) => !v)}>
          <Icon name="speaker_notes" size={20} />
        </button>
        <button type="button" aria-label="End the presentation" onClick={onExit}>
          <Icon name="close" size={20} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
