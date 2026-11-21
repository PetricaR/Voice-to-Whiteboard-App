/**
 * Getting a deck out of the studio: an editable PowerPoint download, or a
 * Google Slides presentation in the user's Drive. Both modules load on first
 * use, so the studio does not carry the PowerPoint writer until it is needed.
 */
import type { DeckSpec } from '../../engine/deck';
import { download } from '../export';

type Notify = (message: string, action?: { label: string; run: () => void }) => void;

export function deckFileName(deck: DeckSpec): string {
  const base = (deck.title || 'deck').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'deck'}.pptx`;
}

/** Loads the export modules ahead of a click (the Google consent popup must open within it). */
export function preloadDeckExport(withGoogle: boolean) {
  void import('../../deck-export/pptx').catch(() => undefined);
  if (withGoogle) {
    void import('../../deck-export/googleSlides').then((m) => m.preloadGoogleAuth()).catch(() => undefined);
  }
}

export async function downloadDeckPptx(deck: DeckSpec, notify: Notify): Promise<void> {
  try {
    const { deckToPptxBlob, PPTX_MIME } = await import('../../deck-export/pptx');
    const blob = await deckToPptxBlob(deck);
    download(deckFileName(deck), blob, PPTX_MIME);
    notify(`Downloaded “${deck.title}” as PowerPoint (${deck.slides.length} slides, editable charts and speaker notes).`);
  } catch (e) {
    notify(`The PowerPoint file could not be made (${e instanceof Error ? e.message : String(e)}).`);
  }
}

/** Uploads the deck to the user's Drive as Google Slides. Call it from a click. */
export async function openDeckInGoogleSlides(deck: DeckSpec, clientId: string | undefined, notify: Notify): Promise<void> {
  try {
    const m = await import('../../deck-export/googleSlides');
    notify('Saving the deck to your Google Drive…');
    const file = await m.openDeckInGoogleSlides(deck, clientId);
    notify(`“${file.name}” is in your Google Drive as Google Slides${file.via === 'slides-api' ? ' (native slides, speaker notes)' : ''}.${file.note ? ` ${file.note}` : ''}`, {
      label: 'Open',
      run: () => window.open(file.webViewLink, '_blank', 'noopener'),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if ((e as { code?: string }).code === 'cancelled') {
      notify('Google Slides export cancelled.');
      return;
    }
    notify(message, { label: 'Download .pptx', run: () => void downloadDeckPptx(deck, notify) });
  }
}
