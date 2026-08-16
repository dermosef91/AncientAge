import type { FactionId } from '../sim/types';

/**
 * Faction art for the title screen, drawn as inline SVG so the game keeps its
 * promise of shipping no image files. Each scene is a flat, low-poly landscape
 * in the same register as the diorama the match is played on.
 */

const scene = (body: string): string =>
  `<svg class="fart-svg" viewBox="0 0 200 132" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;

const crest = (body: string): string =>
  `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">${body}</svg>`;

/** Egypt: the Nile under a low sun, pyramids, an obelisk and date palms. */
const EGYPT_SCENE = scene(`
  <defs>
    <linearGradient id="eg-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fc0dc"/><stop offset="1" stop-color="#e8d3a6"/>
    </linearGradient>
  </defs>
  <rect width="200" height="132" fill="url(#eg-sky)"/>
  <circle cx="150" cy="44" r="15" fill="#f6e2ab" opacity=".75"/>
  <path d="M0 84h200v48H0z" fill="#dcc596"/>
  <path d="M38 84 66 40l28 44z" fill="#e0c896"/>
  <path d="M66 40 94 84H66z" fill="#c9ac79"/>
  <path d="M96 84l20-31 20 31z" fill="#e6d2a4"/>
  <path d="M116 53l20 31h-20z" fill="#cdb083"/>
  <path d="M0 96h200v10H0z" fill="#53c9c4" opacity=".85"/>
  <path d="M0 100h200v6H0z" fill="#1d76a4" opacity=".35"/>
  <rect x="160" y="46" width="9" height="46" fill="#e3cfa2"/>
  <path d="M160 46h9l-4.5-9z" fill="#e6b422"/>
  <rect x="162" y="56" width="5" height="26" fill="#c9a94f" opacity=".55"/>
  <g fill="#5f9145">
    <path d="M24 108c-6-5-13-6-19-3 5-6 13-7 19-2z"/>
    <path d="M24 108c6-5 13-6 19-3-5-6-13-7-19-2z"/>
    <path d="M24 106c-2-7-1-13 3-18-6 3-9 10-8 18z"/>
  </g>
  <rect x="22" y="104" width="4" height="28" fill="#9b7a4f"/>
  <g fill="#4b7a37">
    <path d="M186 116c-5-4-11-5-16-2 4-5 11-6 16-2z"/>
    <path d="M186 116c5-4 11-5 16-2-4-5-11-6-16-2z"/>
  </g>
  <rect x="184" y="114" width="4" height="18" fill="#8a6b45"/>
`);

/** Greece: a marble temple above the Aegean, cypress on a rocky headland. */
const GREECE_SCENE = scene(`
  <defs>
    <linearGradient id="gr-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5f9fc8"/><stop offset="1" stop-color="#cfe4ee"/>
    </linearGradient>
  </defs>
  <rect width="200" height="132" fill="url(#gr-sky)"/>
  <path d="M0 62c26-16 44-6 62 2 20 9 40 2 58-8 16-9 34-8 46 0v22H0z" fill="#7d9a8e" opacity=".55"/>
  <path d="M0 78h200v54H0z" fill="#2f8fb0"/>
  <path d="M0 92h200v40H0z" fill="#8a9d55"/>
  <path d="M0 92c30-8 52-4 74 2 24 7 52 5 78-4 18-6 34-6 48-2v44H0z" fill="#9aab63"/>
  <g>
    <path d="M74 50h58l-29-16z" fill="#f2efe4"/>
    <path d="M74 50h58v6H74z" fill="#d8d4c4"/>
    <path d="M78 34h50l-25-12z" fill="#2f5fae"/>
    <g fill="#f2efe4">
      <rect x="78" y="56" width="7" height="30"/><rect x="90" y="56" width="7" height="30"/>
      <rect x="102" y="56" width="7" height="30"/><rect x="114" y="56" width="7" height="30"/>
      <rect x="124" y="56" width="7" height="30"/>
    </g>
    <rect x="72" y="86" width="62" height="7" fill="#e0dcce"/>
    <rect x="68" y="93" width="70" height="5" fill="#cdc8b8"/>
  </g>
  <g fill="#4a6b3c">
    <path d="M28 104c0-14 4-24 6-24s6 10 6 24z"/>
    <path d="M162 106c0-16 4-27 6-27s6 11 6 27z"/>
  </g>
  <path d="M26 104h16v4H26zM160 106h16v4h-16z" fill="#6f5a3c"/>
  <path d="M0 118c14-4 26-2 38 2 14 5 30 4 44-1 16-6 32-6 46-1 12 4 24 5 34 3l38-6v17H0z" fill="#8a9d55" opacity=".5"/>
`);

/** Rome: an aqueduct striding past tiled roofs and a stand of pines. */
const ROME_SCENE = scene(`
  <defs>
    <linearGradient id="rm-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6ba3c6"/><stop offset="1" stop-color="#dfe7d5"/>
    </linearGradient>
  </defs>
  <rect width="200" height="132" fill="url(#rm-sky)"/>
  <path d="M0 66c22-12 40-10 58-2 22 10 44 8 66-2 18-8 42-8 76 4v20H0z" fill="#8fa87f" opacity=".5"/>
  <path d="M0 84h200v48H0z" fill="#76914a"/>
  <g fill="#efe6d2">
    <rect x="16" y="40" width="172" height="12"/>
    <rect x="16" y="52" width="14" height="34"/><rect x="52" y="52" width="14" height="34"/>
    <rect x="88" y="52" width="14" height="34"/><rect x="124" y="52" width="14" height="34"/>
    <rect x="160" y="52" width="14" height="34"/>
  </g>
  <g fill="none" stroke="#efe6d2" stroke-width="9">
    <path d="M30 74a16 16 0 0 1 22 0"/><path d="M66 74a16 16 0 0 1 22 0"/>
    <path d="M102 74a16 16 0 0 1 22 0"/><path d="M138 74a16 16 0 0 1 22 0"/>
  </g>
  <rect x="16" y="36" width="172" height="5" fill="#d8cfb6"/>
  <g>
    <rect x="34" y="94" width="44" height="26" fill="#efe6d2"/>
    <path d="M30 94l26-14 26 14z" fill="#a8402f"/>
    <rect x="50" y="104" width="12" height="16" fill="#6d5844"/>
    <rect x="112" y="98" width="52" height="22" fill="#e8dfca"/>
    <path d="M108 98l30-13 30 13z" fill="#8b3325"/>
    <rect x="132" y="106" width="12" height="14" fill="#6d5844"/>
  </g>
  <g fill="#3d5a32">
    <ellipse cx="94" cy="98" rx="15" ry="8"/><ellipse cx="182" cy="102" rx="13" ry="7"/>
  </g>
  <rect x="92" y="98" width="4" height="22" fill="#6f4b2c"/>
  <rect x="180" y="102" width="4" height="20" fill="#6f4b2c"/>
  <path d="M0 116c20-5 40-3 60 2 22 6 44 4 66-2 20-5 46-4 74 4v12H0z" fill="#6b8543" opacity=".55"/>
`);

/** Eye of Horus, a temple front, a laurel wreath. */
const EGYPT_CREST = crest(`
  <path d="M4 17c4-6 9-9 12-9s8 3 12 9c-4 5-8 8-12 8s-8-3-12-8z" fill="none" stroke="currentColor" stroke-width="2"/>
  <circle cx="16" cy="16" r="4" fill="currentColor"/>
  <path d="M16 25v4M12 25l-2 4M20 25l2 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
`);

const GREECE_CREST = crest(`
  <path d="M4 11h24L16 4z" fill="currentColor"/>
  <rect x="6" y="13" width="4" height="13" fill="currentColor"/>
  <rect x="14" y="13" width="4" height="13" fill="currentColor"/>
  <rect x="22" y="13" width="4" height="13" fill="currentColor"/>
  <rect x="3" y="26" width="26" height="3" fill="currentColor"/>
`);

const ROME_CREST = crest(`
  <path d="M16 27C9 24 5 18 6 9c5 1 9 5 10 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M16 27c7-3 11-9 10-18-5 1-9 5-10 10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="16" cy="7" r="2.4" fill="currentColor"/>
`);

const SCENES: Record<FactionId, string> = {
  egypt: EGYPT_SCENE,
  greece: GREECE_SCENE,
  rome: ROME_SCENE,
};

const CRESTS: Record<FactionId, string> = {
  egypt: EGYPT_CREST,
  greece: GREECE_CREST,
  rome: ROME_CREST,
};

/** Plural name as it appears on the card header. */
export const FACTION_PLURAL: Record<FactionId, string> = {
  egypt: 'Egyptians',
  greece: 'Greeks',
  rome: 'Romans',
};

export function factionScene(id: FactionId): string {
  return SCENES[id];
}

export function factionCrest(id: FactionId): string {
  return `<span class="ico">${CRESTS[id]}</span>`;
}
