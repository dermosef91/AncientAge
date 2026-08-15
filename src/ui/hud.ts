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
  onCoachDismiss: () => void;
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

  constructor(root: HTMLElement, private cb: HudCallbacks) {
    this.root = root;
    root.innerHTML = this.template();

    for (const k of [...RES_ORDER, 'pop']) {
      const el = root.querySelector<HTMLElement>(`[data-res="${k}"] span.val`);
      if (el) this.resEls.set(k, el);
    }
    this.ageName = root.querySelector('.age-name')!;
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
          <div class="res" data-res="pop">${icon('pop')}<span class="val">0/0</span></div>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start;">
          <div class="age-badge">
            ${icon('age')}
            <div class="age-text">
              <div class="age-name">Tool Age</div>
              <div class="clock">00:00</div>
            </div>
          </div>
          <button class="icon-btn" data-act="menu" aria-label="Menu">${icon('menu')}</button>
        </div>
      </div>

      <div class="objectives"><h4>Objectives</h4><div class="obj-list"></div></div>

      <div class="minimap-wrap clickable">
        <div class="compass">N</div>
        <canvas class="minimap"></canvas>
      </div>

      <div class="selection empty"></div>

      <div class="right-rail">
        <button class="icon-btn" data-act="army" aria-label="Select army">${icon('army')}</button>
        <button class="icon-btn" data-act="idle" aria-label="Select idle villager">${icon('idle')}<span class="badge" style="display:none">0</span></button>
        <button class="icon-btn" data-act="home" aria-label="Centre on town centre">${icon('home')}</button>
        <button class="icon-btn" data-act="mute" aria-label="Toggle sound">${icon('sound')}</button>
      </div>

      <div class="build-menu"></div>
      <button class="build-fab" data-act="build">${icon('build')}<span>Build</span></button>

      <div class="toasts"></div>

      <div class="coach hidden">
        ${icon('flag')}
        <div class="txt"></div>
        <button data-act="coach-ok">Got it</button>
      </div>
      <div class="fps"></div>
    `;
  }

  private wire(): void {
    const on = (sel: string, fn: () => void) => {
      const el = this.root.querySelector<HTMLElement>(sel);
      el?.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
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

    const mm = this.root.querySelector<HTMLElement>('.minimap-wrap')!;
    const handle = (e: PointerEvent) => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      this.minimapRect.w = rect.width;
      this.minimapRect.h = rect.height;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (px < 0 || py < 0 || px > rect.width || py > rect.height) return;
      this.cb.onMinimapPoint(px, py);
    };
    mm.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      handle(e);
      const move = (ev: PointerEvent) => handle(ev);
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
    const sig = BUILD_ORDER.map((t) => {
      const cost = buildingCost(t, p.faction);
      const ok = canAfford(p.res, cost) && (BUILDINGS[t].age ?? 1) <= p.age;
      return `${t}${ok ? 1 : 0}${placing === t ? 's' : ''}`;
    }).join(',');
    if (sig === this.buildSignature) return;
    this.buildSignature = sig;

    this.buildMenuEl.innerHTML = BUILD_ORDER.map((t) => {
      const def = BUILDINGS[t];
      const cost = buildingCost(t, p.faction);
      const locked = (def.age ?? 1) > p.age;
      const poor = !canAfford(p.res, cost);
      const name = t === 'monument' ? FACTIONS[p.faction].name + ' Monument' : def.name;
      return `<button class="bcard ${placing === t ? 'selected' : ''}" data-b="${t}" ${locked ? 'disabled' : ''}>
        ${icon(t)}
        <span class="n">${name}</span>
        <span class="c">${locked ? '<em class="short">Bronze Age</em>' : costHtml(cost, p.res)}</span>
      </button>`;
      void poor;
    }).join('');

    this.buildMenuEl.querySelectorAll<HTMLButtonElement>('.bcard').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onPickBuilding(btn.dataset.b as BuildingTypeId);
      });
    });
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
      return;
    }
    this.renderGroup(game, alive as Unit[]);
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
          `<div class="obj-item ${o.done ? 'done' : ''}"><span>${o.text}</span>${
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
