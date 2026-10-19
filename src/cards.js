/** Shared card art and names for every card game. Cards are ids 0–51: suit = floor(id / 13) (clubs, diamonds, hearts, spades), rank = id % 13 + 1. */
export const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const NAMES = ['ace', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king'];
export const PATHS = [
  'M12 3a4.2 4.2 0 0 0-3.5 6.5A4.3 4.3 0 1 0 10 17c-.2 2-1 3-2.5 4h9c-1.5-1-2.3-2-2.5-4a4.3 4.3 0 1 0 1.5-7.5A4.2 4.2 0 0 0 12 3Z',
  'M12 1 21 12 12 23 3 12Z',
  'M12 21C9 18 2 13.5 2 7.5A5.5 5.5 0 0 1 12 4a5.5 5.5 0 0 1 10 3.5C22 13.5 15 18 12 21Z',
  'M12 1C9 5 2 9.5 2 15a5.1 5.1 0 0 0 8 4c-.2 1.3-.8 2.2-2.5 3h9c-1.7-.8-2.3-1.7-2.5-3a5.1 5.1 0 0 0 8-4C22 9.5 15 5 12 1Z',
];
export const cardName = id => `${NAMES[id % 13]} of ${SUITS[Math.floor(id / 13)]}`;

export function suitSvg(suit, x, y, size, rotate = false) {
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24"${rotate ? ` transform="rotate(180 ${x + size / 2} ${y + size / 2})"` : ''}><path d="${PATHS[suit]}" fill="currentColor"/></svg>`;
}

export function cardSvg(id) {
  const suit = Math.floor(id / 13);
  const rank = id % 13 + 1;
  const color = suit === 1 || suit === 2 ? '#b21d25' : '#17201b';
  const positions = {
    1: [[35, 50]],
    2: [[35, 28], [35, 72]],
    3: [[35, 26], [35, 50], [35, 74]],
    4: [[23, 28], [47, 28], [23, 72], [47, 72]],
    5: [[23, 28], [47, 28], [35, 50], [23, 72], [47, 72]],
    6: [[23, 26], [47, 26], [23, 50], [47, 50], [23, 74], [47, 74]],
    7: [[23, 26], [47, 26], [35, 38], [23, 50], [47, 50], [23, 74], [47, 74]],
    8: [[23, 24], [47, 24], [35, 37], [23, 50], [47, 50], [35, 63], [23, 76], [47, 76]],
    9: [[23, 24], [47, 24], [23, 41], [47, 41], [35, 50], [23, 59], [47, 59], [23, 76], [47, 76]],
    10: [[23, 24], [47, 24], [35, 33], [23, 41], [47, 41], [23, 59], [47, 59], [35, 67], [23, 76], [47, 76]],
  };
  const pips = rank <= 10
    ? positions[rank].map(([x, y]) => suitSvg(suit, x - (rank === 1 ? 13 : 7), y - (rank === 1 ? 13 : 7), rank === 1 ? 26 : 14, y > 50)).join('')
    : `<rect x="17" y="18" width="36" height="62" rx="1" fill="#f1e7c8" stroke="currentColor" stroke-width=".7"/><path d="m23 32 5-8 7 7 7-7 5 8v6H23Z" fill="currentColor" opacity=".82"/><path d="M25 48h20l4 21H21Z" fill="currentColor" opacity=".15"/><text x="35" y="61" text-anchor="middle" font-family="Georgia,serif" font-size="25" font-weight="bold" fill="currentColor">${RANKS[rank - 1]}</text>${suitSvg(suit, 29, 65, 12)}`;
  return `<svg viewBox="0 0 70 98" aria-hidden="true" focusable="false" style="color:${color}"><rect x=".6" y=".6" width="68.8" height="96.8" rx="3" fill="#fffefa" stroke="#6b6c63" stroke-width="1.2"/><text x="4.5" y="15" font-family="Arial,sans-serif" font-size="14" font-weight="bold" letter-spacing="-1" fill="currentColor">${RANKS[rank - 1]}</text>${suitSvg(suit, 4, 17, 10)}${pips}<g transform="rotate(180 35 49)"><text x="4.5" y="15" font-family="Arial,sans-serif" font-size="14" font-weight="bold" letter-spacing="-1" fill="currentColor">${RANKS[rank - 1]}</text>${suitSvg(suit, 4, 17, 10)}</g></svg>`;
}
