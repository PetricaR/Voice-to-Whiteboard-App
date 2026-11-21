/**
 * "Open in Google Slides": the deck is built as a native Google Slides
 * presentation with the Slides API (googleSlidesApi.ts: text boxes, shapes,
 * tables, linked Sheets charts, speaker notes). When the Slides API is not
 * enabled for the OAuth client, the deck's .pptx is uploaded to the user's
 * Google Drive and converted by Drive instead.
 *
 * Access is asked with Google Identity Services' token client for the narrow
 * `drive.file` scope (only files this app creates), straight from the
 * browser: the access token stays in this tab's memory for its lifetime
 * (about an hour) and never goes to the studio server.
 * https://developers.google.com/identity/oauth2/web/guides/use-token-model
 * https://developers.google.com/drive/api/guides/manage-uploads#multipart
 */
import type { DeckSpec } from '../engine/deck';
import { googleOAuthNow, loadGoogleOAuth, type GsiTokenResponse } from '../ui/googleSignIn';
import { SlidesApiError, createNativePresentation } from './googleSlidesApi';
import { PPTX_MIME, deckToPptxBlob } from './pptx';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true';
const SLIDES_MIME = 'application/vnd.google-apps.presentation';

let cached: { clientId: string; token: string; expiresAt: number } | null = null;

export class GoogleSlidesError extends Error {
  constructor(message: string, readonly code: 'cancelled' | 'not-configured' | 'api-disabled' | 'denied' | 'failed') {
    super(message);
  }
}

/** Loads Google's script ahead of a click, so the consent popup can open within it. */
export function preloadGoogleAuth(): void {
  void loadGoogleOAuth().catch(() => undefined);
}

/**
 * An access token for Drive files of this app. Call it synchronously from a
 * click: the consent popup must open within the user's gesture.
 */
export function requestDriveToken(clientId: string, opts: { forceConsent?: boolean } = {}): Promise<string> {
  if (!opts.forceConsent && cached && cached.clientId === clientId && cached.expiresAt > Date.now() + 60_000) {
    return Promise.resolve(cached.token);
  }
  const run = (oauth2: NonNullable<ReturnType<typeof googleOAuthNow>>) =>
    new Promise<string>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: (r: GsiTokenResponse) => {
          if (r.error || !r.access_token) {
            reject(new GoogleSlidesError(
              r.error === 'access_denied' ? 'Google Drive access was not allowed.' : `Google did not grant Drive access (${r.error_description ?? r.error ?? 'no token'}).`,
              r.error === 'access_denied' ? 'denied' : 'failed',
            ));
            return;
          }
          if (oauth2.hasGrantedAllScopes && !oauth2.hasGrantedAllScopes(r, DRIVE_FILE_SCOPE)) {
            reject(new GoogleSlidesError('Google Drive access was not allowed, so the deck cannot be saved there.', 'denied'));
            return;
          }
          cached = { clientId, token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
          resolve(r.access_token);
        },
        error_callback: (e) => {
          reject(new GoogleSlidesError(
            e.type === 'popup_closed' ? 'The Google window was closed before access was given.' : e.type === 'popup_failed_to_open' ? 'The browser blocked the Google window; allow popups for the studio and try again.' : `Google authorization failed (${e.message ?? e.type ?? 'unknown'}).`,
            e.type === 'popup_closed' ? 'cancelled' : 'failed',
          ));
        },
      });
      client.requestAccessToken(opts.forceConsent ? { prompt: 'consent' } : {});
    });
  const ready = googleOAuthNow();
  return ready ? run(ready) : loadGoogleOAuth().then(run);
}

/** Forgets the access token (e.g. after Google refused it). */
export function forgetDriveToken() {
  cached = null;
}

export interface UploadedPresentation {
  id: string;
  name: string;
  webViewLink: string;
  /** How it was made: native Slides API, or a converted .pptx. */
  via?: 'slides-api' | 'pptx';
  /** Something the user should know about the result (e.g. charts as tables). */
  note?: string;
}

/** Uploads a .pptx to Drive as a Google Slides presentation. */
export async function uploadPptxAsSlides(
  pptx: Blob,
  name: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadedPresentation> {
  const boundary = `deck_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const metadata = JSON.stringify({ name, mimeType: SLIDES_MIME });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${PPTX_MIME}\r\n\r\n`,
    pptx,
    `\r\n--${boundary}--`,
  ]);
  let res: Response;
  try {
    res = await fetchImpl(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  } catch {
    throw new GoogleSlidesError('Google Drive cannot be reached; check the connection.', 'failed');
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) forgetDriveToken();
    if (res.status === 403 && /accessNotConfigured|has not been used|is disabled|SERVICE_DISABLED/i.test(text)) {
      throw new GoogleSlidesError('The Google Drive API is not enabled for this studio’s OAuth client. Enable it in the Google Cloud console (APIs & Services → Library → Google Drive API), then try again.', 'api-disabled');
    }
    let detail = text.slice(0, 200);
    try {
      detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail;
    } catch {
      // not JSON
    }
    throw new GoogleSlidesError(`Google Drive refused the upload (${res.status}: ${detail}).`, res.status === 401 || res.status === 403 ? 'denied' : 'failed');
  }
  const data = JSON.parse(text) as Partial<UploadedPresentation>;
  if (!data.id) throw new GoogleSlidesError('Google Drive did not return the new presentation.', 'failed');
  return {
    id: data.id,
    name: data.name ?? name,
    webViewLink: data.webViewLink ?? `https://docs.google.com/presentation/d/${data.id}/edit`,
  };
}

/**
 * The whole flow: Drive access (popup on first use), the .pptx, the upload.
 * Start it from a click.
 */
export async function openDeckInGoogleSlides(deck: DeckSpec, clientId: string | undefined): Promise<UploadedPresentation> {
  if (!clientId) {
    throw new GoogleSlidesError(
      'Google Slides export needs a Google OAuth client: set GOOGLE_CLIENT_ID on the studio server (the same web client as sign-in) and enable the Google Drive API for its project. Download the .pptx meanwhile; Google Slides opens it too.',
      'not-configured',
    );
  }
  // The token is asked first, within the click
  const token = await requestDriveToken(clientId);
  try {
    try {
      const made = await createNativePresentation(deck, token);
      return { id: made.id, name: made.name, webViewLink: made.webViewLink, via: 'slides-api', ...(made.chartNote ? { note: made.chartNote } : {}) };
    } catch (e) {
      if (e instanceof SlidesApiError && e.status === 401) forgetDriveToken();
      // Without the Slides API, Drive converts the PowerPoint file instead
      if (!(e instanceof SlidesApiError && e.code === 'api-disabled' && e.api === 'slides')) {
        throw e instanceof SlidesApiError ? new GoogleSlidesError(e.message, e.code) : e;
      }
    }
    const file = await uploadPptxAsSlides(await deckToPptxBlob(deck), deck.title || 'Presentation', token);
    return { ...file, via: 'pptx', note: 'Converted from PowerPoint: enable the Google Slides API for native slides and linked charts.' };
  } catch (e) {
    // A revoked or expired token was forgotten: the next click asks Google again
    if (e instanceof GoogleSlidesError && e.code === 'denied' && cached == null) {
      throw new GoogleSlidesError('Google Drive access has expired. Click “Open in Google Slides” again to renew it.', 'denied');
    }
    throw e;
  }
}
