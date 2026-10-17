/* Original-authored FreeCell rules. This is not a decompilation of Microsoft
 * software and has not been compared against an original executable.
 *
 * Cards use suit-major IDs: clubs, diamonds, hearts, spades; rank=id%13+1.
 * Classic numbered deals use the documented 15-bit Microsoft CRT PRNG and
 * a rank-major CDHS deck. See docs/freecell-core.md for provenance and limits.
 */
#include <stdint.h>

#define COLUMN 0
#define FREECELL 1
#define FOUNDATION 2
#define EMPTY 255
#define UNDO_LIMIT 4096

typedef struct {
    uint8_t columns[8][52];
    uint8_t lengths[8];
    uint8_t freecells[4];
    uint8_t foundations[4];
    uint32_t deal;
    uint32_t moves;
} Position;

static Position position;
static Position history[UNDO_LIMIT];
static unsigned history_head;
static unsigned history_count;
static int suggested[5];

/* Keep the module freestanding, including compiler-emitted struct copies. */
void *memcpy(void *destination, const void *source, unsigned long size) {
    unsigned char *to = destination;
    const unsigned char *from = source;
    for (unsigned long i = 0; i < size; ++i) to[i] = from[i];
    return destination;
}

void *memset(void *destination, int value, unsigned long size) {
    unsigned char *to = destination;
    for (unsigned long i = 0; i < size; ++i) to[i] = (unsigned char)value;
    return destination;
}

static int rank_of(int card) { return card % 13 + 1; }
static int suit_of(int card) { return card / 13; }
static int red(int card) { int suit = suit_of(card); return suit == 1 || suit == 2; }
static int builds_on(int card, int below) {
    return rank_of(card) + 1 == rank_of(below) && red(card) != red(below);
}

int fc_new(uint32_t deal) {
    if (!deal || deal > 0x7fffffffU) return 0;
    memset(&position, 0, sizeof(position));
    position.deal = deal;
    for (int i = 0; i < 4; ++i) position.freecells[i] = EMPTY;
    history_head = history_count = 0;
    uint8_t deck[52];
    for (int i = 0; i < 52; ++i) deck[i] = (uint8_t)i;
    uint32_t random = deal;
    for (int draw = 0; draw < 52; ++draw) {
        random = random * 214013U + 2531011U;
        int remaining = 52 - draw;
        int selected = ((random >> 16) & 0x7fffU) % remaining;
        int original_id = deck[selected];
        int card = (original_id % 4) * 13 + original_id / 4;
        int column = draw % 8;
        position.columns[column][position.lengths[column]++] = (uint8_t)card;
        deck[selected] = deck[remaining - 1];
    }
    return 1;
}

uint32_t fc_deal(void) { return position.deal; }
uint32_t fc_moves(void) { return position.moves; }
int fc_status(void) {
    for (int i = 0; i < 4; ++i) if (position.foundations[i] != 13) return 0;
    return 1;
}
int fc_column_length(int column) {
    return column >= 0 && column < 8 ? position.lengths[column] : -1;
}
int fc_column_card(int column, int index) {
    if (column < 0 || column >= 8 || index < 0 || index >= position.lengths[column]) return -1;
    return position.columns[column][index];
}
int fc_freecell(int index) {
    if (index < 0 || index >= 4 || position.freecells[index] == EMPTY) return -1;
    return position.freecells[index];
}
int fc_foundation(int index) {
    return index >= 0 && index < 4 ? position.foundations[index] : -1;
}

static int valid_location(int kind, int index) {
    return kind >= COLUMN && kind <= FOUNDATION && index >= 0 && index < (kind == COLUMN ? 8 : 4);
}

static int top(int kind, int index) {
    if (kind == COLUMN) {
        int length = position.lengths[index];
        return length ? position.columns[index][length - 1] : -1;
    }
    if (kind == FREECELL) return fc_freecell(index);
    return -1;
}

int fc_capacity(int destination) {
    if (destination < 0 || destination >= 8) return 0;
    int capacity = 1;
    for (int i = 0; i < 4; ++i) if (position.freecells[i] == EMPTY) ++capacity;
    /* Destination itself is unavailable as an intermediate empty column. */
    for (int i = 0; i < 8; ++i) if (i != destination && !position.lengths[i]) capacity *= 2;
    return capacity;
}

int fc_can_move(int from_kind, int from, int to_kind, int to, int count) {
    if (!valid_location(from_kind, from) || !valid_location(to_kind, to)) return 0;
    if (from_kind == FOUNDATION || count < 1 || count > 52) return 0;
    if (from_kind == to_kind && from == to) return 0;
    if (fc_status()) return 0;
    int card = top(from_kind, from);
    if (card < 0) return 0;
    if (count > 1) {
        if (from_kind != COLUMN || to_kind != COLUMN || count > position.lengths[from]) return 0;
        int start = position.lengths[from] - count;
        card = position.columns[from][start];
        for (int i = start + 1; i < position.lengths[from]; ++i) {
            if (!builds_on(position.columns[from][i], position.columns[from][i - 1])) return 0;
        }
        if (count > fc_capacity(to)) return 0;
    }
    if (to_kind == FREECELL) return count == 1 && position.freecells[to] == EMPTY;
    if (to_kind == FOUNDATION) {
        return count == 1 && suit_of(card) == to && rank_of(card) == position.foundations[to] + 1;
    }
    int below = top(COLUMN, to);
    return below < 0 || builds_on(card, below);
}

int fc_move(int from_kind, int from, int to_kind, int to, int count) {
    if (!fc_can_move(from_kind, from, to_kind, to, count)) return 0;
    history[history_head] = position;
    history_head = (history_head + 1) % UNDO_LIMIT;
    if (history_count < UNDO_LIMIT) ++history_count;
    int card = top(from_kind, from);
    if (to_kind == COLUMN) {
        if (from_kind == COLUMN) {
            int start = position.lengths[from] - count;
            for (int i = start; i < position.lengths[from]; ++i) {
                position.columns[to][position.lengths[to]++] = position.columns[from][i];
            }
        } else position.columns[to][position.lengths[to]++] = (uint8_t)card;
    } else if (to_kind == FREECELL) position.freecells[to] = (uint8_t)card;
    else ++position.foundations[to];
    if (from_kind == COLUMN) position.lengths[from] -= count;
    else position.freecells[from] = EMPTY;
    ++position.moves;
    return 1;
}

int fc_undo(void) {
    if (!history_count) return 0;
    history_head = (history_head + UNDO_LIMIT - 1) % UNDO_LIMIT;
    position = history[history_head];
    --history_count;
    return 1;
}

static int safe_foundation(int card) {
    int rank = rank_of(card);
    if (rank <= 2) return 1;
    /* Leave higher cards available until both opposite suits can accept
     * the next lower card. This is deliberately conservative. */
    for (int suit = 0; suit < 4; ++suit) {
        int opposite = (suit == 1 || suit == 2) != red(card);
        if (opposite && position.foundations[suit] < rank - 1) return 0;
    }
    return 1;
}

static int suggest(int from_kind, int from, int to_kind, int to, int count) {
    if (!fc_can_move(from_kind, from, to_kind, to, count)) return 0;
    suggested[0] = from_kind; suggested[1] = from;
    suggested[2] = to_kind; suggested[3] = to; suggested[4] = count;
    return 1;
}

int fc_hint(int safe_only) {
    /* Foundation moves first, then useful tableau moves, then an empty cell.
     * A hint is legal; it is not a proof that the deal remains solvable. */
    for (int kind = COLUMN; kind <= FREECELL; ++kind) {
        for (int i = 0; i < (kind == COLUMN ? 8 : 4); ++i) {
            int card = top(kind, i);
            if (card >= 0 && (!safe_only || safe_foundation(card)) &&
                suggest(kind, i, FOUNDATION, suit_of(card), 1)) return 1;
        }
    }
    if (safe_only) return 0;
    for (int kind = FREECELL; kind >= COLUMN; --kind) {
        for (int from = 0; from < (kind == COLUMN ? 8 : 4); ++from) {
            int max_count = kind == COLUMN ? position.lengths[from] : 1;
            for (int to = 0; to < 8; ++to) {
                for (int count = max_count; count > 0; --count) {
                    if (kind == COLUMN && !position.lengths[to] && count == position.lengths[from]) continue;
                    if (suggest(kind, from, COLUMN, to, count)) return 1;
                }
            }
        }
    }
    for (int from = 0; from < 8; ++from) {
        for (int to = 0; to < 4; ++to) if (suggest(COLUMN, from, FREECELL, to, 1)) return 1;
    }
    return 0;
}

int fc_hint_part(int index) { return index >= 0 && index < 5 ? suggested[index] : -1; }

int fc_auto_move(void) {
    if (!fc_hint(1)) return 0;
    return fc_move(suggested[0], suggested[1], suggested[2], suggested[3], suggested[4]);
}
