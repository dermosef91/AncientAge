import type { SceneRenderer } from '../render/scene';

export interface HotkeyMods {
  shift: boolean;
  ctrl: boolean;
  /** Physical key, so digits survive Shift turning "1" into "!". */
  code: string;
}

/** A committed click or tap, with the modifiers and the device behind it. */
export interface PointerIntent {
  x: number;
  y: number;
  additive: boolean;
  /** True for a real mouse, so the game can pick the desktop scheme. */
  mouse: boolean;
}

export interface ControlHandlers {
  /** Touch tap, or mouse left-click: selects (mouse) or acts in context (touch). */
  onTap: (intent: PointerIntent) => void;
  onDoubleTap: (intent: PointerIntent) => void;
  /** Mouse right-click: the context order (move / attack / gather / build). */
  onCommand: (intent: PointerIntent) => void;
  onBoxSelect: (x0: number, y0: number, x1: number, y1: number, additive: boolean) => void;
  onGhostMove: (clientX: number, clientY: number) => void;
  onGhostPlace: (clientX: number, clientY: number) => void;
  onGhostCancel: () => void;
  onHover: (clientX: number, clientY: number) => void;
  onCancel: () => void;
  onHotkey: (key: string, mods: HotkeyMods) => boolean;
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
  type: string;
  shift: boolean;
}

const DRAG_THRESHOLD = 9;
const TAP_MAX_MS = 500;
const DOUBLE_TAP_MS = 320;

/** Edge scrolling, in the manner of Age of Empires. */
const EDGE_MARGIN = 22;
const EDGE_SPEED = 1150;
const KEY_PAN_SPEED = 1000;

/** Keys the camera owns; everything else is offered to the game as a hotkey. */
const PAN_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown']);

/**
 * Unified pointer handling for touch and mouse.
 *
 * Touch keeps the mobile-first scheme: drag pans, pinch zooms, a tap issues the
 * context action, and while a building is being placed a drag positions the
 * ghost instead of panning.
 *
 * Mouse follows the Age of Empires conventions instead — left selects (click or
 * rubber-band, shift to add), right issues the order, the screen edge and the
 * arrow keys scroll, and the wheel zooms. The two schemes coexist so a hybrid
 * laptop behaves sensibly whichever input the player reaches for.
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

  /** Last known mouse position, in client space, for edge scrolling. */
  private mouseX = -1;
  private mouseY = -1;
  private mouseInside = false;
  /** Edge scrolling stays off until a real mouse shows up. */
  private edgeScroll = false;

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
    window.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('blur', this.onBlur);
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
    window.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('blur', this.onBlur);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.boxEl.remove();
  }

  /** True once a mouse has been seen, so the HUD can show desktop affordances. */
  get hasMouse(): boolean {
    return this.edgeScroll;
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onBlur = (): void => {
    // Held keys would otherwise stick when the tab loses focus mid-scroll.
    this.keys.clear();
    this.mouseInside = false;
  };

  private onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.mouseInside = false;
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
      type: e.pointerType,
      shift: e.shiftKey,
    });

    if (e.pointerType === 'mouse') {
      this.edgeScroll = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseInside = true;

      // Right-click while placing cancels, matching every RTS ever shipped.
      if (e.button === 2 && this.handlers.isPlacing()) {
        this.handlers.onGhostCancel();
        return;
      }
    }

    if (this.pointers.size === 2) {
      this.beginPinch();
      this.endBox();
      return;
    }

    if (this.handlers.isPlacing()) this.handlers.onGhostMove(e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.edgeScroll = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseInside = true;
    }

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
      // A right-drag during placement is a cancel already in flight; ignore it.
      if (p.button !== 2) this.handlers.onGhostMove(e.clientX, e.clientY);
      return;
    }

    if (p.type === 'mouse') {
      if (p.button === 0) {
        // Left-drag: rubber-band selection.
        if (p.moved) {
          this.boxActive = true;
          this.drawBox(p.startX, p.startY, e.clientX, e.clientY);
        }
        return;
      }
      // Middle-drag pans; a right-drag is reserved for the order it will issue.
      if (p.button === 1 && p.moved) this.scene.panBy(dx, dy);
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
    // Shift counts whether it was held when the gesture began or when it ended.
    const additive = p.shift || e.shiftKey;

    if (this.handlers.isPlacing()) {
      if (p.type === 'mouse') {
        // Only the left button commits a placement.
        if (p.button === 0) this.handlers.onGhostPlace(e.clientX, e.clientY);
        return;
      }
      // Touch: the pointer that started the placement drag commits it.
      if (this.pointers.size === 0) this.handlers.onGhostPlace(e.clientX, e.clientY);
      return;
    }

    if (this.boxActive) {
      this.endBox();
      this.handlers.onBoxSelect(p.startX, p.startY, e.clientX, e.clientY, additive);
      return;
    }

    if (p.moved || duration >= TAP_MAX_MS) return;

    const mouse = p.type === 'mouse';
    const intent = { x: e.clientX, y: e.clientY, additive, mouse };
    if (mouse && p.button === 2) {
      this.handlers.onCommand(intent);
      return;
    }
    if (mouse && p.button !== 0) return;

    const now = performance.now();
    const isDouble =
      now - this.lastTapTime < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY) < 34;
    this.lastTapTime = now;
    this.lastTapX = e.clientX;
    this.lastTapY = e.clientY;
    if (isDouble) {
      this.lastTapTime = 0;
      this.handlers.onDoubleTap(intent);
    } else {
      this.handlers.onTap(intent);
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
    if (e.repeat) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;

    const key = e.key.toLowerCase();
    if (key === 'escape') {
      this.handlers.onCancel();
      return;
    }

    if (PAN_KEYS.has(key)) {
      e.preventDefault();
      this.keys.add(key);
      return;
    }

    // Everything else belongs to the game; it tells us whether it took the key.
    if (this.handlers.onHotkey(key, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, code: e.code })) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  /** Camera scrolling from held keys and the screen edge, called each frame. */
  update(dt: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('arrowleft')) dx += 1;
    if (this.keys.has('arrowright')) dx -= 1;
    if (this.keys.has('arrowup')) dy += 1;
    if (this.keys.has('arrowdown')) dy -= 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      this.scene.panBy((dx / len) * KEY_PAN_SPEED * dt, (dy / len) * KEY_PAN_SPEED * dt);
    }

    if (this.edgeScroll && this.mouseInside && this.pointers.size === 0) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      let ex = 0;
      let ey = 0;
      if (this.mouseX <= EDGE_MARGIN) ex = 1;
      else if (this.mouseX >= w - EDGE_MARGIN) ex = -1;
      if (this.mouseY <= EDGE_MARGIN) ey = 1;
      else if (this.mouseY >= h - EDGE_MARGIN) ey = -1;
      if (ex || ey) {
        const len = Math.hypot(ex, ey) || 1;
        this.scene.panBy((ex / len) * EDGE_SPEED * dt, (ey / len) * EDGE_SPEED * dt);
      }
    }
  }

  /** Cancels any in-flight gesture (used when the UI takes over). */
  reset(): void {
    this.pointers.clear();
    this.pinchDistance = 0;
    this.keys.clear();
    this.endBox();
  }
}
