/** Inline SVG glyphs. All sized in a 24x24 box and coloured via CSS. */

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

export const ICONS: Record<string, string> = {
  food: svg(`
    <path d="M12 3c1.6 2.2 2.4 4.4 2.4 6.6 0 3.4-1.1 6.6-2.4 9.4-1.3-2.8-2.4-6-2.4-9.4C9.6 7.4 10.4 5.2 12 3z" fill="#e3c05a"/>
    <path d="M12 10.5c1.9-.7 3.4-.4 4.6.8-1.2 1.3-2.7 1.6-4.6.9zM12 14c-1.9-.7-3.4-.4-4.6.8 1.2 1.3 2.7 1.6 4.6.9z" fill="#c9a13f"/>
    <path d="M11.3 19h1.4v2.2h-1.4z" fill="#8d7433"/>`),
  wood: svg(`
    <rect x="3" y="8.5" width="18" height="7" rx="3.2" fill="#a5713f"/>
    <ellipse cx="20.4" cy="12" rx="1.9" ry="3.5" fill="#c58f56"/>
    <ellipse cx="20.4" cy="12" rx="1" ry="1.9" fill="#8b5c31"/>
    <path d="M4.5 9.6h12v.9h-12zM4.5 13.6h11v.9h-11z" fill="#8b5c31" opacity=".55"/>`),
  gold: svg(`
    <ellipse cx="12" cy="16.5" rx="8" ry="3.4" fill="#c99a1c"/>
    <ellipse cx="12" cy="14.6" rx="8" ry="3.4" fill="#efc540"/>
    <ellipse cx="9.5" cy="10.4" rx="5" ry="2.4" fill="#c99a1c"/>
    <ellipse cx="9.5" cy="9.2" rx="5" ry="2.4" fill="#f5d55f"/>
    <ellipse cx="15" cy="11.4" rx="3.4" ry="1.7" fill="#f5d55f"/>`),
  stone: svg(`
    <path d="M4 16.5 6.8 8l6-2.2L20 10.6l-1.4 6.4z" fill="#a9a49a"/>
    <path d="M6.8 8l6-2.2 2.2 5.4-6.6 1.6z" fill="#c3beb3"/>
    <path d="M8.4 12.8l6.6-1.6L18.6 17l-11.8-.5z" fill="#8e8a81"/>`),
  pop: svg(`
    <circle cx="8.6" cy="8" r="3" fill="currentColor"/>
    <path d="M3.2 19c0-3.1 2.4-5.4 5.4-5.4s5.4 2.3 5.4 5.4z" fill="currentColor"/>
    <circle cx="16.4" cy="9" r="2.5" fill="currentColor" opacity=".72"/>
    <path d="M12.4 19c0-2.7 1.9-4.6 4-4.6s4 1.9 4 4.6z" fill="currentColor" opacity=".72"/>`),

  towncenter: svg(`
    <path d="M3 11 12 4.5 21 11v1.6h-2V19H5v-6.4H3z" fill="currentColor"/>
    <path d="M10 13.4h4V19h-4z" fill="#00000055"/>
    <path d="M3.4 10.6 12 4.2l8.6 6.4z" fill="currentColor" opacity=".65"/>`),
  house: svg(`
    <path d="M4 11.2 12 5.4l8 5.8V19H4z" fill="currentColor"/>
    <path d="M2.8 11.6 12 4.6l9.2 7z" fill="currentColor" opacity=".6"/>
    <path d="M10.4 13.6h3.2V19h-3.2z" fill="#00000055"/>`),
  farm: svg(`
    <rect x="3" y="6" width="18" height="12.5" rx="1.6" fill="currentColor" opacity=".28"/>
    <path d="M4.6 8.4h14.8v1.5H4.6zM4.6 11.6h14.8v1.5H4.6zM4.6 14.8h14.8v1.5H4.6z" fill="currentColor"/>
    <path d="M3 6h18v1.3H3z" fill="currentColor"/>`),
  storehouse: svg(`
    <path d="M3.5 9.5 12 5l8.5 4.5V11H3.5z" fill="currentColor" opacity=".7"/>
    <rect x="4.5" y="11" width="15" height="8" rx="1.2" fill="currentColor"/>
    <path d="M8 13.4h3v5.6H8zM13 13.4h3v5.6h-3z" fill="#00000055"/>`),
  barracks: svg(`
    <path d="M6.6 4.4 9 6.8 6.4 15l-2-1.4z" fill="currentColor"/>
    <path d="M17.4 4.4 15 6.8 17.6 15l2-1.4z" fill="currentColor"/>
    <path d="M4 17h16v3H4z" fill="currentColor" opacity=".6"/>`),
  range: svg(`
    <path d="M18.5 5.5A9.4 9.4 0 0 1 9 19" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
    <path d="M18.5 5.5 8.4 15.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M4.2 19.8 9.6 14.4l.6 2.4 2.4.6z" fill="currentColor"/>`),
  tower: svg(`
    <path d="M8 8h8v11H8z" fill="currentColor"/>
    <path d="M7 5h2.2v3H7zM10.9 5h2.2v3h-2.2zM14.8 5h2.2v3h-2.2z" fill="currentColor"/>
    <path d="M10.8 12h2.4v7h-2.4z" fill="#00000055"/>
    <path d="M6.4 8h11.2v1.6H6.4z" fill="currentColor" opacity=".65"/>`),
  monument: svg(`
    <path d="M10.4 4.6h3.2L14.6 19h-5.2z" fill="currentColor"/>
    <path d="M12 2.4 14 5h-4z" fill="currentColor"/>
    <path d="M6.5 19h11v2.2h-11z" fill="currentColor" opacity=".65"/>`),
  wall: svg(`
    <path d="M3 9h3.5v3H3zM7.6 9h3.5v3H7.6zM12.2 9h3.5v3h-3.5zM16.8 9h3.5v3h-3.5z" fill="currentColor" opacity=".75"/>
    <path d="M3 13h18v6H3z" fill="currentColor"/>
    <path d="M8.6 13v6M14.2 13v6M3 16h18" stroke="#00000044" stroke-width="1"/>`),
  dock: svg(`
    <path d="M4 14h16v2.2H4z" fill="currentColor"/>
    <path d="M6.4 16.2h1.6V20H6.4zM16 16.2h1.6V20H16z" fill="currentColor" opacity=".7"/>
    <path d="M12 3.4 15.4 8H8.6z" fill="currentColor"/>
    <path d="M9 8h6v6H9z" fill="currentColor" opacity=".55"/>`),

  villager: svg(`
    <circle cx="10" cy="6.4" r="2.6" fill="currentColor"/>
    <path d="M6.4 19v-5.2c0-2 1.6-3.6 3.6-3.6s3.6 1.6 3.6 3.6V19z" fill="currentColor"/>
    <path d="M15.6 4.4h1.6l1.6 14.6h-1.9z" fill="currentColor" opacity=".7"/>`),
  spearman: svg(`
    <circle cx="9.4" cy="6" r="2.5" fill="currentColor"/>
    <path d="M6 19v-5.4c0-1.9 1.5-3.4 3.4-3.4s3.4 1.5 3.4 3.4V19z" fill="currentColor"/>
    <path d="M16.4 3.2h1.5v16h-1.5z" fill="currentColor" opacity=".8"/>
    <path d="M17.1 1.2 18.8 4h-3.4z" fill="currentColor"/>`),
  archer: svg(`
    <circle cx="8.6" cy="6" r="2.5" fill="currentColor"/>
    <path d="M5.2 19v-5.4c0-1.9 1.5-3.4 3.4-3.4S12 11.7 12 13.6V19z" fill="currentColor"/>
    <path d="M17.8 4.2a8.4 8.4 0 0 1 0 15.2" fill="none" stroke="currentColor" stroke-width="1.7"/>
    <path d="M17.8 4.2v15.2" stroke="currentColor" stroke-width="1.1"/>`),
  chariot: svg(`
    <path d="M3.6 12.4h8.8v4.2H3.6z" fill="currentColor"/>
    <circle cx="6" cy="18" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <circle cx="11.4" cy="18" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <path d="M12.4 13.6h4l2.6-3.2h2v2h-1l-2.6 3.2h-5z" fill="currentColor" opacity=".8"/>`),
  hoplite: svg(`
    <circle cx="12" cy="12" r="7.4" fill="currentColor"/>
    <circle cx="12" cy="12" r="4.6" fill="#00000038"/>
    <circle cx="12" cy="12" r="1.7" fill="currentColor"/>
    <path d="M20.2 2.4h1.5v9h-1.5z" fill="currentColor" opacity=".8"/>`),
  legionary: svg(`
    <path d="M6.6 5h10.8v10.4c0 2.4-2.4 3.9-5.4 5.2-3-1.3-5.4-2.8-5.4-5.2z" fill="currentColor"/>
    <path d="M12 6.6v13" stroke="#00000038" stroke-width="1.3"/>
    <path d="M7.6 11h8.8" stroke="#00000038" stroke-width="1.3"/>`),
  fishingBoat: svg(`
    <path d="M3.2 14h17.6l-2.6 4.6H5.8z" fill="currentColor"/>
    <path d="M11.2 4h1.6v9.4h-1.6z" fill="currentColor" opacity=".8"/>
    <path d="M13.4 5.2 18 12h-4.6z" fill="currentColor" opacity=".6"/>`),
  warship: svg(`
    <path d="M2.4 13.6h19.2L18.8 19H5.2z" fill="currentColor"/>
    <path d="M11.2 3h1.6v10h-1.6z" fill="currentColor" opacity=".85"/>
    <path d="M13 4.2 18.4 12H13z" fill="currentColor" opacity=".6"/>
    <path d="M4.6 10.6h4.2v2H4.6z" fill="currentColor" opacity=".5"/>`),

  research: svg(`
    <path d="M9.2 3h5.6v5.4l4.4 8.2A2.4 2.4 0 0 1 17 20H7a2.4 2.4 0 0 1-2.2-3.4l4.4-8.2z" fill="currentColor"/>
    <path d="M9.2 3h5.6v2.2H9.2z" fill="#00000038"/>`),
  age: svg(`
    <path d="M12 2.6 14.6 8l5.9.7-4.4 4 1.2 5.8L12 15.6 6.7 18.5l1.2-5.8-4.4-4L9.4 8z" fill="currentColor"/>`),
  attack: svg(`
    <path d="M4 17.4 15.6 5.8l2.6 2.6L6.6 20z" fill="currentColor"/>
    <path d="M16.2 3.4 20.6 7.8l-1.9 1.9-4.4-4.4z" fill="currentColor" opacity=".75"/>`),
  stop: svg(`<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>`),
  gather: svg(`
    <path d="M6.4 3.6 9 6.2l-1.6 1.6L4.8 5.2z" fill="currentColor"/>
    <path d="M8.2 7 20 18.8l-2 2L6.2 9z" fill="currentColor"/>`),
  build: svg(`
    <path d="M15.6 2.6a5.4 5.4 0 0 0-4.5 8.3l-8.2 8.2 2.6 2.6 8.2-8.2a5.4 5.4 0 1 0 1.9-10.9z" fill="currentColor"/>`),
  home: svg(`<path d="M12 3.4 21 11h-2.6v8.6h-4.2v-5.2h-4.4v5.2H5.6V11H3z" fill="currentColor"/>`),
  army: svg(`
    <path d="M5.6 3.4 8 5.8 5.4 14l-2-1.4z" fill="currentColor"/>
    <path d="M18.4 3.4 16 5.8 18.6 14l2-1.4z" fill="currentColor"/>
    <circle cx="12" cy="8" r="2.6" fill="currentColor"/>
    <path d="M8 20v-3.4c0-2.2 1.8-4 4-4s4 1.8 4 4V20z" fill="currentColor"/>`),
  idle: svg(`
    <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.9"/>
    <path d="M12 7v5.4l3.6 2.2" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round"/>`),
  menu: svg(`<path d="M4 6.4h16v2.3H4zM4 10.9h16v2.3H4zM4 15.4h16v2.3H4z" fill="currentColor"/>`),
  close: svg(`<path d="M6 7.6 7.6 6l4.4 4.4L16.4 6 18 7.6 13.6 12l4.4 4.4-1.6 1.6L12 13.6 7.6 18 6 16.4 10.4 12z" fill="currentColor"/>`),
  sound: svg(`
    <path d="M4 9.4h3.6L12 5.2v13.6L7.6 14.6H4z" fill="currentColor"/>
    <path d="M15 8.8a5 5 0 0 1 0 6.4M17.6 6.4a8.6 8.6 0 0 1 0 11.2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>`),
  muted: svg(`
    <path d="M4 9.4h3.6L12 5.2v13.6L7.6 14.6H4z" fill="currentColor"/>
    <path d="M15.6 9.6 21 15M21 9.6 15.6 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  flag: svg(`
    <path d="M5.6 3h1.8v18H5.6z" fill="currentColor"/>
    <path d="M7.8 3.8h11l-2.4 3.6 2.4 3.6h-11z" fill="currentColor" opacity=".78"/>`),
  fullscreen: svg(`
    <path d="M4 9V5.6c0-.9.7-1.6 1.6-1.6H9M15 4h3.4c.9 0 1.6.7 1.6 1.6V9M20 15v3.4c0 .9-.7 1.6-1.6 1.6H15M9 20H5.6c-.9 0-1.6-.7-1.6-1.6V15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>`),
  fullscreenExit: svg(`
    <path d="M9 4v3.4c0 .9-.7 1.6-1.6 1.6H4M20 9h-3.4c-.9 0-1.6-.7-1.6-1.6V4M15 20v-3.4c0-.9.7-1.6 1.6-1.6H20M4 15h3.4c.9 0 1.6.7 1.6 1.6V20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>`),
  rally: svg(`
    <circle cx="12" cy="12" r="3" fill="currentColor"/>
    <circle cx="12" cy="12" r="7.4" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".65"/>
    <path d="M12 1.4v3.4M12 19.2v3.4M1.4 12h3.4M19.2 12h3.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
};

export function icon(name: string, cls = ''): string {
  const body = ICONS[name] ?? ICONS.build;
  return `<span class="ico ${cls}">${body}</span>`;
}
