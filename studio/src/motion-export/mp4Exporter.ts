/**
 * Deterministic client-side MP4 video exporter using WebCodecs VideoEncoder + mp4-muxer,
 * with automatic VP9-in-MP4 and MediaRecorder (.webm) fallbacks.
 */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { aspectDimensions, totalMotionDurationMs, type MotionSpec } from '../engine/motion';
import { renderMotionFrame } from '../engine/timeline';

export interface ExportProgress {
  phase: 'preparing' | 'encoding' | 'muxing' | 'done';
  renderedFrames: number;
  totalFrames: number;
  percent: number;
}

export interface ExportedVideo {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  width: number;
  height: number;
  durationMs: number;
}

interface SelectedCodec {
  muxerCodec: 'avc' | 'vp9';
  webCodecsString: string;
}

async function pickWebCodecsConfig(width: number, height: number, fps: number): Promise<SelectedCodec | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;

  const candidates: SelectedCodec[] = [
    { muxerCodec: 'avc', webCodecsString: 'avc1.640028' },
    { muxerCodec: 'avc', webCodecsString: 'avc1.4d002a' },
    { muxerCodec: 'avc', webCodecsString: 'avc1.42002a' },
    { muxerCodec: 'avc', webCodecsString: 'avc1.42E01E' },
    { muxerCodec: 'vp9', webCodecsString: 'vp09.00.10.08' },
  ];

  for (const c of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: c.webCodecsString,
        width,
        height,
        bitrate: 5_000_000,
        framerate: fps,
      });
      if (support.supported) return c;
    } catch {
      // Try next codec candidate
    }
  }
  return null;
}

export async function exportMotionVideo(
  spec: MotionSpec,
  opts: {
    scale?: 0.5 | 1;
    onProgress?: (p: ExportProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ExportedVideo> {
  const baseDims = aspectDimensions(spec.aspectRatio);
  const scale = opts.scale ?? 1;
  // Ensure even pixel dimensions for H.264 / VP9 macroblocks
  const width = Math.round((baseDims.width * scale) / 2) * 2;
  const height = Math.round((baseDims.height * scale) / 2) * 2;
  const fps = spec.fps || 30;
  const durationMs = Math.max(1500, totalMotionDurationMs(spec));
  const totalFrames = Math.max(1, Math.ceil((durationMs / 1000) * fps));

  opts.onProgress?.({ phase: 'preparing', renderedFrames: 0, totalFrames, percent: 0 });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D context unavailable for video export.');

  const codec = await pickWebCodecsConfig(width, height, fps);

  if (codec) {
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: codec.muxerCodec,
        width,
        height,
        frameRate: fps,
      },
      fastStart: 'in-memory',
    });

    let encoderError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta);
      },
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err));
      },
    });

    encoder.configure({
      codec: codec.webCodecsString,
      width,
      height,
      bitrate: scale === 1 ? 6_000_000 : 2_800_000,
      framerate: fps,
    });

    const frameDurationUs = Math.round(1_000_000 / fps);

    for (let i = 0; i < totalFrames; i++) {
      if (opts.signal?.aborted) {
        encoder.close();
        throw new Error('Export cancelled.');
      }
      if (encoderError) throw encoderError;

      const timeMs = (i / fps) * 1000;
      renderMotionFrame(ctx, spec, timeMs, { width, height });

      const timestampUs = Math.round((i * 1_000_000) / fps);
      const frame = new VideoFrame(canvas, { timestamp: timestampUs, duration: frameDurationUs });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      // Backpressure yield so encoder queue stays bounded and UI stays responsive
      if (encoder.encodeQueueSize > 8 || i % 10 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }

      opts.onProgress?.({
        phase: 'encoding',
        renderedFrames: i + 1,
        totalFrames,
        percent: Math.round(((i + 1) / totalFrames) * 94),
      });
    }

    opts.onProgress?.({ phase: 'muxing', renderedFrames: totalFrames, totalFrames, percent: 96 });
    await encoder.flush();
    encoder.close();
    if (encoderError) throw encoderError;

    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    opts.onProgress?.({ phase: 'done', renderedFrames: totalFrames, totalFrames, percent: 100 });
    return {
      blob,
      mimeType: 'video/mp4',
      extension: 'mp4',
      width,
      height,
      durationMs,
    };
  }

  // Fallback for browsers without WebCodecs: MediaRecorder (.webm)
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    throw new Error('Neither WebCodecs VideoEncoder nor MediaRecorder is supported in this browser.');
  }

  const stream = canvas.captureStream(fps);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();
  const frameIntervalMs = 1000 / fps;
  for (let i = 0; i < totalFrames; i++) {
    if (opts.signal?.aborted) {
      recorder.stop();
      throw new Error('Export cancelled.');
    }
    const timeMs = (i / fps) * 1000;
    renderMotionFrame(ctx, spec, timeMs, { width, height });
    opts.onProgress?.({
      phase: 'encoding',
      renderedFrames: i + 1,
      totalFrames,
      percent: Math.round(((i + 1) / totalFrames) * 95),
    });
    await new Promise((r) => setTimeout(r, Math.min(16, frameIntervalMs)));
  }
  recorder.stop();
  await stopped;

  const blob = new Blob(chunks, { type: 'video/webm' });
  opts.onProgress?.({ phase: 'done', renderedFrames: totalFrames, totalFrames, percent: 100 });
  return {
    blob,
    mimeType: 'video/webm',
    extension: 'webm',
    width,
    height,
    durationMs,
  };
}
