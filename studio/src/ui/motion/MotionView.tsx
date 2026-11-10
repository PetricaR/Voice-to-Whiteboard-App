import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryExecutionResult } from '../../data/sqlEngine';
import {
  ASPECT_RATIOS,
  EASING_PRESETS,
  TRANSITION_KINDS,
  aspectDimensions,
  totalMotionDurationMs,
  type AspectRatio,
  type EasingPreset,
  type MotionLayer,
  type MotionScene,
  type TransitionKind,
} from '../../engine/motion';
import { evaluateMotionAt, renderMotionFrame, type LayerHitBox } from '../../engine/timeline';
import { COLORS, type ColorName } from '../../engine/types';
import { Icon, IconButton, useStoreRevision, useStudio } from '../context';
import { ExportMp4Dialog } from './ExportMp4Dialog';

export interface MotionCommand {
  id: number;
  action: 'play' | 'pause' | 'restart' | 'seek' | 'export_mp4';
  timeMs?: number;
}

function formatTimecode(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = (totalSec % 60).toFixed(1).padStart(4, '0');
  return `${String(mins).padStart(2, '0')}:${secs}`;
}

export function MotionView({
  dashboardResults,
  command,
}: {
  dashboardResults?: Record<string, QueryExecutionResult | undefined>;
  command?: MotionCommand | null;
}) {
  const { store, notify } = useStudio();
  useStoreRevision(store);
  const motion = store.scene.motion;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitBoxesRef = useRef<LayerHitBox[]>([]);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(950);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [voiceoverOn, setVoiceoverOn] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const lastSpokenSceneRef = useRef<string | null>(null);

  const totalMs = useMemo(() => (motion ? Math.max(1500, totalMotionDurationMs(motion)) : 0), [motion]);

  // Clamp playhead when scene durations change
  useEffect(() => {
    if (totalMs > 0 && timeMs > totalMs) setTimeMs(totalMs);
  }, [totalMs]);

  // Execute agent `control_motion` commands
  useEffect(() => {
    if (!command) return;
    switch (command.action) {
      case 'play':
        if (timeMs >= totalMs - 40) setTimeMs(0);
        setPlaying(true);
        break;
      case 'pause':
        setPlaying(false);
        break;
      case 'restart':
        setTimeMs(0);
        setPlaying(true);
        break;
      case 'seek':
        setTimeMs(Math.max(0, Math.min(totalMs, command.timeMs ?? 0)));
        break;
      case 'export_mp4':
        setPlaying(false);
        setExportOpen(true);
        break;
    }
  }, [command?.id]);

  // 60fps requestAnimationFrame loop during playback
  useEffect(() => {
    if (!playing || !motion) return;
    let raf = 0;
    let lastTs = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - lastTs);
      lastTs = now;
      setTimeMs((prev) => {
        const next = prev + dt;
        if (next >= totalMs) {
          setPlaying(false);
          return totalMs;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, motion, totalMs]);

  // Optional Web Speech narration synced to scene changes
  useEffect(() => {
    if (!playing || !voiceoverOn || !motion || typeof speechSynthesis === 'undefined') {
      if (!playing && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      return;
    }
    const ev = evaluateMotionAt(motion, timeMs);
    if (ev.scene.id !== lastSpokenSceneRef.current && ev.scene.narration) {
      lastSpokenSceneRef.current = ev.scene.id;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(ev.scene.narration);
      u.rate = 1.04;
      speechSynthesis.speak(u);
    }
  }, [playing, voiceoverOn, motion, timeMs]);

  // Render deterministic frame onto the <canvas> stage whenever timeMs or spec changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !motion) return;
    const dims = aspectDimensions(motion.aspectRatio);
    if (canvas.width !== dims.width || canvas.height !== dims.height) {
      canvas.width = dims.width;
      canvas.height = dims.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { hitBoxes } = renderMotionFrame(ctx, motion, timeMs, {
      selectedLayerId: selectedLayerId ?? undefined,
      width: dims.width,
      height: dims.height,
    });
    hitBoxesRef.current = hitBoxes;
  }, [motion, timeMs, selectedLayerId]);

  const handleStageClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(1, rect.width);
      const scaleY = canvas.height / Math.max(1, rect.height);
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // Top-most drawn layer wins
      const boxes = [...hitBoxesRef.current].reverse();
      const hit = boxes.find((b) => x >= b.px && x <= b.px + b.pw && y >= b.py && y <= b.py + b.ph);
      if (hit) {
        setSelectedLayerId(hit.layerId);
        store.setSelection([hit.layerId]);
      } else {
        setSelectedLayerId(null);
      }
    },
    [store],
  );

  if (!motion) {
    return (
      <section className="surface-empty-view">
        <div className="surface-empty-card">
          <Icon name="movie" size={34} />
          <h2>Programmatic Motion Studio</h2>
          <p>
            Turn live SQL dashboards, architecture diagrams, or spoken storyboards into deterministic, code-backed
            animated explainers — edit any word, counter, or millisecond directly and export crisp MP4 video.
          </p>
          <div className="surface-empty-actions">
            <button
              type="button"
              className="filled-btn"
              onClick={() => {
                store.createMotion(
                  { from_current_page: true },
                  { source: 'manual', label: 'Generated Motion Explainer from page' },
                  dashboardResults,
                );
                setTimeMs(0);
                setPlaying(true);
              }}
            >
              <Icon name="play_arrow" size={18} /> Generate Explainer from Active Page
            </button>
          </div>
        </div>
      </section>
    );
  }

  const evaluated = evaluateMotionAt(motion, timeMs);
  const activeScene: MotionScene = evaluated.scene;
  const selectedLayer: MotionLayer | null =
    activeScene.layers.find((l) => l.id === selectedLayerId) ??
    motion.scenes.flatMap((s) => s.layers).find((l) => l.id === selectedLayerId) ??
    null;

  let sceneStartAccum = 0;
  const sceneSpans = motion.scenes.map((s) => {
    const start = sceneStartAccum;
    sceneStartAccum += s.durationMs;
    return { scene: s, startMs: start, endMs: sceneStartAccum };
  });

  return (
    <div className="motion-studio-view">
      <header className="motion-toolbar">
        <div className="motion-transport-left">
          <button
            type="button"
            className="filled-btn small"
            aria-label={playing ? 'Pause animation' : 'Play animation'}
            onClick={() => {
              if (!playing && timeMs >= totalMs - 40) setTimeMs(0);
              lastSpokenSceneRef.current = null;
              setPlaying(!playing);
            }}
          >
            <Icon name={playing ? 'pause' : 'play_arrow'} size={18} />
            {playing ? 'Pause' : 'Play'}
          </button>
          <IconButton
            icon="skip_previous"
            label="Restart from 00:00"
            onClick={() => {
              setPlaying(false);
              setTimeMs(0);
            }}
          />
          <span className="motion-timecode" aria-live="off">
            {formatTimecode(timeMs)} / {formatTimecode(totalMs)}
          </span>
        </div>

        <div className="motion-transport-right">
          <label className="dash-filter-chip" title="Aspect ratio">
            <Icon name="aspect_ratio" size={15} />
            <select
              aria-label="Video aspect ratio"
              value={motion.aspectRatio}
              onChange={(e) =>
                store.editMotion(
                  { aspect_ratio: e.target.value as AspectRatio },
                  { source: 'manual', label: `Aspect ratio ${e.target.value}` },
                )
              }
            >
              {ASPECT_RATIOS.map((ar) => (
                <option key={ar} value={ar}>{ar}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={`tonal-btn small ${motion.showCaptions ? 'active' : ''}`}
            onClick={() =>
              store.editMotion(
                { show_captions: !motion.showCaptions },
                { source: 'manual', label: motion.showCaptions ? 'Hid captions' : 'Enabled captions' },
              )
            }
            title="Toggle kinetic captions"
          >
            <Icon name="subtitles" size={16} /> Captions
          </button>

          <button
            type="button"
            className={`tonal-btn small ${voiceoverOn ? 'active' : ''}`}
            onClick={() => setVoiceoverOn((v) => !v)}
            title="Toggle spoken narration preview"
          >
            <Icon name={voiceoverOn ? 'volume_up' : 'volume_off'} size={16} /> Voiceover
          </button>

          <button
            type="button"
            className="tonal-btn small"
            onClick={() => {
              store.createMotion(
                { from_current_page: true, aspect_ratio: motion.aspectRatio },
                { source: 'manual', label: 'Resynced Motion Explainer with page data' },
                dashboardResults,
              );
              setTimeMs(0);
              notify('Re-synced Motion scenes with latest page metrics.');
            }}
          >
            <Icon name="refresh" size={16} /> Sync Page Data
          </button>

          <button
            type="button"
            className="filled-btn small"
            onClick={() => {
              setPlaying(false);
              setExportOpen(true);
            }}
          >
            <Icon name="video_file" size={16} /> Export MP4
          </button>
        </div>
      </header>

      <div className="motion-main-split">
        <div className="motion-stage-column">
          <div className={`motion-stage-viewport ratio-${motion.aspectRatio.replace(':', '-')}`}>
            <canvas
              ref={canvasRef}
              className="motion-stage-canvas"
              onClick={handleStageClick}
              aria-label={`Animated explainer stage: ${motion.title}`}
            />
          </div>

          <div className="motion-timeline-panel">
            <input
              type="range"
              className="motion-scrubber-range"
              aria-label="Timeline playhead"
              min={0}
              max={totalMs}
              step={16}
              value={Math.round(timeMs)}
              onChange={(e) => {
                setPlaying(false);
                setTimeMs(Number(e.target.value));
              }}
            />
            <div className="motion-scene-track" role="list" aria-label="Storyboard scenes">
              {sceneSpans.map(({ scene: s, startMs }, idx) => {
                const widthPct = (s.durationMs / totalMs) * 100;
                const isCurrent = s.id === activeScene.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="listitem"
                    className={`scene-track-block ${isCurrent ? 'active' : ''}`}
                    style={{ width: `${widthPct}%` }}
                    onClick={() => {
                      setPlaying(false);
                      setTimeMs(startMs + 250);
                      setSelectedLayerId(s.layers[0]?.id ?? null);
                    }}
                  >
                    <span className="scene-idx">{idx + 1}</span>
                    <span className="scene-name">{s.title}</span>
                    <small>{(s.durationMs / 1000).toFixed(1)}s</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="motion-inspector-panel" aria-label="Scene and layer properties">
          <div className="motion-inspector-section">
            <div className="motion-inspector-head">
              <h3>Scene {evaluated.sceneIndex + 1}: {activeScene.title}</h3>
              <button
                type="button"
                className="text-btn small"
                onClick={() =>
                  store.editMotion(
                    {
                      add_scenes: [
                        {
                          title: `Scene ${motion.scenes.length + 1}`,
                          durationMs: 4200,
                          transition: 'slide_left',
                          narration: 'Additional highlight scene.',
                          layers: [
                            { kind: 'badge', text: 'NEW SCENE', color: 'teal', enterAtMs: 0 },
                            { kind: 'kinetic_text', text: 'Key Insight', subtext: 'Click to customize copy or ask Gemini Live', size: 'lg', enterAtMs: 180 },
                          ],
                        },
                      ],
                    },
                    { source: 'manual', label: 'Added motion scene' },
                  )
                }
              >
                <Icon name="add" size={15} /> Scene
              </button>
            </div>

            <div className="inspector-field-row">
              <label>
                <span>Scene Title</span>
                <input
                  value={activeScene.title}
                  onChange={(e) =>
                    store.editMotion(
                      { update_scenes: [{ id: activeScene.id, title: e.target.value }] },
                      { source: 'manual', label: 'Renamed motion scene' },
                    )
                  }
                />
              </label>
              <label>
                <span>Duration (ms)</span>
                <input
                  type="number"
                  min={1500}
                  max={25000}
                  step={200}
                  value={activeScene.durationMs}
                  onChange={(e) =>
                    store.editMotion(
                      { update_scenes: [{ id: activeScene.id, durationMs: Number(e.target.value) }] },
                      { source: 'manual', label: 'Adjusted scene duration' },
                    )
                  }
                />
              </label>
            </div>

            <div className="inspector-field-row">
              <label>
                <span>Transition</span>
                <select
                  value={activeScene.transition}
                  onChange={(e) =>
                    store.editMotion(
                      { update_scenes: [{ id: activeScene.id, transition: e.target.value as TransitionKind }] },
                      { source: 'manual', label: 'Changed transition' },
                    )
                  }
                >
                  {TRANSITION_KINDS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label>
                <span>Accent</span>
                <select
                  value={activeScene.accentColor ?? 'blue'}
                  onChange={(e) =>
                    store.editMotion(
                      { update_scenes: [{ id: activeScene.id, accent_color: e.target.value as ColorName }] },
                      { source: 'manual', label: 'Changed scene accent' },
                    )
                  }
                >
                  {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>

            <label className="inspector-full-field">
              <span>Caption / Narration</span>
              <input
                value={activeScene.narration ?? ''}
                placeholder="Spoken narration & kinetic caption…"
                onChange={(e) =>
                  store.editMotion(
                    { update_scenes: [{ id: activeScene.id, narration: e.target.value }] },
                    { source: 'manual', label: 'Updated scene caption' },
                  )
                }
              />
            </label>

            <div className="layer-chip-list">
              <span className="sub-eyebrow">Layers in Scene (click stage or chip to edit)</span>
              <div className="layer-chips">
                {activeScene.layers.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`layer-chip ${selectedLayer?.id === l.id ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedLayerId(l.id);
                      store.setSelection([l.id]);
                    }}
                  >
                    <code>{l.kind}</code> {l.text || l.id}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {selectedLayer && (
            <div className="motion-inspector-section selected-layer-editor">
              <div className="motion-inspector-head">
                <h3>Layer: <code>{selectedLayer.id}</code></h3>
                <IconButton
                  icon="delete"
                  label="Remove layer"
                  onClick={() => {
                    store.editMotion(
                      { remove_layers: [selectedLayer.id] },
                      { source: 'manual', label: `Removed layer ${selectedLayer.id}` },
                    );
                    setSelectedLayerId(null);
                  }}
                />
              </div>

              {selectedLayer.text !== undefined && (
                <label className="inspector-full-field">
                  <span>Primary Copy / Label</span>
                  <input
                    aria-label="Layer primary copy"
                    value={selectedLayer.text}
                    onChange={(e) =>
                      store.editMotion(
                        { update_layers: [{ id: selectedLayer.id, text: e.target.value }] },
                        { source: 'manual', label: `Edited text on ${selectedLayer.id}` },
                      )
                    }
                  />
                </label>
              )}

              {selectedLayer.subtext !== undefined && (
                <label className="inspector-full-field">
                  <span>Subtitle / Supporting Copy</span>
                  <input
                    value={selectedLayer.subtext}
                    onChange={(e) =>
                      store.editMotion(
                        { update_layers: [{ id: selectedLayer.id, subtext: e.target.value }] },
                        { source: 'manual', label: `Edited subtext on ${selectedLayer.id}` },
                      )
                    }
                  />
                </label>
              )}

              {selectedLayer.kind === 'metric_counter' && (
                <div className="inspector-field-row">
                  <label>
                    <span>Target Value</span>
                    <input
                      type="number"
                      step="any"
                      value={selectedLayer.value ?? 0}
                      onChange={(e) =>
                        store.editMotion(
                          { update_layers: [{ id: selectedLayer.id, value: Number(e.target.value) }] },
                          { source: 'manual', label: `Updated counter value` },
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Prefix / Suffix</span>
                    <div className="inline-pair">
                      <input
                        placeholder="$"
                        value={selectedLayer.prefix ?? ''}
                        onChange={(e) =>
                          store.editMotion(
                            { update_layers: [{ id: selectedLayer.id, prefix: e.target.value }] },
                            { source: 'manual', label: 'Updated prefix' },
                          )
                        }
                      />
                      <input
                        placeholder="M / %"
                        value={selectedLayer.suffix ?? ''}
                        onChange={(e) =>
                          store.editMotion(
                            { update_layers: [{ id: selectedLayer.id, suffix: e.target.value }] },
                            { source: 'manual', label: 'Updated suffix' },
                          )
                        }
                      />
                    </div>
                  </label>
                </div>
              )}

              <div className="inspector-field-row">
                <label>
                  <span>Enter At (ms)</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={selectedLayer.enterAtMs}
                    onChange={(e) =>
                      store.editMotion(
                        { update_layers: [{ id: selectedLayer.id, enterAtMs: Number(e.target.value) }] },
                        { source: 'manual', label: 'Adjusted layer entrance timing' },
                      )
                    }
                  />
                </label>
                <label>
                  <span>Easing</span>
                  <select
                    value={selectedLayer.easing}
                    onChange={(e) =>
                      store.editMotion(
                        { update_layers: [{ id: selectedLayer.id, easing: e.target.value as EasingPreset }] },
                        { source: 'manual', label: 'Changed layer easing' },
                      )
                    }
                  >
                    {EASING_PRESETS.map((ep) => <option key={ep} value={ep}>{ep}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}
        </aside>
      </div>

      <ExportMp4Dialog open={exportOpen} motion={motion} onClose={() => setExportOpen(false)} />
    </div>
  );
}
