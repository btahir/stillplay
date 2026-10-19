/**
 * Living miniatures for the collection: each game drawn in code as a small SVG scene with a
 * gentle loop. Colours come from CSS custom properties (see .mini-* in site.css), so the
 * scenes follow the theme. Motion is CSS-driven and switched off for reduced motion.
 */
const W = 240;
const H = 150;

const SUITS = {
  heart: 'M5 9C1 6 0 4 1.5 2.5 3 1 4.5 2 5 3 5.5 2 7 1 8.5 2.5 10 4 9 6 5 9Z',
  diamond: 'M5 .5 9 5 5 9.5 1 5Z',
  spade: 'M5 .5C8.5 3.5 10 5 9 6.8 8 8.3 6 7.6 5.6 6.8l.8 2.7H3.6l.8-2.7C4 7.6 2 8.3 1 6.8 0 5 1.5 3.5 5 .5Z',
  club: 'M5 .8a2 2 0 1 1 0 4 2 2 0 1 1 0-4ZM2.6 4.1a2 2 0 1 1 0 4 2 2 0 1 1 0-4ZM7.4 4.1a2 2 0 1 1 0 4 2 2 0 1 1 0-4ZM4.4 6h1.2l.8 3.5H3.6Z',
};
const red = (suit) => suit === 'heart' || suit === 'diamond';

function svg(body, label) {
  return `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
}

/** A face-up card. Small cards show only the corner rank and one pip. */
function card(x, y, w, rank, suit, extra = '') {
  const h = Math.round(w * 1.4);
  const size = Math.max(6, w * 0.32);
  const pip = w * 0.42;
  return `<g transform="translate(${x} ${y})" ${extra}><rect width="${w}" height="${h}" rx="${Math.max(1.5, w / 12)}" class="mini-card"/>`
    + `<text x="${w * 0.12}" y="${size + w * 0.06}" font-size="${size}" class="${red(suit) ? 'mini-red' : 'mini-ink'}" font-family="Georgia, serif">${rank}</text>`
    + `<path d="${SUITS[suit]}" class="${red(suit) ? 'mini-red' : 'mini-ink'}" transform="translate(${(w - pip) / 2} ${h * 0.45}) scale(${pip / 10})"/></g>`;
}

function back(x, y, w, extra = '') {
  const h = Math.round(w * 1.4);
  return `<g transform="translate(${x} ${y})" ${extra}><rect width="${w}" height="${h}" rx="${Math.max(1.5, w / 12)}" class="mini-back"/><rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="1" class="mini-back-inner"/></g>`;
}

function slot(x, y, w) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${Math.round(w * 1.4)}" rx="2" class="mini-slot"/>`;
}

function minesweeper() {
  const cols = 9;
  const rows = 6;
  const size = 18;
  const ox = (W - cols * size) / 2;
  const oy = (H - rows * size) / 2;
  const mines = new Set([4, 13, 24, 34, 47, 52]);
  const flag = 24;
  const start = 0;
  const near = (index) => {
    const x = index % cols;
    const y = Math.floor(index / cols);
    let count = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < cols && ny < rows && mines.has(ny * cols + nx)) count += 1;
    }
    return count;
  };
  // Flood fill from the first click: the cells a real cascade would open.
  const open = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const index = queue.shift();
    if (near(index)) continue;
    const x = index % cols;
    const y = Math.floor(index / cols);
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      const next = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || open.has(next) || mines.has(next)) continue;
      open.set(next, open.get(index) + 1);
      queue.push(next);
    }
  }
  let body = `<rect x="${ox - 4}" y="${oy - 4}" width="${cols * size + 8}" height="${rows * size + 8}" class="mini-frame"/>`;
  for (let index = 0; index < cols * rows; index += 1) {
    const x = ox + (index % cols) * size;
    const y = oy + Math.floor(index / cols) * size;
    body += `<rect x="${x}" y="${y}" width="${size}" height="${size}" class="mini-open"/>`;
    const number = near(index);
    if (open.has(index) && number) body += `<text x="${x + size / 2}" y="${y + size * 0.74}" text-anchor="middle" font-size="12" font-weight="700" font-family="'Courier New', monospace" class="mini-n${number}">${number}</text>`;
    const delay = open.has(index) ? open.get(index) : null;
    body += `<g class="${delay === null ? '' : 'mini-cover'}" style="--d:${delay ?? 0}"><rect x="${x}" y="${y}" width="${size}" height="${size}" class="mini-tile"/><path d="M${x + 0.5} ${y + size - 0.5}V${y + 0.5}H${x + size - 0.5}" class="mini-tile-light"/><path d="M${x + size - 0.5} ${y + 0.5}V${y + size - 0.5}H${x + 0.5}" class="mini-tile-dark"/>`
      + (index === flag ? `<path d="M${x + 9.5} ${y + 4}v9" class="mini-flag-pole"/><rect x="${x + 5}" y="${y + 12.5}" width="9" height="2" class="mini-flag-base"/><path d="M${x + 9.5} ${y + 3.5}l-5.5 3 5.5 2.5z" class="mini-flag"/>` : '')
      + '</g>';
  }
  body += `<circle cx="${ox + size / 2}" cy="${oy + size / 2}" r="3" class="mini-pointer"/>`;
  return svg(body, 'A small Minesweeper field opening up');
}

function freecell() {
  const w = 20;
  let body = `<rect width="${W}" height="${H}" class="mini-felt"/>`;
  for (let i = 0; i < 4; i += 1) body += slot(14 + i * 24, 12, w);
  for (let i = 0; i < 4; i += 1) body += slot(130 + i * 24, 12, w);
  body += card(130, 12, w, 'A', 'spade');
  body += card(154, 12, w, '2', 'heart');
  body += card(38, 12, w, '9', 'club');
  const columns = [
    [['K', 'spade'], ['7', 'diamond'], ['Q', 'club'], ['5', 'heart']],
    [['3', 'club'], ['J', 'heart'], ['10', 'spade'], ['9', 'diamond']],
    [['6', 'spade'], ['2', 'club'], ['8', 'heart'], ['A', 'diamond']],
    [['4', 'heart'], ['K', 'diamond'], ['5', 'spade'], ['4', 'club']],
    [['J', 'club'], ['9', 'heart'], ['8', 'spade'], ['7', 'heart']],
    [['Q', 'diamond'], ['6', 'club'], ['3', 'heart'], ['10', 'club']],
    [['2', 'spade'], ['8', 'diamond'], ['5', 'club'], ['6', 'heart']],
    [['10', 'heart'], ['3', 'spade'], ['J', 'diamond'], ['7', 'club']],
  ];
  columns.forEach((cards, column) => {
    cards.forEach(([rank, suit], row) => {
      const moving = column === 2 && row === cards.length - 1;
      body += card(14 + column * 27, 56 + row * 13, w, rank, suit, moving ? 'class="mini-glide" style="--tx:148px;--ty:-83px"' : '');
    });
  });
  return svg(body, 'A FreeCell table with an ace gliding home');
}

function solitaire() {
  const w = 22;
  let body = `<rect width="${W}" height="${H}" class="mini-felt"/>`;
  body += back(14, 12, w);
  body += `<g class="mini-flip">${card(42, 12, w, 'Q', 'heart')}</g>`;
  for (let i = 0; i < 4; i += 1) body += slot(110 + i * 30, 12, w);
  body += card(110, 12, w, 'A', 'club');
  body += card(140, 12, w, '2', 'diamond');
  const tops = [['K', 'spade'], ['8', 'heart'], ['J', 'club'], ['4', 'diamond'], ['10', 'spade'], ['6', 'heart'], ['9', 'club']];
  tops.forEach(([rank, suit], column) => {
    const x = 14 + column * 31;
    for (let row = 0; row < column; row += 1) body += back(x, 52 + row * 6, w);
    body += card(x, 52 + column * 6, w, rank, suit, column === 1 ? 'class="mini-lift"' : '');
  });
  return svg(body, 'A Klondike Solitaire layout with the waste card turning over');
}

function spider() {
  const w = 17;
  let body = `<rect width="${W}" height="${H}" class="mini-felt"/>`;
  for (let column = 0; column < 10; column += 1) {
    const x = 12 + column * 22;
    const hidden = column < 4 ? 4 : 3;
    for (let row = 0; row < hidden; row += 1) body += back(x, 12 + row * 5, w);
    const ranks = column === 6 ? ['K', 'Q', 'J', '10', '9', '8', '7'] : [['9', '5', 'Q', '3', '8', 'J', '', '6', '10', '4'][column]];
    const group = ranks.map((rank, row) => card(x, 12 + hidden * 5 + row * 9, w, rank, 'spade')).join('');
    body += column === 6 ? `<g class="mini-run">${group}</g>` : group;
  }
  body += back(196, 118, w) + back(200, 118, w) + back(204, 118, w);
  return svg(body, 'Spider Solitaire columns with a run lifting away');
}

function hearts() {
  const w = 30;
  const cx = W / 2 - w / 2;
  const cy = H / 2 - (w * 1.4) / 2;
  let body = `<rect width="${W}" height="${H}" class="mini-felt"/>`;
  const plays = [
    ['7', 'heart', 0, 26, '0px', '60px', -4],
    ['Q', 'spade', -34, 0, '-60px', '0px', 8],
    ['K', 'heart', 0, -26, '0px', '-60px', 3],
    ['2', 'heart', 34, 0, '60px', '0px', -9],
  ];
  plays.forEach(([rank, suit, dx, dy, fx, fy, turn], index) => {
    body += `<g class="mini-trick" style="--fx:${fx};--fy:${fy};--i:${index}"><g transform="translate(${cx + dx} ${cy + dy}) rotate(${turn} ${w / 2} ${w * 0.7})">${card(0, 0, w, rank, suit)}</g></g>`;
  });
  for (let i = 0; i < 6; i += 1) body += back(78 + i * 12, 128, 14);
  return svg(body, 'A trick of Hearts, with the queen of spades');
}

function pinball({ still }) {
  const body = `<rect width="${W}" height="${H}" class="mini-table"/>
    <path d="M70 140 60 18q0-8 8-8h104q8 0 8 8l-10 122" class="mini-rail"/>
    <circle cx="102" cy="48" r="11" class="mini-bumper"/><circle cx="140" cy="44" r="9" class="mini-bumper"/><circle cx="122" cy="74" r="10" class="mini-bumper"/>
    <path d="M90 124l22 8M150 124l-22 8" class="mini-flipper"/>
    <path d="M76 98l10 18M164 98l-10 18" class="mini-rail"/>
    ${still ? '<circle cx="118" cy="60" r="4.5" class="mini-ball"/>' : '<circle r="4.5" class="mini-ball"><animateMotion dur="5s" repeatCount="indefinite" path="M120 128C110 90 80 70 98 34S150 30 140 60 112 80 128 100 132 124 120 128Z"/></circle>'}`;
  return svg(body, 'A pinball table with a ball bouncing between bumpers');
}

const scenes = { minesweeper, freecell, solitaire, spider, hearts, pinball };

/** SVG markup for a game id; unknown ids get a plain card table. `still` drops SMIL motion. */
export function drawMini(id, { still = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : true } = {}) {
  return (scenes[id] || solitaire)({ still });
}
