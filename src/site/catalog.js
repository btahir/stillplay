/**
 * Site copy for each game, keyed by registry id. Pure data, so the build script can read it too.
 * The registry in src/games.js stays the source of truth for which games exist and which can be played.
 */
export const copy = {
  minesweeper: {
    scoreboard: true, // has a scoreboard/minesweeper.json record
    intro: 'A quiet field, ten hidden mines and a little deduction. Your first click is always safe.',
    loading: 'Setting the field…',
    howTo: [
      'Reveal every square that hides no mine. A number tells you how many mines touch that square, diagonals included.',
      'Flag a square you are sure about with a right-click, a long press, or F. When a number has all its flags around it, click the number to clear its neighbours.',
    ],
    dailyNoun: 'board',
    description: 'Play Minesweeper in your browser. Beginner, intermediate and expert boards, a shared daily board, and replays you can keep.',
    genre: 'Puzzle',
  },
  freecell: {
    scoreboard: true, // has a scoreboard/freecell.json record
    intro: 'Eight columns, four free cells, every card face up. Nearly every deal can be won.',
    loading: 'Dealing the cards…',
    howTo: [
      'Build each foundation from ace to king in one suit. In the columns, stack cards downward in alternating colours.',
      'Park a card in a free cell when you need room. Empty cells and columns let you move longer runs at once. Pick a numbered deal to replay one you love.',
    ],
    dailyNoun: 'deal',
    description: 'Play numbered FreeCell deals in your browser, including the famous deal 11982. A daily deal, undo, hints and replays.',
    genre: 'Card game',
  },
  solitaire: {
    intro: 'Klondike, the one most people mean. Draw one or draw three, then build four tidy piles.',
    loading: 'Shuffling the deck…',
    howTo: [
      'Build each foundation from ace to king in one suit. In the seven columns, stack cards downward in alternating colours, and turn over hidden cards as you free them.',
      'Only a king can fill an empty column. When you are stuck, draw from the stock.',
    ],
    dailyNoun: 'deal',
    description: 'Play Klondike Solitaire in your browser, with draw one or draw three and a shared daily deal.',
    genre: 'Card game',
  },
  spider: {
    intro: 'Two decks, ten columns. Build a full run from king to ace and it lifts away.',
    loading: 'Spinning the deal…',
    howTo: [
      'Stack cards downward in any suit. A run in a single suit moves together, and a complete run from king to ace leaves the table.',
      'Deal a new row from the stock whenever you are ready, as long as no column is empty. Start with one suit and work up to four.',
    ],
    dailyNoun: 'deal',
    description: 'Play Spider Solitaire in your browser with one, two or four suits and a shared daily deal.',
    genre: 'Card game',
  },
  hearts: {
    intro: 'You and three computer players. Take as few hearts as you can, and watch out for the queen of spades.',
    loading: 'Finding three players…',
    howTo: [
      'Follow suit when you can. The highest card of the suit led takes the trick. Every heart costs a point, and the queen of spades costs thirteen.',
      'Take every heart and the queen in one hand and the other players take the points instead. The game ends when someone reaches one hundred.',
    ],
    dailyNoun: 'deal',
    description: 'Play Hearts in your browser against three computer players, with a shared daily deal.',
    genre: 'Card game',
  },
  pinball: {
    intro: 'Later, with the right licence.',
    loading: 'Warming up the table…',
    howTo: [],
    shortcuts: [],
    dailyNoun: 'table',
    description: 'A pinball table is planned for a later wave.',
    genre: 'Pinball',
  },
};

export const fallbackCopy = {
  scoreboard: false, intro: '', loading: 'Getting things ready…', howTo: [], shortcuts: [], dailyNoun: 'game', description: '', genre: 'Game',
};
