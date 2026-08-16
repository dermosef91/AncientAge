/**
 * Fullscreen, wrapped so the rest of the UI does not have to care about vendor
 * prefixes or about the browsers that refuse outright.
 *
 * Safari still ships the webkit-prefixed API, and iPhone Safari has no element
 * fullscreen at all — `supported` is false there, and callers hide the control
 * rather than offering a button that does nothing.
 */

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

const doc = document as FullscreenDocument;

function root(): FullscreenElement {
  return document.documentElement as FullscreenElement;
}

export const fullscreenSupported: boolean =
  typeof root().requestFullscreen === 'function' ||
  typeof root().webkitRequestFullscreen === 'function';

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/**
 * Enters or leaves fullscreen. Must be called from a user gesture — a click or
 * a keypress — or the browser rejects it. Resolves to the resulting state, and
 * simply reports the current one when the request is refused.
 */
export async function toggleFullscreen(): Promise<boolean> {
  if (!fullscreenSupported) return false;
  try {
    if (isFullscreen()) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      const el = root();
      await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
    }
  } catch {
    // Denied (no gesture, or blocked by policy); leave the state as it is.
  }
  return isFullscreen();
}

/** Fires whenever the browser enters or leaves fullscreen, however it happened. */
export function onFullscreenChange(fn: (active: boolean) => void): void {
  const handler = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
}
