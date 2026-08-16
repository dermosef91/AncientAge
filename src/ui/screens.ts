import { FACTIONS, TECHS } from '../sim/data';
import type { FactionId, Player, TechId } from '../sim/types';
import { FACTION_PLURAL, factionCrest, factionScene } from './factionArt';
import { fullscreenSupported, isFullscreen } from './fullscreen';
import { icon } from './icons';

const FACTION_ORDER: FactionId[] = ['egypt', 'greece', 'rome'];
const FACTION_ACCENT: Record<FactionId, string> = {
  egypt: '#4a8fe0',
  greece: '#e8e2cf',
  rome: '#e06a52',
};

export interface EndSummary {
  victory: boolean;
  time: number;
  player: Player;
  reason: string;
}

export interface ScreenCallbacks {
  onStart: (faction: FactionId) => void;
  onRestart: () => void;
  onChangeFaction: () => void;
  onResume: () => void;
  onToggleSound: () => boolean;
  onToggleShadows: () => boolean;
  onToggleFullscreen: () => void;
  onQuit: () => void;
}

/** Title / faction picker, pause sheet, and victory / defeat screens. */
export class Screens {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private endEl: HTMLElement;
  private pauseEl: HTMLElement;
  private selected: FactionId = 'greece';

  constructor(parent: HTMLElement, private cb: ScreenCallbacks) {
    this.root = document.createElement('div');
    this.root.style.position = 'absolute';
    this.root.style.inset = '0';
    this.root.style.pointerEvents = 'none';
    this.root.style.zIndex = '20';
    parent.appendChild(this.root);

    this.titleEl = this.makeScreen(this.titleTemplate());
    this.endEl = this.makeScreen('');
    this.pauseEl = this.makeScreen('');
    this.endEl.classList.add('hidden');
    this.pauseEl.classList.add('hidden');

    this.wireTitle();
  }

  private makeScreen(html: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = html;
    this.root.appendChild(el);
    return el;
  }

  /** ---------------------------------------------------------------------
   * Title
   * ------------------------------------------------------------------- */
  private titleTemplate(): string {
    const cards = FACTION_ORDER.map((id) => {
      const f = FACTIONS[id];
      // The bonus prose is one or two sentences; each becomes its own line, and
      // the elite unit always closes the list.
      const perks = f.bonusText
        .split('. ')
        .map((t) => t.trim().replace(/\.$/, ''))
        .filter(Boolean)
        .map((t) => ({ ico: 'research', text: `${t}.` }));
      perks.unshift({ ico: 'flag', text: `<b>${f.bonusName}</b>` });
      perks.push({ ico: f.elite, text: f.eliteText.replace(' - ', ' — ') });

      return `<button class="fcard ${id === this.selected ? 'selected' : ''}" data-f="${id}" style="--fc:${FACTION_ACCENT[id]}">
        <span class="fcard-head">${factionCrest(id)}<h3>${FACTION_PLURAL[id]}</h3></span>
        <span class="fart">
          <span class="fart-clip">${factionScene(id)}</span>
          <span class="fcrest">${factionCrest(id)}</span>
        </span>
        <span class="fperks">
          ${perks
            .map((p) => `<span class="fperk"><span class="fperk-ico">${icon(p.ico)}</span><span>${p.text}</span></span>`)
            .join('')}
        </span>
      </button>`;
    }).join('');

    return `<div class="screen-inner title-screen">
      <div class="title-block">
        <div class="kicker"><i></i><span>Skirmish · 1v1</span><i></i></div>
        <h1>ANCIENT AGE</h1>
        <div class="rule"><i></i><b>◆</b><i></i></div>
        <p>Choose your civilisation and begin your conquest.</p>
      </div>
      <div class="faction-grid">${cards}</div>
      <div class="btn-row">
        <button class="big-btn ornate" data-act="start"><span class="star">★</span><span>Begin Skirmish</span></button>
      </div>
      <div class="hint-strip">
        <span>${icon('build')}Drag or screen edge to pan</span>
        <span>${icon('age')}Pinch or wheel to zoom</span>
        <span>${icon('villager')}Click a unit to select</span>
        <span>${icon('rally')}Right-click to move</span>
        <span>${icon('attack')}Right-click an enemy to attack</span>
      </div>
    </div>`;
  }

  private wireTitle(): void {
    this.titleEl.querySelectorAll<HTMLButtonElement>('.fcard').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selected = btn.dataset.f as FactionId;
        this.titleEl.querySelectorAll('.fcard').forEach((c) => c.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
    this.titleEl.querySelector('[data-act="start"]')?.addEventListener('click', () => {
      this.hideAll();
      this.cb.onStart(this.selected);
    });
  }

  /** Keeps the pause sheet's toggle in step, however fullscreen changed. */
  setFullscreen(active: boolean): void {
    this.pauseEl.querySelector('[data-act="fullscreen"]')?.classList.toggle('on', active);
  }

  get selectedFaction(): FactionId {
    return this.selected;
  }

  showTitle(): void {
    this.hideAll();
    this.titleEl.classList.remove('hidden');
    this.root.style.pointerEvents = 'auto';
  }

  /** ---------------------------------------------------------------------
   * Victory / defeat
   * ------------------------------------------------------------------- */
  showEnd(summary: EndSummary): void {
    const s = summary.player.stats;
    const mins = Math.floor(summary.time / 60);
    const secs = Math.floor(summary.time % 60);
    this.endEl.innerHTML = `<div class="screen-inner">
      <h1 class="end-title ${summary.victory ? 'win' : 'lose'}">${summary.victory ? 'Victory' : 'Defeat'}</h1>
      <p class="end-sub">${summary.reason}</p>
      <div class="stat-grid">
        <div class="stat"><div class="v">${mins}:${String(secs).padStart(2, '0')}</div><div class="k">Match time</div></div>
        <div class="stat"><div class="v">${Math.round(s.gathered)}</div><div class="k">Gathered</div></div>
        <div class="stat"><div class="v">${s.unitsTrained}</div><div class="k">Trained</div></div>
        <div class="stat"><div class="v">${s.kills}</div><div class="k">Kills</div></div>
        <div class="stat"><div class="v">${s.unitsLost}</div><div class="k">Losses</div></div>
        <div class="stat"><div class="v">${s.buildingsBuilt}</div><div class="k">Built</div></div>
      </div>
      <div class="btn-row">
        <button class="big-btn" data-act="again">${icon('age')}<span>Play again</span></button>
        <button class="big-btn ghost" data-act="change">${icon('flag')}<span>Change faction</span></button>
      </div>
    </div>`;
    this.endEl.querySelector('[data-act="again"]')?.addEventListener('click', () => {
      this.hideAll();
      this.cb.onRestart();
    });
    this.endEl.querySelector('[data-act="change"]')?.addEventListener('click', () => {
      this.showTitle();
      this.cb.onChangeFaction();
    });
    this.hideAll();
    this.endEl.classList.remove('hidden');
    this.root.style.pointerEvents = 'auto';
  }

  /** ---------------------------------------------------------------------
   * Pause / settings
   * ------------------------------------------------------------------- */
  showPause(state: { sound: boolean; shadows: boolean; player: Player }): void {
    const f = FACTIONS[state.player.faction];
    const techOrder: TechId[] = ['toHamlet', 'toVillage', 'toTown', 'toCity', 'toMetropolis', 'wheel', 'irrigation', 'bronzeWeapons', 'fletching', 'masonry', 'doctrine'];
    const techs = techOrder
      .map((t) => {
        const def = TECHS[t];
        const done = state.player.techs.has(t);
        const name = t === 'doctrine' ? f.doctrineName : def.name;
        const blurb = t === 'doctrine' ? f.doctrineText : def.blurb;
        return `<div class="tech-row">
          ${icon(TECHS[t].advancesTo ? 'age' : 'research')}
          <div class="info"><b>${name}</b><span>${blurb}</span></div>
          <div class="state ${done ? '' : 'pending'}">${done ? 'Done' : 'Locked'}</div>
        </div>`;
      })
      .join('');

    this.pauseEl.innerHTML = `<div class="sheet">
      <h2>${f.name} — ${f.bonusName}</h2>
      <p class="end-sub" style="text-align:left;font-size:12.5px">${f.bonusText}</p>
      <div class="opt">Sound<button class="toggle ${state.sound ? 'on' : ''}" data-act="sound"></button></div>
      <div class="opt">Shadows<button class="toggle ${state.shadows ? 'on' : ''}" data-act="shadows"></button></div>
      ${
        fullscreenSupported
          ? `<div class="opt">Full screen<button class="toggle ${isFullscreen() ? 'on' : ''}" data-act="fullscreen"></button></div>`
          : ''
      }
      <div class="tech-list">${techs}</div>
      <div class="btn-row" style="margin-top:2px">
        <button class="big-btn" data-act="resume">Resume</button>
        <button class="big-btn ghost" data-act="restart">Restart</button>
        <button class="big-btn ghost" data-act="quit">Main menu</button>
      </div>
    </div>`;

    const sound = this.pauseEl.querySelector<HTMLElement>('[data-act="sound"]')!;
    sound.addEventListener('click', () => {
      const on = this.cb.onToggleSound();
      sound.classList.toggle('on', on);
    });
    const shadows = this.pauseEl.querySelector<HTMLElement>('[data-act="shadows"]')!;
    shadows.addEventListener('click', () => {
      const on = this.cb.onToggleShadows();
      shadows.classList.toggle('on', on);
    });
    this.pauseEl.querySelector<HTMLElement>('[data-act="fullscreen"]')?.addEventListener('click', () => {
      // The class follows the fullscreenchange event, not this click, since the
      // browser may refuse the request.
      this.cb.onToggleFullscreen();
    });
    this.pauseEl.querySelector('[data-act="resume"]')?.addEventListener('click', () => {
      this.hideAll();
      this.cb.onResume();
    });
    this.pauseEl.querySelector('[data-act="restart"]')?.addEventListener('click', () => {
      this.hideAll();
      this.cb.onRestart();
    });
    this.pauseEl.querySelector('[data-act="quit"]')?.addEventListener('click', () => {
      this.showTitle();
      this.cb.onQuit();
    });

    this.hideAll();
    this.pauseEl.classList.remove('hidden');
    this.root.style.pointerEvents = 'auto';
  }

  get pauseVisible(): boolean {
    return !this.pauseEl.classList.contains('hidden');
  }

  get anyVisible(): boolean {
    return (
      !this.titleEl.classList.contains('hidden') ||
      !this.endEl.classList.contains('hidden') ||
      !this.pauseEl.classList.contains('hidden')
    );
  }

  hideAll(): void {
    this.titleEl.classList.add('hidden');
    this.endEl.classList.add('hidden');
    this.pauseEl.classList.add('hidden');
    this.root.style.pointerEvents = 'none';
  }
}
