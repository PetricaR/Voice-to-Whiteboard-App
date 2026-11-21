/**
 * The voice agent's session lifecycle (agent/session.ts) with the browser
 * audio and the token server replaced: what the dock shows must match what
 * is really running.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let releaseMic: () => void = () => undefined;

vi.mock('../src/voice/audio', () => ({
  AudioIO: class {
    private stream: object | null = null;
    private stopped = false;
    get micActive() {
      return this.stream != null;
    }
    async start() {}
    async startMic() {
      // Waits like the browser's microphone permission prompt
      await new Promise<void>((r) => { releaseMic = r; });
      if (!this.stopped) this.stream = {};
    }
    stopMic() {
      this.stream = null;
    }
    stop() {
      this.stopped = true;
      this.stream = null;
    }
    play() {}
    stopPlayback() {}
  },
}));

vi.mock('../src/voice/liveToken', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/voice/liveToken')>();
  return {
    ...actual,
    fetchLiveToken: async () => {
      throw new actual.StudioServerError('Sign in with Google to talk to the studio.', 'signed-out');
    },
  };
});

const { VoiceAgent, DEFAULT_SETTINGS } = await import('../src/agent/session');
const { Workspace } = await import('../src/engine/workspace');

describe('VoiceAgent session lifecycle', () => {
  const realWebSocket = globalThis.WebSocket;
  beforeAll(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = class { close() {} };
  });
  afterAll(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = realWebSocket;
  });

  it('does not show the microphone as on when the session failed while the browser asked for it', async () => {
    const agent = new VoiceAgent(new Workspace(), () => DEFAULT_SETTINGS);
    const started = agent.start(true);
    // The token is refused while the permission prompt is still open
    await new Promise((r) => setTimeout(r, 0));
    expect(agent.snapshot.status).toBe('error');
    expect(agent.snapshot.errorCode).toBe('signed-out');
    releaseMic();
    await started;
    expect(agent.snapshot.micOn).toBe(false);
    expect(agent.snapshot.status).toBe('error');
    expect(agent.active).toBe(false);
  });
});
