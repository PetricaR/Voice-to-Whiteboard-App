/**
 * The assistant composer at the bottom of the canvas: one Material 3 surface
 * for both ways of asking, after the input patterns of Google's AI products.
 *
 * - The text field is always there. "/" focuses it, Enter sends, Shift+Enter
 *   starts a new line, and it grows with the text.
 * - Talk starts a live voice conversation. While one runs, Talk becomes a
 *   microphone toggle and an End button, so it is always clear how to stop.
 * - A live strip above the field shows the session: a waveform that follows
 *   the microphone, what the assistant is doing, and what it heard or answered.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { VoiceSnapshot } from '../agent/session';
import { Icon, useStudio, useVoice } from './context';
import type { IconName } from './icons';

const STATUS: Record<VoiceSnapshot['status'], string> = {
  idle: '',
  connecting: 'Connecting…',
  listening: 'Listening',
  working: 'Updating studio…',
  speaking: 'Replying',
  error: 'Voice stopped',
};

const SLASH_COMMANDS: { cmd: string; label: string; icon: IconName; template: string }[] = [
  {
    cmd: '/dashboard',
    label: 'Live SQL Dashboard',
    icon: 'dashboard',
    template: 'Build an executive SaaS revenue & NRR dashboard from local SQL tables with region filter',
  },
  {
    cmd: '/motion',
    label: 'Animate Explainer',
    icon: 'movie',
    template: 'Create an animated motion explainer from the current page metrics with kinetic callouts',
  },
  {
    cmd: '/sql',
    label: 'Query & Add Widget',
    icon: 'table_chart',
    template: 'Run a SQL query for top 5 enterprise accounts by ARR and add a horizontal bar chart widget',
  },
  {
    cmd: '/explain',
    label: 'Explain Metric Change',
    icon: 'show_chart',
    template: 'Inspect the SQL queries on this dashboard and explain what drove June MRR and NRR growth',
  },
  {
    cmd: '/diagram',
    label: 'Cloud / Flow Diagram',
    icon: 'account_tree',
    template: 'Draw a Google Cloud architecture diagram for a real-time analytics pipeline',
  },
  {
    cmd: '/doc',
    label: 'Write Documentation',
    icon: 'menu_book',
    template: 'Write an executive summary chapter and KPI glossary table in the documentation tab',
  },
];

function statusLabel(v: VoiceSnapshot): string {
  if (v.status === 'error') return v.error ?? STATUS.error;
  if (v.status === 'listening' && !v.micOn) return 'Microphone off';
  return STATUS[v.status];
}

const COMPACT = typeof window === 'undefined' ? null : window.matchMedia('(max-width: 720px)');
const DOCK_MINIMIZED_KEY = 'studio.dockMinimized';

function loadMinimized(): boolean {
  try {
    return localStorage.getItem(DOCK_MINIMIZED_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribeCompact(listener: () => void): () => void {
  COMPACT?.addEventListener('change', listener);
  return () => COMPACT?.removeEventListener('change', listener);
}

/** Four bars: they follow the microphone while listening and move on their own while the model works or replies. */
function Waveform({ level }: { level: number }) {
  return (
    <span className="wave" style={{ '--level': level.toFixed(2) } as CSSProperties} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

export function VoiceDock({ focusRequest }: { focusRequest: number }) {
  const { agent, toggleVoice, openSettings, requestSignIn, ensureCanTalk } = useStudio();
  const v = useVoice(agent);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [minimized, setMinimizedState] = useState<boolean>(loadMinimized);
  const pendingFocusRef = useRef(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  // Phones get shorter placeholders, so they fit on one line
  const compact = useSyncExternalStore(subscribeCompact, () => COMPACT?.matches ?? false);

  const setMinimized = (next: boolean) => {
    setMinimizedState(next);
    try {
      if (next) localStorage.setItem(DOCK_MINIMIZED_KEY, '1');
      else localStorage.removeItem(DOCK_MINIMIZED_KEY);
    } catch {
      // not persisted
    }
  };

  // "/" anywhere on the page expands (if minimized) and focuses the request field
  useEffect(() => {
    if (focusRequest <= 0) return;
    if (minimized) {
      pendingFocusRef.current = true;
      setMinimized(false);
    } else {
      fieldRef.current?.focus();
    }
  }, [focusRequest]);

  useEffect(() => {
    if (!minimized && pendingFocusRef.current) {
      pendingFocusRef.current = false;
      fieldRef.current?.focus();
    }
  }, [minimized]);

  // Surface voice/auth errors immediately even if the dock was minimized
  useEffect(() => {
    if (v.status === 'error' && minimized) {
      setMinimizedState(false);
    }
  }, [v.status, minimized]);

  // The snackbar and surface bottom padding stay clear of the centered bar; minimized corner pill frees full height
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const host = dock?.parentElement;
    if (dock == null || host == null) return;
    const update = () => {
      host.style.setProperty('--dock-space', minimized ? '0px' : `${Math.ceil(dock.offsetHeight) + 20}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      host.style.removeProperty('--dock-space');
    };
  }, [minimized]);

  const session = v.status !== 'idle' && v.status !== 'error';
  const connecting = v.status === 'connecting';
  const isError = v.status === 'error';
  const keyProblem = isError && /key/i.test(v.error ?? '');
  const signInProblem = isError && v.errorCode === 'signed-out';
  // Trying again cannot help before tomorrow, or before the server is set up
  const final = isError && (v.errorCode === 'daily-limit' || v.errorCode === 'busy' || v.errorCode === 'auth-not-configured');
  const hasText = text.trim() !== '';

  const send = () => {
    const t = text.trim();
    if (t === '') return;
    // The text stays in the field while the user signs in
    if (!session && !ensureCanTalk()) return;
    setText('');
    agent.sendText(t).catch(() => undefined);
  };

  const toggleMic = () => {
    if (v.micOn) agent.muteMic();
    else agent.start(true).catch(() => undefined);
  };

  let caption: ReactNode = null;
  if (v.reply) caption = <span className="reply" title={v.reply}>{v.reply}</span>;
  else if (v.heard) caption = <span className="heard" title={v.heard}>{v.heard}</span>;

  const trimmedLower = text.trimStart().toLowerCase();
  const matchingSlash = trimmedLower.startsWith('/')
    ? SLASH_COMMANDS.filter((s) => s.cmd.startsWith(trimmedLower.split(/\s+/)[0]))
    : [];

  const classes = ['voice-dock', `state-${v.status}`];
  if (session) classes.push('live');
  if (v.micOn) classes.push('mic-on');
  if (minimized) classes.push('minimized');

  if (minimized) {
    return (
      <div ref={dockRef} className={classes.join(' ')} role="region" aria-label="Assistant">
        <div className="dock-mini-pill">
          <button
            type="button"
            className="dock-expand"
            onClick={() => {
              pendingFocusRef.current = true;
              setMinimized(false);
            }}
            aria-label="Expand chat"
            data-tooltip={v.reply ? v.reply.slice(0, 56) : 'Open chat (/)'}
          >
            {session ? (
              <Waveform level={v.status === 'listening' && v.micOn ? v.level : 0} />
            ) : (
              <Icon name="chat" size={16} />
            )}
            {!session && <kbd className="dock-mini-kbd" aria-hidden="true">/</kbd>}
          </button>
          {session ? (
            <>
              <button
                type="button"
                className={`dock-mic${v.micOn ? ' on' : ''}`}
                onClick={toggleMic}
                disabled={connecting}
                aria-label={v.micOn ? 'Mute the microphone' : 'Turn the microphone on'}
                data-tooltip={v.micOn ? 'Mute' : 'Unmute (Space)'}
              >
                {connecting ? <span className="dock-spinner" aria-hidden="true" />
                  : <Icon name={v.micOn ? 'mic-fill' : 'mic_off'} size={16} />}
              </button>
              <button
                type="button"
                className="dock-end"
                onClick={() => agent.stop()}
                aria-label="End the voice session"
                data-tooltip={v.micOn || connecting ? 'End (Space)' : 'End'}
              >
                <Icon name="close" size={16} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="dock-talk"
              onClick={toggleVoice}
              aria-label="Talk"
              data-tooltip="Talk (Space)"
            >
              <Icon name="mic" size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={dockRef} className={classes.join(' ')} role="region" aria-label="Assistant">
      {matchingSlash.length > 0 && (
        <div className="slash-menu" role="listbox" aria-label="Slash commands">
          {matchingSlash.map((item) => (
            <button
              key={item.cmd}
              type="button"
              className="slash-chip"
              onMouseDown={(e) => {
                e.preventDefault();
                setText(item.template);
                fieldRef.current?.focus();
              }}
            >
              <Icon name={item.icon} size={14} />
              <code>{item.cmd}</code>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
      {v.status !== 'idle' && (
        <div className="dock-live">
          <div className="dock-live-head">
            {isError ? <Icon name="error" size={15} className="dock-error-icon" />
              : <Waveform level={v.status === 'listening' && v.micOn ? v.level : 0} />}
            <span className={`dock-status${caption ? ' has-caption' : ''}`} role="status">{statusLabel(v)}</span>
            {caption && <div className="dock-text">{caption}</div>}
            {session && v.lastLatency != null && (
              <span className="dock-latency" data-tooltip="Time from your request to the change on the canvas">
                {v.lastLatency.toFixed(1)}s
              </span>
            )}
            {isError && (
              <>
                {!final && (
                  <button type="button" className="text-btn small" onClick={signInProblem ? requestSignIn : keyProblem ? openSettings : toggleVoice}>
                    {signInProblem ? 'Sign in' : keyProblem ? 'Settings' : 'Try again'}
                  </button>
                )}
                <button type="button" className="icon-btn dock-dismiss" onClick={() => agent.stop()} aria-label="Dismiss" data-tooltip="Dismiss">
                  <Icon name="close" size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <form className="dock-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={fieldRef}
          className={`dock-field${hasText ? ' has-text' : ''}`}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            } else if (e.key === 'Escape') {
              e.currentTarget.blur();
            }
          }}
          placeholder={session && v.micOn ? 'Type while talking…'
            : compact ? 'Ask anything…' : 'Ask anything, or type / for commands…'}
          aria-label="Request"
          enterKeyHint="send"
        />
        {!focused && !hasText && <kbd className="dock-kbd" aria-hidden="true" title="Press / to type">/</kbd>}

        <div className="dock-actions">
          {hasText && (
            <button type="submit" className="dock-send" aria-label="Send" data-tooltip="Send (Enter)">
              <Icon name="arrow_upward" size={17} />
            </button>
          )}
          {session ? (
            <>
              <button
                type="button"
                className={`dock-mic${v.micOn ? ' on' : ''}`}
                onClick={toggleMic}
                disabled={connecting}
                aria-label={v.micOn ? 'Mute the microphone' : 'Turn the microphone on'}
                data-tooltip={v.micOn ? 'Mute' : 'Unmute (Space)'}
              >
                {connecting ? <span className="dock-spinner" aria-hidden="true" />
                  : <Icon name={v.micOn ? 'mic-fill' : 'mic_off'} size={17} />}
              </button>
              <button
                type="button"
                className="dock-end"
                onClick={() => agent.stop()}
                aria-label="End the voice session"
                data-tooltip={v.micOn || connecting ? 'End (Space)' : 'End'}
              >
                <Icon name="close" size={16} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`dock-talk${hasText ? ' quiet' : ''}`}
              onClick={toggleVoice}
              aria-label="Talk"
              data-tooltip="Talk (Space)"
            >
              <Icon name="mic" size={17} />
            </button>
          )}
          <button
            type="button"
            className="dock-minimize"
            onClick={() => setMinimized(true)}
            aria-label="Minimize chat"
            data-tooltip="Minimize to corner"
          >
            <Icon name="remove" size={15} />
          </button>
        </div>
      </form>
    </div>
  );
}
