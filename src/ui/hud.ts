import { formatClock, formatCount } from '../core/math';
import {
  BUILDINGS,
  BUILD_ORDER,
  FACTIONS,
  TECHS,
  UNITS,
  buildingCost,
  canAfford,
  trainableAt,
} from '../sim/data';
import type { Game } from '../sim/game';
import type { Building, BuildingTypeId, Cost, Entity, ResourceKind, TechId, Unit, UnitTypeId } from '../sim/types';
import { fullscreenSupported } from './fullscreen';
import { icon } from './icons';

export interface HudCallbacks {
  onBuildToggle: () => void;
  onPickBuilding: (type: BuildingTypeId) => void;
  onTrain: (buildingId: number, type: UnitTypeId) => void;
  onCancelTrain: (buildingId: number, index: number) => void;
  onResearch: (buildingId: number, tech: TechId) => void;
  onCancelResearch: (buildingId: number) => void;
  onSetRally: (buildingId: number) => void;
  onStop: () => void;
  onGather: () => void;
  onSelectArmy: () => void;
  onSelectIdle: () => void;
  onFocusHome: () => void;
  onToggleMute: () => boolean;
  onMenu: () => void;
  onMinimapPoint: (px: number, py: number) => void;
  onMinimapCommand: (px: number, py: number) => void;
  onCoachDismiss: () => void;
  onHelp: () => void;
  onFullscreen: () => void;
}

/**
 * Panel hotkeys. W, A, S and D belong to the camera, so the rows step around
 * them: the top row of a panel takes Q E R T Y and the build menu's category
 * tabs take Z X C V underneath.
 */
const PANEL_KEYS = ['q', 'e', 'r', 't', 'y'];
const TAB_KEYS = ['z', 'x', 'c', 'v'];
export const GRID_KEYS = [...PANEL_KEYS, ...TAB_KEYS];

/** Slot at which the category strip starts. */
const CATEGORY_SLOT = PANEL_KEYS.length;

interface BuildCategory {
  id: string;
  name: string;
  icon: string;
  members: BuildingTypeId[];
}

const BUILD_CATEGORIES: BuildCategory[] = [
  { id: 'economy', name: 'Economy', icon: 'house', members: ['house', 'farm', 'storehouse', 'dock'] },
  { id: 'military', name: 'Military', icon: 'barracks', members: ['barracks', 'range'] },
  { id: 'defenses', name: 'Defenses', icon: 'tower', members: ['tower', 'wall'] },
  { id: 'civic', name: 'Civic', icon: 'monument', members: ['monument', 'towncenter'] },
];

function gridBadge(slot: number): string {
  const k = GRID_KEYS[slot];
  return k ? `<span class="hk">${k.toUpperCase()}</span>` : '';
}

export interface Objective {
  text: string;
  detail?: string;
  done: boolean;
}

const RES_ORDER: ResourceKind[] = ['food', 'wood', 'gold', 'stone'];

function costHtml(cost: Cost, res: { food: number; wood: number; gold: number; stone: number } | null): string {
  const parts: string[] = [];
  for (const k of RES_ORDER) {
    const v = cost[k];
    if (!v) continue;
    const short = res ? res[k] < v : false;
    parts.push(`<em class="${short ? 'short' : ''}">${icon(k)}${v}</em>`);
  }
  return parts.join('');
}

function costText(cost: Cost): string {
  const parts: string[] = [];
  for (const k of RES_ORDER) {
    const v = cost[k];
    if (v) parts.push(`${v} ${k}`);
  }
  return parts.join(' · ');
}

export class Hud {
  readonly root: HTMLElement;
  readonly minimapCanvas: HTMLCanvasElement;

  private resEls = new Map<string, HTMLElement>();
  private ageName!: HTMLElement;
  private ageNumeral!: HTMLElement;
  private clock!: HTMLElement;
  private objectivesEl!: HTMLElement;
  private selectionEl!: HTMLElement;
  private buildMenuEl!: HTMLElement;
  private buildFab!: HTMLButtonElement;
  private toastsEl!: HTMLElement;
  private coachEl!: HTMLElement;
  private coachText!: HTMLElement;
  private muteBtn!: HTMLButtonElement;
  private idleBadge!: HTMLElement;
  private vignette!: HTMLElement;
  private fpsEl!: HTMLElement;

  private selSignature = '';
  private buildSignature = '';
  private dynamicUpdaters: (() => void)[] = [];
  private minimapRect = { w: 1, h: 1 };
  private lastResValues: Record<string, number> = {};

  /** Buttons reachable by grid hotkey, in render order, per panel. */
  private buildGrid: HTMLButtonElement[] = [];
  private selGrid: HTMLButtonElement[] = [];
  private buildCategory = BUILD_CATEGORIES[0].id;
  private buildFocus: BuildingTypeId | null = null;
  private helpEl!: HTMLElement;
  private groupsEl!: HTMLElement;
  private fullscreenBtn!: HTMLButtonElement;

  constructor(root: HTMLElement, private cb: HudCallbacks) {
    this.root = root;
    root.innerHTML = this.template();

    for (const k of [...RES_ORDER, 'pop']) {
      const el = root.querySelector<HTMLElement>(`[data-res="${k}"] span.val`);
      if (el) this.resEls.set(k, el);
    }
    this.ageName = root.querySelector('.age-name')!;
    this.ageNumeral = root.querySelector('.age-numeral')!;
    this.clock = root.querySelector('.clock')!;
    this.objectivesEl = root.querySelector('.objectives')!;
    this.selectionEl = root.querySelector('.selection')!;
    this.buildMenuEl = root.querySelector('.build-menu')!;
    this.buildFab = root.querySelector('.build-fab')!;
    this.toastsEl = root.querySelector('.toasts')!;
    this.coachEl = root.querySelector('.coach')!;
    this.coachText = root.querySelector('.coach .txt')!;
    this.muteBtn = root.querySelector('[data-act="mute"]')!;
    this.idleBadge = root.querySelector('[data-act="idle"] .badge')!;
    this.vignette = root.querySelector('.hurt-vignette')!;
    this.fpsEl = root.querySelector('.fps')!;
    this.minimapCanvas = root.querySelector('canvas.minimap')!;
    this.helpEl = root.querySelector('.help')!;
    this.groupsEl = root.querySelector('.groups')!;
    this.fullscreenBtn = root.querySelector('[data-act="fullscreen"]')!;
    // A browser that cannot go fullscreen should not offer the button.
    if (!fullscreenSupported) this.fullscreenBtn.remove();

    this.wire();
  }

  private template(): string {
    return `
      <div class="hurt-vignette"></div>
      <div class="topbar">
        <div class="res-strip">
          ${RES_ORDER.map(
            (k) => `<div class="res" data-res="${k}">${icon(k)}<span class="val">0</span></div>`,
          ).join('')}
          <div class="res-sep"></div>
          <div class="res" data-res="pop">${icon('pop')}<span class="val">0/0</span></div>
        </div>
        <div class="age-cluster">
          <div class="age-badge">
            <span class="age-medal"><b class="age-numeral">I</b></span>
            <div class="age-text">
              <div class="age-name">Tool Age</div>
              <div class="clock">00:00</div>
            </div>
          </div>
          <button class="icon-btn menu-btn" data-act="menu" aria-label="Menu">${icon('menu')}</button>
        </div>
      </div>

      <div class="objectives">
        <h4>Objectives</h4>
        <div class="obj-rule"><i></i><b>◆</b><i></i></div>
        <div class="obj-list"></div>
      </div>

      <div class="minimap-wrap clickable">
        <button class="mm-expand" data-act="home" aria-label="Centre on town centre">${icon('home')}</button>
        <canvas class="minimap"></canvas>
        <div class="compass">N</div>
      </div>

      <div class="selection empty"></div>

      <div class="groups"></div>

      <div class="right-rail">
        <button class="icon-btn" data-act="home" aria-label="Centre on town centre">${icon('home')}</button>
        <button class="icon-btn" data-act="idle" aria-label="Select idle villager">${icon('idle')}<span class="badge" style="display:none">0</span></button>
        <button class="icon-btn" data-act="army" aria-label="Select army">${icon('army')}</button>
        <button class="icon-btn" data-act="mute" aria-label="Toggle sound">${icon('sound')}</button>
        <button class="icon-btn" data-act="fullscreen" aria-label="Toggle full screen" title="Full screen (F)">${icon('fullscreen')}<span class="hk">F</span></button>
        <button class="icon-btn desktop-only" data-act="help" aria-label="Controls" title="Controls (F1)">?</button>
      </div>

      <div class="build-menu"></div>
      <button class="build-fab" data-act="build">${icon('build')}<span>Build</span><span class="hk">B</span></button>

      ${this.helpTemplate()}

      <div class="toasts"></div>

      <div class="coach hidden">
        ${icon('flag')}
        <div class="txt"></div>
        <button data-act="coach-ok">Got it</button>
      </div>
      <div class="fps"></div>
    `;
  }

  /** The keyboard and mouse reference, opened with F1 or the ? button. */
  private helpTemplate(): string {
    const rows: [string, string][][] = [
      [
        ['Left click', 'Select · drag a box for many'],
        ['Shift + left click', 'Add to or remove from the selection'],
        ['Double click', 'Select every unit of that kind on screen'],
        ['Right click', 'Move · attack · gather · help build'],
        ['Right click minimap', 'Send the selection across the map'],
        ['Middle drag', 'Pan the camera'],
      ],
      [
        ['Screen edge · WASD', 'Scroll the map (arrows too)'],
        ['Wheel · + −', 'Zoom'],
        ['Space', 'Centre on your town centre'],
        ['H', 'Select your town centre'],
        ['B', 'Open the build menu'],
        ['. / ,', 'Next / previous idle villager'],
      ],
      [
        ['Q E R T Y', 'Buttons of the open panel'],
        ['Z X C V', "The build menu's category tabs"],
        ['Ctrl + 1…0', 'Assign a control group'],
        ['1…0', 'Select it · press twice to jump there'],
        ['F', 'Full screen'],
        ['Delete', 'Delete the selected units'],
        ['Esc', 'Cancel · open the menu'],
      ],
    ];
    const cols = rows
      .map(
        (col) =>
          `<div class="help-col">${col
            .map(([k, v]) => `<div class="help-row"><kbd>${k}</kbd><span>${v}</span></div>`)
            .join('')}</div>`,
      )
      .join('');
    return `<div class="help hidden">
      <div class="help-inner">
        <h3>Controls</h3>
        <div class="help-cols">${cols}</div>
        <button data-act="help-close">Close</button>
      </div>
    </div>`;
  }

  private wire(): void {
    const on = (sel: string, fn: () => void) => {
      for (const el of this.root.querySelectorAll<HTMLElement>(sel)) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          fn();
        });
      }
    };
    on('[data-act="menu"]', () => this.cb.onMenu());
    on('[data-act="army"]', () => this.cb.onSelectArmy());
    on('[data-act="idle"]', () => this.cb.onSelectIdle());
    on('[data-act="home"]', () => this.cb.onFocusHome());
    on('[data-act="mute"]', () => {
      const muted = this.cb.onToggleMute();
      this.muteBtn.innerHTML = icon(muted ? 'muted' : 'sound');
      this.muteBtn.classList.toggle('on', muted);
    });
    on('[data-act="build"]', () => this.cb.onBuildToggle());
    on('[data-act="coach-ok"]', () => this.cb.onCoachDismiss());
    on('[data-act="help"]', () => this.cb.onHelp());
    on('[data-act="fullscreen"]', () => this.cb.onFullscreen());
    on('[data-act="help-close"]', () => this.cb.onHelp());

    const mm = this.root.querySelector<HTMLElement>('.minimap-wrap')!;
    mm.addEventListener('contextmenu', (e) => e.preventDefault());
    const at = (e: PointerEvent): { px: number; py: number } | null => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      this.minimapRect.w = rect.width;
      this.minimapRect.h = rect.height;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (px < 0 || py < 0 || px > rect.width || py > rect.height) return null;
      return { px, py };
    };
    mm.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.mm-expand')) return;
      e.stopPropagation();
      e.preventDefault();
      const p = at(e);
      if (!p) return;
      // Right-click orders the selection there; left-click moves the camera.
      if (e.button === 2) {
        this.cb.onMinimapCommand(p.px, p.py);
        return;
      }
      if (e.button !== 0) return;
      this.cb.onMinimapPoint(p.px, p.py);
      const move = (ev: PointerEvent) => {
        const q = at(ev);
        if (q) this.cb.onMinimapPoint(q.px, q.py);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  /** ---------------------------------------------------------------------
   * Frame update
   * ------------------------------------------------------------------- */
  update(game: Game, selection: Entity[], placing: BuildingTypeId | null, buildOpen: boolean): void {
    const p = game.player(0);

    for (const k of RES_ORDER) {
      const el = this.resEls.get(k);
      if (!el) continue;
      const v = Math.floor(p.res[k]);
      if (this.lastResValues[k] !== v) {
        this.lastResValues[k] = v;
        el.textContent = formatCount(v);
      }
    }
    const popEl = this.resEls.get('pop');
    if (popEl) {
      const txt = `${p.pop}/${p.popCap}`;
      if (popEl.textContent !== txt) popEl.textContent = txt;
      popEl.parentElement?.classList.toggle('pop-full', p.pop >= p.popCap);
    }

    this.ageName.textContent = p.age >= 2 ? 'Bronze Age' : 'Tool Age';
    const numeral = p.age >= 2 ? 'II' : 'I';
    if (this.ageNumeral.textContent !== numeral) this.ageNumeral.textContent = numeral;
    this.clock.textContent = formatClock(game.time);

    this.buildFab.classList.toggle('on', buildOpen || !!placing);
    this.buildMenuEl.classList.toggle('open', buildOpen);
    if (buildOpen) this.renderBuildMenu(game, placing);

    this.renderSelection(game, selection);
    for (const fn of this.dynamicUpdaters) fn();
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = fps > 0 ? `${Math.round(fps)} fps` : '';
  }

  /** ---------------------------------------------------------------------
   * Build menu
   * ------------------------------------------------------------------- */
  private renderBuildMenu(game: Game, placing: BuildingTypeId | null): void {
    const p = game.player(0);
    const cat = BUILD_CATEGORIES.find((c) => c.id === this.buildCategory) ?? BUILD_CATEGORIES[0];

    // Whatever is being placed is what the detail panel talks about; otherwise
    // the last card the player pointed at, falling back to the first on the tab.
    if (placing) this.buildFocus = placing;
    if (!this.buildFocus || !cat.members.includes(this.buildFocus)) this.buildFocus = cat.members[0];
    const focus = this.buildFocus;

    const sig = [
      cat.id,
      focus,
      placing ?? '',
      p.age,
      ...BUILD_ORDER.map((t) => (canAfford(p.res, buildingCost(t, p.faction)) ? 1 : 0)),
    ].join(',');
    if (sig === this.buildSignature) return;
    this.buildSignature = sig;

    const label = (t: BuildingTypeId): string =>
      t === 'monument' ? `${FACTIONS[p.faction].name} Monument` : BUILDINGS[t].name;

    const cards = cat.members
      .map((t, i) => {
        const def = BUILDINGS[t];
        const cost = buildingCost(t, p.faction);
        const locked = (def.age ?? 1) > p.age;
        const classes = ['bcard'];
        if (placing === t) classes.push('selected');
        if (focus === t) classes.push('focus');
        return `<button class="${classes.join(' ')}" data-b="${t}" ${locked ? 'disabled' : ''}>
          ${icon(t)}
          <span class="n">${label(t)}</span>
          <span class="c">${locked ? '<em class="short">Bronze Age</em>' : costHtml(cost, p.res)}</span>
          ${gridBadge(i)}
        </button>`;
      })
      .join('');

    const tabs = BUILD_CATEGORIES.map(
      (c, i) => `<button class="btab ${c.id === cat.id ? 'on' : ''}" data-cat="${c.id}">
        ${icon(c.icon as never)}<span>${c.name}</span>${gridBadge(CATEGORY_SLOT + i)}
      </button>`,
    ).join('');

    const fdef = BUILDINGS[focus];
    const fcost = buildingCost(focus, p.faction);
    const flocked = (fdef.age ?? 1) > p.age;
    const fpoor = !canAfford(p.res, fcost);
    const detail = `<div class="bdetail">
        <div class="bdetail-body">
          <h4>${label(focus)}</h4>
          <p>${fdef.blurb}</p>
          <div class="bdetail-cost">${costHtml(fcost, p.res)}</div>
        </div>
        <div class="bdetail-art">${icon(focus)}</div>
      </div>
      <button class="bplace" data-place="${focus}" ${flocked || fpoor ? 'disabled' : ''}>
        ${flocked ? 'Requires the Bronze Age' : fpoor ? 'Not enough resources' : 'Place Building'}
      </button>`;

    this.buildMenuEl.innerHTML = `
      <div class="bhead">
        ${icon('build')}
        <div>
          <h3>Build</h3>
          <span>Select a building to place it on the map</span>
        </div>
      </div>
      <div class="bbody">
        <div class="btabs">${tabs}</div>
        <div class="bgrid">${cards}</div>
      </div>
      <div class="bfoot">${detail}</div>`;

    // Hotkey slots: the top row picks a building, the second row picks a tab.
    const cardEls = [...this.buildMenuEl.querySelectorAll<HTMLButtonElement>('.bcard')];
    const tabEls = [...this.buildMenuEl.querySelectorAll<HTMLButtonElement>('.btab')];
    this.buildGrid = [];
    cardEls.forEach((el, i) => (this.buildGrid[i] = el));
    tabEls.forEach((el, i) => (this.buildGrid[CATEGORY_SLOT + i] = el));

    for (const btn of cardEls) {
      const type = btn.dataset.b as BuildingTypeId;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.buildFocus = type;
        this.cb.onPickBuilding(type);
      });
      // Pointing at a card is enough to read about it.
      btn.addEventListener('pointerenter', () => {
        if (this.buildFocus === type) return;
        this.buildFocus = type;
        this.buildSignature = '';
      });
    }
    for (const btn of tabEls) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.buildCategory = btn.dataset.cat!;
        this.buildFocus = null;
        this.buildSignature = '';
      });
    }
    this.buildMenuEl.querySelector<HTMLButtonElement>('.bplace')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onPickBuilding(focus);
    });
  }

  /**
   * Presses the panel button a grid key points at. Returns false when the key
   * lands on nothing, so the caller can leave the browser default alone.
   */
  triggerGrid(key: string, buildMenuOpen: boolean): boolean {
    const slot = GRID_KEYS.indexOf(key);
    if (slot < 0) return false;
    const btn = (buildMenuOpen ? this.buildGrid : this.selGrid)[slot];
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }

  /** ---------------------------------------------------------------------
   * Selection panel
   * ------------------------------------------------------------------- */
  private renderSelection(game: Game, selection: Entity[]): void {
    const alive = selection.filter((e) => game.isAlive(e));
    if (alive.length === 0) {
      if (this.selSignature !== 'empty') {
        this.selSignature = 'empty';
        this.selectionEl.className = 'selection empty';
        this.selectionEl.innerHTML = '';
        this.dynamicUpdaters = [];
        this.selGrid = [];
      }
      return;
    }

    const p = game.player(0);
    const single = alive.length === 1 ? alive[0] : null;
    let sig = alive.map((e) => e.id).join(',');
    if (single && single.kind === 'building') {
      sig += `|q${single.queue.length}|r${single.research?.tech ?? ''}|c${single.complete ? 1 : 0}`;
      // Affordability changes enable/disable buttons, so fold it into the key.
      const trainables = trainableAt(single.type, p.faction, p.age);
      sig += '|' + trainables.map((t) => (canAfford(p.res, UNITS[t].cost) ? 1 : 0)).join('');
      sig += '|' + (single.def.researches ?? []).map((t) => (game.canResearch(single, t).ok ? 1 : 0)).join('');
    }
    if (sig === this.selSignature) return;
    this.selSignature = sig;
    this.dynamicUpdaters = [];
    this.selectionEl.className = 'selection';

    if (single) {
      if (single.kind === 'building') this.renderBuilding(game, single);
      else this.renderUnit(game, single, alive as Unit[]);
    } else {
      this.renderGroup(game, alive as Unit[]);
    }
    this.captureSelGrid();
  }

  /**
   * The command panel's buttons take grid keys in render order. Stamping the
   * letters here keeps every panel's template free of hotkey bookkeeping.
   */
  private captureSelGrid(): void {
    this.selGrid = [...this.selectionEl.querySelectorAll<HTMLButtonElement>('.sel-actions .act')];
    this.selGrid.forEach((btn, i) => {
      const badge = gridBadge(i);
      if (badge) btn.insertAdjacentHTML('beforeend', badge);
    });
  }

  private renderBuilding(game: Game, b: Building): void {
    const p = game.player(0);
    const mine = b.owner === 0;
    const name = b.type === 'monument' ? `${FACTIONS[game.player(b.owner).faction].name} Monument` : b.def.name;
    const actions: string[] = [];

    if (mine && b.complete) {
      for (const t of trainableAt(b.type, p.faction, p.age)) {
        const u = UNITS[t];
        const check = game.canTrain(b, t);
        actions.push(`<button class="act" data-train="${t}" ${check.ok ? '' : 'disabled'} title="${u.name} — ${costText(u.cost)}">
          ${icon(t)}<span class="lbl">${u.name}</span><span class="cost">${costText(u.cost)}</span>
        </button>`);
      }
      for (const t of b.def.researches ?? []) {
        if (p.techs.has(t)) continue;
        const tech = TECHS[t];
        const check = game.canResearch(b, t);
        const label = t === 'doctrine' ? FACTIONS[p.faction].doctrineName : tech.name;
        actions.push(`<button class="act ${t === 'bronzeAge' ? 'primary' : ''}" data-tech="${t}" ${check.ok ? '' : 'disabled'} title="${tech.blurb}">
          ${icon(t === 'bronzeAge' ? 'age' : 'research')}<span class="lbl">${label}</span><span class="cost">${costText(tech.cost)}</span>
        </button>`);
      }
      if ((b.def.trains?.length ?? 0) > 0) {
        actions.push(`<button class="act" data-rally="1">${icon('rally')}<span class="lbl">Rally</span></button>`);
      }
    }

    const queueHtml =
      mine && (b.queue.length > 0 || b.research)
        ? `<div class="queue">
             ${b.research ? `<div class="qitem" data-qres="1">${icon('research')}<i style="width:0%"></i></div>` : ''}
             ${b.queue.map((q, i) => `<div class="qitem" data-q="${i}">${icon(q.type)}<i style="width:0%"></i></div>`).join('')}
           </div>`
        : '';

    const progressHtml = !b.complete
      ? `<div class="progress-line" data-progress="1"><i style="width:${Math.round(b.progress * 100)}%"></i></div>`
      : '';

    this.selectionEl.innerHTML = `
      <div class="sel-portrait">${icon(b.type)}</div>
      <div class="sel-body">
        <div class="sel-title">
          <h3>${name}</h3>
          <span class="sub">${mine ? (b.complete ? 'Yours' : 'Building…') : 'Enemy'}</span>
        </div>
        <div class="sel-hp ${mine ? '' : 'enemy'}"><i data-hp="1" style="width:${Math.round((b.hp / b.maxHp) * 100)}%"></i></div>
        ${progressHtml}
        <div class="sel-blurb">${b.def.blurb}</div>
        <div class="sel-actions">${queueHtml}${actions.join('')}</div>
      </div>`;

    // Live bits.
    const hpEl = this.selectionEl.querySelector<HTMLElement>('[data-hp]');
    const progEl = this.selectionEl.querySelector<HTMLElement>('[data-progress] i');
    const qResEl = this.selectionEl.querySelector<HTMLElement>('[data-qres] i');
    const qEls = [...this.selectionEl.querySelectorAll<HTMLElement>('[data-q] i')];
    this.dynamicUpdaters.push(() => {
      if (hpEl) hpEl.style.width = `${Math.max(0, Math.round((b.hp / b.maxHp) * 100))}%`;
      if (progEl) progEl.style.width = `${Math.round(b.progress * 100)}%`;
      if (qResEl && b.research) {
        qResEl.style.width = `${Math.round((1 - b.research.remaining / b.research.total) * 100)}%`;
      }
      qEls.forEach((el, i) => {
        const item = b.queue[i];
        if (item) el.style.width = `${Math.round((1 - item.remaining / item.total) * 100)}%`;
      });
    });

    this.selectionEl.querySelectorAll<HTMLButtonElement>('[data-train]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onTrain(b.id, btn.dataset.train as UnitTypeId);
      }),
    );
    this.selectionEl.querySelectorAll<HTMLButtonElement>('[data-tech]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onResearch(b.id, btn.dataset.tech as TechId);
      }),
    );
    this.selectionEl.querySelectorAll<HTMLElement>('[data-q]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onCancelTrain(b.id, Number(el.dataset.q));
      }),
    );
    this.selectionEl.querySelector<HTMLElement>('[data-qres]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onCancelResearch(b.id);
    });
    this.selectionEl.querySelector<HTMLElement>('[data-rally]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onSetRally(b.id);
    });
  }

  private renderUnit(game: Game, u: Unit, all: Unit[]): void {
    const mine = u.owner === 0;
    const stateLabel: Record<string, string> = {
      idle: 'Idle',
      move: 'Moving',
      attackMove: 'Advancing',
      chase: 'Closing in',
      attack: 'Fighting',
      gather: 'Gathering',
      deliver: 'Hauling',
      build: 'Building',
      dead: 'Dead',
    };
    const actions: string[] = [];
    if (mine) {
      if (u.def.canBuild) {
        actions.push(`<button class="act primary" data-do="build">${icon('build')}<span class="lbl">Build</span></button>`);
        actions.push(`<button class="act" data-do="gather">${icon('gather')}<span class="lbl">Gather</span></button>`);
      }
      actions.push(`<button class="act" data-do="stop">${icon('stop')}<span class="lbl">Stop</span></button>`);
    }
    const carrying = u.carryKind ? ` · carrying ${Math.round(u.carryAmount)} ${u.carryKind}` : '';

    this.selectionEl.innerHTML = `
      <div class="sel-portrait">${icon(u.type)}</div>
      <div class="sel-body">
        <div class="sel-title">
          <h3>${u.def.name}</h3>
          <span class="sub" data-state>${mine ? stateLabel[u.state] ?? '' : 'Enemy'}${carrying}</span>
        </div>
        <div class="sel-hp ${mine ? '' : 'enemy'}"><i data-hp style="width:100%"></i></div>
        <div class="sel-stats">
          <span>ATK <b>${Math.round(game.statAttack(u))}</b></span>
          <span>ARM <b>${Math.round(game.statArmor(u))}</b></span>
          <span>RNG <b>${game.statRange(u) > 1 ? game.statRange(u).toFixed(1) : '—'}</b></span>
          <span>SPD <b>${game.statSpeed(u).toFixed(1)}</b></span>
        </div>
        <div class="sel-actions">${actions.join('')}</div>
      </div>`;

    const hpEl = this.selectionEl.querySelector<HTMLElement>('[data-hp]');
    const stEl = this.selectionEl.querySelector<HTMLElement>('[data-state]');
    this.dynamicUpdaters.push(() => {
      if (hpEl) hpEl.style.width = `${Math.max(0, Math.round((u.hp / u.maxHp) * 100))}%`;
      if (stEl && mine) {
        const c = u.carryKind ? ` · carrying ${Math.round(u.carryAmount)} ${u.carryKind}` : '';
        stEl.textContent = `${stateLabel[u.state] ?? ''}${c}`;
      }
    });
    this.bindUnitActions();
    void all;
  }

  private renderGroup(game: Game, units: Unit[]): void {
    const counts = new Map<UnitTypeId, number>();
    for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    const mine = units.every((u) => u.owner === 0);
    const hasVillagers = units.some((u) => u.def.canBuild && u.owner === 0);

    const chips = [...counts.entries()]
      .map(([t, n]) => `<div class="qitem" title="${UNITS[t].name}">${icon(t)}<span style="position:absolute;bottom:0;right:2px;font-size:9px;font-weight:800">${n}</span></div>`)
      .join('');

    const actions: string[] = [];
    if (mine) {
      if (hasVillagers) {
        actions.push(`<button class="act primary" data-do="build">${icon('build')}<span class="lbl">Build</span></button>`);
        actions.push(`<button class="act" data-do="gather">${icon('gather')}<span class="lbl">Gather</span></button>`);
      }
      actions.push(`<button class="act" data-do="stop">${icon('stop')}<span class="lbl">Stop</span></button>`);
    }

    const totalHp = units.reduce((s, u) => s + u.hp, 0);
    const totalMax = units.reduce((s, u) => s + u.maxHp, 0);

    this.selectionEl.innerHTML = `
      <div class="sel-portrait">${icon('army')}<span class="cnt">${units.length}</span></div>
      <div class="sel-body">
        <div class="sel-title"><h3>${units.length} units</h3><span class="sub">${mine ? 'Yours' : 'Enemy'}</span></div>
        <div class="sel-hp ${mine ? '' : 'enemy'}"><i data-hp style="width:${Math.round((totalHp / Math.max(1, totalMax)) * 100)}%"></i></div>
        <div class="sel-actions" style="gap:5px">${chips}</div>
        <div class="sel-actions">${actions.join('')}</div>
      </div>`;

    const hpEl = this.selectionEl.querySelector<HTMLElement>('[data-hp]');
    this.dynamicUpdaters.push(() => {
      const hp = units.reduce((s, u) => s + Math.max(0, u.hp), 0);
      const max = units.reduce((s, u) => s + u.maxHp, 0);
      if (hpEl) hpEl.style.width = `${Math.round((hp / Math.max(1, max)) * 100)}%`;
    });
    this.bindUnitActions();
    void game;
  }

  private bindUnitActions(): void {
    this.selectionEl.querySelectorAll<HTMLButtonElement>('[data-do]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        switch (btn.dataset.do) {
          case 'stop':
            this.cb.onStop();
            break;
          case 'build':
            this.cb.onBuildToggle();
            break;
          case 'gather':
            this.cb.onGather();
            break;
        }
      }),
    );
  }

  /** ---------------------------------------------------------------------
   * Feedback widgets
   * ------------------------------------------------------------------- */
  toast(text: string, kind: 'info' | 'good' | 'bad' | '' = '', ms = 2400): void {
    // Collapse duplicates that arrive back to back.
    const last = this.toastsEl.lastElementChild as HTMLElement | null;
    if (last && last.dataset.text === text) {
      last.style.animation = 'none';
      void last.offsetWidth;
      last.style.animation = '';
      return;
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.dataset.text = text;
    el.textContent = text;
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 2) this.toastsEl.firstElementChild?.remove();
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  setObjectives(items: Objective[]): void {
    const list = this.objectivesEl.querySelector('.obj-list')!;
    this.objectivesEl.classList.toggle('hidden', items.length === 0);
    const html = items
      .map(
        (o) =>
          `<div class="obj-item ${o.done ? 'done' : ''}"><i class="bullet"></i><span>${o.text}</span>${
            o.detail ? `<span class="dot">${o.detail}</span>` : ''
          }</div>`,
      )
      .join('');
    if (list.innerHTML !== html) list.innerHTML = html;
  }

  setCoach(text: string | null): void {
    if (!text) {
      this.coachEl.classList.add('hidden');
      return;
    }
    this.coachText.innerHTML = text;
    this.coachEl.classList.remove('hidden');
  }

  setIdleCount(n: number): void {
    this.idleBadge.style.display = n > 0 ? 'flex' : 'none';
    this.idleBadge.textContent = String(n);
  }

  flashHurt(): void {
    this.vignette.classList.add('on');
    setTimeout(() => this.vignette.classList.remove('on'), 220);
  }

  /** Swaps the rail icon between enter and exit. */
  setFullscreen(active: boolean): void {
    if (!this.fullscreenBtn.isConnected) return;
    this.fullscreenBtn.innerHTML = icon(active ? 'fullscreenExit' : 'fullscreen') + '<span class="hk">F</span>';
    this.fullscreenBtn.classList.toggle('on', active);
    this.fullscreenBtn.setAttribute('aria-label', active ? 'Leave full screen' : 'Toggle full screen');
  }

  setHelpVisible(open: boolean): void {
    this.helpEl.classList.toggle('hidden', !open);
  }

  /** Draws the control-group strip; empty groups are simply absent. */
  setGroups(sizes: Map<number, number>): void {
    const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
    const html = order
      .filter((n) => (sizes.get(n) ?? 0) > 0)
      .map((n) => `<div class="group"><b>${n}</b><span>${sizes.get(n)}</span></div>`)
      .join('');
    if (this.groupsEl.innerHTML !== html) this.groupsEl.innerHTML = html;
  }

  /** Reveals the keyboard affordances once a mouse has been seen. */
  setDesktop(on: boolean): void {
    this.root.classList.toggle('has-keyboard', on);
  }

  setMuted(muted: boolean): void {
    this.muteBtn.innerHTML = icon(muted ? 'muted' : 'sound');
    this.muteBtn.classList.toggle('on', muted);
  }

  /** Force a rebuild on the next update (after a game restart). */
  invalidate(): void {
    this.selSignature = '';
    this.buildSignature = '';
    this.lastResValues = {};
    this.dynamicUpdaters = [];
  }
}
