import { useCallback, useEffect, useRef, useState } from 'react';
import { googleDocsApi, type GoogleDocsMcpStatus } from '../data/googleDocsClient';
import type { KeyStatus } from '../voice/liveToken';
import { Icon, IconButton, useStudio } from './context';
import { closeTopLayerElement, useDialogLightDismiss } from './domTransitions';
import type { IconName } from './icons';
import { LIVE_MODELS, VOICES, type Settings } from './settings';
import { SEED_COLORS, type ThemeMode } from './theme';

const SEED_NAMES: Record<string, string> = {
  '#3367d6': 'Blue',
  '#0b8043': 'Green',
  '#7b5cd6': 'Purple',
  '#c2185b': 'Pink',
  '#00838f': 'Teal',
  '#e37400': 'Amber',
};

const KEY_STATUS: Record<KeyStatus, { icon: IconName; text: string }> = {
  configured: {
    icon: 'lock',
    text: 'Kept on the studio server. This browser never sees it: every session gets a single-use token that expires within 30 minutes.',
  },
  missing: {
    icon: 'error',
    text: 'The studio server has no key yet. In a terminal, run ./studio.sh key (on a Mac it goes into the Keychain), then try again.',
  },
  unknown: {
    icon: 'error',
    text: 'The studio server cannot be reached, so voice is off. Start the app with ./studio.sh.',
  },
};

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, setSettings, liveKey, refreshLiveKey } = useStudio();
  const [draft, setDraft] = useState<Settings>(settings);
  const [docsStatus, setDocsStatus] = useState<GoogleDocsMcpStatus | null>(null);
  const [docsTesting, setDocsTesting] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const keyStatus = KEY_STATUS[liveKey];

  const loadDocsStatus = useCallback(async (verify = false) => {
    setDocsTesting(verify);
    try {
      const s = await googleDocsApi.status({ verify });
      setDocsStatus(s);
    } catch {
      setDocsStatus(null);
    } finally {
      setDocsTesting(false);
    }
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (d == null) return;
    if (open) {
      d.removeAttribute('data-closing');
      if (!d.open) {
        setDraft(settings);
        refreshLiveKey();
        loadDocsStatus(false).catch(() => undefined);
        d.showModal();
      }
      return;
    }
    if (!d.open) return;
    let cancelled = false;
    void closeTopLayerElement(d, () => {
      if (!cancelled && d.open) d.close();
    }, 240);
    return () => {
      cancelled = true;
    };
  }, [open, settings, refreshLiveKey, loadDocsStatus]);

  useDialogLightDismiss(ref, onClose);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const save = () => {
    setSettings(draft);
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      closedby="any"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      aria-labelledby="settings-title"
    >
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <header className="dialog-header">
          <h2 id="settings-title">Settings</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>

        <section className="dialog-section">
          <h3>Gemini</h3>
          <div className="field">
            <span id="settings-api-key">API key</span>
            <p className={`key-status ${liveKey}`} role="status" aria-labelledby="settings-api-key">
              <Icon name={keyStatus.icon} size={20} />
              <span>{keyStatus.text}</span>
            </p>
            <small>Get a key at aistudio.google.com/apikey and restrict it to the Generative Language API.</small>
          </div>
          <div className="field">
            <label htmlFor="settings-live-model">Live model</label>
            <input
              id="settings-live-model"
              list="live-models"
              value={draft.model}
              onChange={(e) => set('model', e.target.value.trim())}
              spellCheck={false}
              aria-describedby="settings-live-model-hint"
            />
            <datalist id="live-models">
              {LIVE_MODELS.map((m) => <option key={m} value={m} />)}
            </datalist>
            <small id="settings-live-model-hint">Models with “thinking” reason more before they edit, but answer slower.</small>
          </div>
          <div className="field-grid">
            <label className="field">
              <span>Voice</span>
              <select value={draft.voice} onChange={(e) => set('voice', e.target.value)}>
                {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Pause before answering: {(draft.silenceDurationMs / 1000).toFixed(1)} s</span>
              <input
                type="range" min={300} max={1500} step={100}
                value={draft.silenceDurationMs}
                onChange={(e) => set('silenceDurationMs', Number(e.target.value))}
              />
            </label>
          </div>
        </section>

        <section className="dialog-section">
          <h3>Official Google Documentation (MCP)</h3>
          <div className="field">
            <span id="settings-docs-mcp">Developer Knowledge MCP Server</span>
            {(() => {
              const bad = docsStatus == null || !docsStatus.configured || docsStatus.lastErrorCode != null;
              const statusClass = docsStatus == null ? 'unknown' : bad ? 'missing' : 'configured';
              const icon: IconName = docsStatus == null
                ? 'error'
                : docsStatus.lastErrorCode != null || !docsStatus.configured
                  ? 'warning'
                  : docsStatus.verified
                    ? 'check_circle'
                    : 'verified_user';
              const summary = docsStatus == null
                ? 'Could not reach the studio server to check Google Developer Knowledge MCP status.'
                : docsStatus.lastError
                  ? docsStatus.lastError
                  : docsStatus.configured
                    ? `Connected to ${docsStatus.endpoint} via ${
                        docsStatus.authMode === 'api-key'
                          ? 'DEVELOPERKNOWLEDGE_API_KEY'
                          : docsStatus.authMode === 'adc'
                            ? `Google Cloud ADC${docsStatus.projectId ? ` (${docsStatus.projectId})` : ''}`
                            : 'OAuth bearer token'
                      }${docsStatus.verified ? ' · Live probe succeeded' : ''}.`
                    : `Not configured yet. ${docsStatus.setupHint ?? ''}`;
              return (
                <>
                  <p className={`key-status ${statusClass}`} role="status" aria-labelledby="settings-docs-mcp">
                    <Icon name={icon} size={20} />
                    <span>{summary}</span>
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                    <button
                      type="button"
                      className="tonal-btn"
                      disabled={docsTesting}
                      onClick={() => { loadDocsStatus(true).catch(() => undefined); }}
                    >
                      <Icon name="refresh" size={16} />
                      {docsTesting ? 'Testing MCP…' : 'Test live MCP connection'}
                    </button>
                    {docsStatus?.enableUrl && (
                      <a
                        className="text-btn"
                        href={docsStatus.enableUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon name="open_in_new" size={15} /> Enable API in Cloud Console
                      </a>
                    )}
                  </div>
                </>
              );
            })()}
            <small>
              Uses Google’s official <code>developerknowledge.googleapis.com/mcp</code> server (<code>search_documents</code>,{' '}
              <code>get_documents</code>, <code>answer_query</code>). Enable with{' '}
              <code>gcloud services enable developerknowledge.googleapis.com</code> and set{' '}
              <code>DEVELOPERKNOWLEDGE_API_KEY</code> in <code>studio/.env</code> or sign in with <code>gcloud auth application-default login</code>.
            </small>
          </div>
        </section>

        <section className="dialog-section">
          <h3>Appearance</h3>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as ThemeMode[]).map((m, i, arr) => (
              <button
                key={m} type="button" role="radio" aria-checked={draft.themeMode === m}
                tabIndex={draft.themeMode === m ? 0 : -1}
                className={draft.themeMode === m ? 'active' : ''}
                onClick={() => set('themeMode', m)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = arr[(i + 1) % arr.length];
                    set('themeMode', next);
                    (e.currentTarget.parentElement?.children[(i + 1) % arr.length] as HTMLElement | undefined)?.focus();
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = arr[(i - 1 + arr.length) % arr.length];
                    set('themeMode', prev);
                    (e.currentTarget.parentElement?.children[(i - 1 + arr.length) % arr.length] as HTMLElement | undefined)?.focus();
                  }
                }}
              >
                {draft.themeMode === m && <Icon name="check" size={18} />}
                {m === 'system' ? 'System' : m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <div className="seed-row" role="radiogroup" aria-label="Accent color">
            {SEED_COLORS.map((c, i, arr) => (
              <button
                key={c} type="button" role="radio" aria-checked={draft.seedColor === c}
                aria-label={`${SEED_NAMES[c] ?? c} accent`}
                tabIndex={draft.seedColor === c ? 0 : -1}
                className={`seed${draft.seedColor === c ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => set('seedColor', c)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = arr[(i + 1) % arr.length];
                    set('seedColor', next);
                    (e.currentTarget.parentElement?.children[(i + 1) % arr.length] as HTMLElement | undefined)?.focus();
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = arr[(i - 1 + arr.length) % arr.length];
                    set('seedColor', prev);
                    (e.currentTarget.parentElement?.children[(i - 1 + arr.length) % arr.length] as HTMLElement | undefined)?.focus();
                  }
                }}
              >
                {draft.seedColor === c && <Icon name="check" size={18} />}
              </button>
            ))}
          </div>
        </section>

        <footer className="dialog-actions">
          <button type="button" className="text-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="filled-btn">Save</button>
        </footer>
      </form>
    </dialog>
  );
}
