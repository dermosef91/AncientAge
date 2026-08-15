import type { SceneRenderer } from '../render/scene';

export interface ControlHandlers {
  onTap: (clientX: number, clientY: number) => void;
  onDoubleTap: (clientX: number, clientY: number) => void;
  onBoxSelect: (x0: number, y0: number, x1: number, y1: number) => void;
  onGhostMove: (clientX: number, clientY: number) => void;
  onGhostPlace: (clientX: number, clientY: number) => void;
  onHover: (clientX: number, clientY: number) => void;
  onCancel: () => void;
  onFocusHome: () => void;
  isPlacing: () => boolean;
}

interface PointerState {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startTime: number;
  moved: boolean;
  button: number;
}

const DRAG_THRESHOLD = 9;
const TAP_MAX_MS = 500;
const DOUBLE_TAP_MS = 320;

/**
 * Unified pointer handling for touch and mouse.
 *
 * Touch: drag pans, pinch zooms, tap issues the context action, and while a
 * building is being placed a drag positions the ghost instead of panning.
 * Mouse: left-drag box-selects, right/middle-drag pans, wheel zooms.
 */
export class Controls {
  private pointers = new Map<number, PointerState>();
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private pinchDistance = 0;
  private pinchMidX = 0;
  private pinchMidY = 0;
  private boxEl: HTMLDivElement;
  private boxActive = false;
  private keys = new Set<string>();
  private disposed = false;

  constructor(
    private scene: SceneRenderer,
    private handlers: ControlHandlers,
    private overlay: HTMLElement,
  ) {
    const canvas = scene.canvas;
    canvas.style.touchAction = 'none';

    this.boxEl = document.createElement('div');
    this.boxEl.className = 'select-box';
    this.boxEl.style.display = 'none';
    overlay.appendChild(this.boxEl);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const canvas = this.scene.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.boxEl.remove();
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      startTime: performance.now(),
      moved: false,
      button: e.button,
    });

    if (this.pointers.size === 2) {
      this.beginPinch();
      this.endBox();
      return;
    }

    if (this.handlers.isPlacing()) this.handlers.onGhostMove(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);

    if (!p) {
      // Hover feedback + ghost tracking for mouse users.
      if (e.pointerType === 'mouse') {
        if (this.handlers.isPlacing()) this.handlers.onGhostMove(e.clientX, e.clientY);
        else this.handlers.onHover(e.clientX, e.clientY);
      }
      return;
    }

    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > DRAG_THRESHOLD) p.moved = true;

    if (this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }

    if (this.handlers.isPlacing()) {
      this.handlers.onGhostMove(e.clientX, e.clientY);
      return;
    }

    const isMouse = e.pointerType === 'mouse';
    if (isMouse && p.button === 0) {
      // Left-drag: rubber-band selection.
      if (p.moved) {
        this.boxActive = true;
        this.drawBox(p.startX, p.startY, e.clientX, e.clientY);
      }
      return;
    }
    if (p.moved) this.scene.panBy(dx, dy);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (!p) return;

    const duration = performance.now() - p.startTime;

    if (this.handlers.isPlacing()) {
      // Only the pointer that started the placement drag commits it.
      if (this.pointers.size === 0) this.handlers.onGhostPlace(e.clientX, e.clientY);
      return;
    }

    if (this.boxActive) {
      this.endBox();
      this.handlers.onBoxSelect(p.startX, p.startY, e.clientX, e.clientY);
      return;
    }

    if (!p.moved && duration < TAP_MAX_MS) {
      const now = performance.now();
      const isDouble =
        now - this.lastTapTime < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY) < 34;
      this.lastTapTime = now;
      this.lastTapX = e.clientX;
      this.lastTapY = e.clientY;
      if (isDouble) {
        this.lastTapTime = 0;
        this.handlers.onDoubleTap(e.clientX, e.clientY);
      } else {
        this.handlers.onTap(e.clientX, e.clientY);
      }
    }
  };

  private beginPinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    this.pinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    this.pinchMidX = (pts[0].x + pts[1].x) / 2;
    this.pinchMidY = (pts[0].y + pts[1].y) / 2;
    this.endBox();
  }

  private updatePinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    if (this.pinchDistance > 0 && d > 0) {
      const factor = this.pinchDistance / d;
      this.scene.zoomBy(Math.pow(factor, 0.9));
      this.scene.panBy(midX - this.pinchMidX, midY - this.pinchMidY);
    }
    this.pinchDistance = d;
    this.pinchMidX = midX;
    this.pinchMidY = midY;
  }

  private drawBox(x0: number, y0: number, x1: number, y1: number): void {
    const rect = this.overlay.getBoundingClientRect();
    const left = Math.min(x0, x1) - rect.left;
    const top = Math.min(y0, y1) - rect.top;
    this.boxEl.style.display = 'block';
    this.boxEl.style.left = `${left}px`;
    this.boxEl.style.top = `${top}px`;
    this.boxEl.style.width = `${Math.abs(x1 - x0)}px`;
    this.boxEl.style.height = `${Math.abs(y1 - y0)}px`;
  }

  private endBox(): void {
    this.boxActive = false;
    this.boxEl.style.display = 'none';
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0016);
    this.scene.zoomBy(factor);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.handlers.onCancel();
      return;
    }
    if (e.key === ' ' || e.key === 'Home') {
      e.preventDefault();
      this.handlers.onFocusHome();
      return;
    }
    this.keys.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  /** Keyboard panning, called each frame. */
  update(dt: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx += 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx -= 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= 1;
    if (dx || dy) this.scene.panBy(dx * 900 * dt, dy * 900 * dt);
    if (this.keys.has('q')) this.scene.zoomBy(Math.exp(-1.3 * dt));
    if (this.keys.has('e')) this.scene.zoomBy(Math.exp(1.3 * dt));
  }

  /** Cancels any in-flight gesture (used when the UI takes over). */
  reset(): void {
    this.pointers.clear();
    this.pinchDistance = 0;
    this.endBox();
  }
}
