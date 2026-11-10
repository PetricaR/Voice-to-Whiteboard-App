import { useEffect, useRef, useState } from 'react';
import { aspectDimensions, type MotionSpec } from '../../engine/motion';
import { exportMotionVideo, type ExportProgress } from '../../motion-export/mp4Exporter';
import { Icon, IconButton, useStudio } from '../context';
import { fileName } from '../export';

export function ExportMp4Dialog({
  open,
  motion,
  onClose,
}: {
  open: boolean;
  motion: MotionSpec | undefined;
  onClose: () => void;
}) {
  const { store, notify } = useStudio();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [scale, setScale] = useState<1 | 0.5>(1);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      setProgress(null);
      setError(null);
      d.showModal();
    } else if (!open && d.open) {
      abortRef.current?.abort();
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d || 'closedBy' in HTMLDialogElement.prototype) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === d && !exporting) d.close();
    };
    d.addEventListener('click', onClick);
    return () => d.removeEventListener('click', onClick);
  }, [exporting]);

  const startExport = async () => {
    if (!motion) return;
    setExporting(true);
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const video = await exportMotionVideo(motion, {
        scale,
        signal: ac.signal,
        onProgress: setProgress,
      });
      const url = URL.createObjectURL(video.blob);
      const outName = fileName(store.scene, video.extension);
      const a = document.createElement('a');
      a.href = url;
      a.download = outName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      notify(`Exported ${outName} (${video.width}×${video.height})`);
      onClose();
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setExporting(false);
    }
  };

  const dims = motion ? aspectDimensions(motion.aspectRatio) : { width: 1920, height: 1080 };

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      closedby="any"
      onClose={() => {
        abortRef.current?.abort();
        onClose();
      }}
      aria-labelledby="export-mp4-title"
    >
      <header className="dialog-header">
        <h2 id="export-mp4-title">Export Animated Explainer Video</h2>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </header>

      <section className="dialog-section">
        <p className="muted-hint">
          Renders deterministic code-driven frames via WebCodecs + MP4 muxing directly in your browser — sharp typography, exact data figures, zero server upload.
        </p>

        <div className="segmented" role="radiogroup" aria-label="Export resolution">
          <button
            type="button"
            role="radio"
            aria-checked={scale === 1}
            className={scale === 1 ? 'active' : ''}
            disabled={exporting}
            onClick={() => setScale(1)}
          >
            Full HD ({dims.width}×{dims.height})
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={scale === 0.5}
            className={scale === 0.5 ? 'active' : ''}
            disabled={exporting}
            onClick={() => setScale(0.5)}
          >
            Fast Draft ({Math.round(dims.width / 2)}×{Math.round(dims.height / 2)})
          </button>
        </div>

        {progress && (
          <div className="mp4-progress-box" role="status">
            <div className="mp4-progress-head">
              <span>
                {progress.phase === 'muxing'
                  ? 'Finalizing MP4 container…'
                  : `Encoding frame ${progress.renderedFrames} / ${progress.totalFrames}`}
              </span>
              <strong>{progress.percent}%</strong>
            </div>
            <progress value={progress.percent} max={100} className="mp4-progress-bar" />
          </div>
        )}

        {error && <div className="widget-error" role="alert">{error}</div>}
      </section>

      <footer className="dialog-actions">
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            abortRef.current?.abort();
            onClose();
          }}
        >
          {exporting ? 'Cancel' : 'Close'}
        </button>
        <button type="button" className="filled-btn" disabled={exporting || !motion} onClick={startExport}>
          <Icon name="video_file" size={18} /> {exporting ? 'Rendering…' : 'Render & Download MP4'}
        </button>
      </footer>
    </dialog>
  );
}
