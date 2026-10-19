/* Original-authored Klondike (Solitaire) rules. This is not a decompilation of
 * Microsoft software and has not been compared against an original executable.
 *
 * Cards use suit-major IDs: clubs, diamonds, hearts, spades; rank = id % 13 + 1.
 * Deals come from a documented seeded shuffle (mulberry32 + Fisher-Yates), so
 * the browser, the CLI and replays all produce the same table for a seed.
 *
 * Locations: TABLEAU 0-6, WASTE 0, FOUNDATION 0-3, STOCK 0.
 * Foundations are four slots. Any ace may start an empty slot; after that a
 * slot only takes the next card of its suit.
 *
 * Scoring follows the familiar Windows rules (see docs/solitaire-core.md):
 *   Standard: waste->tableau +5, waste->foundation +10, tableau->foundation +10,
 *             turn over a tableau card +5, foundation->tableau -15,
 *             recycle the waste -100 (draw one) or -20 from the fourth pass on
 *             (draw three). The score never drops below zero.
 *   Vegas:    -52 to deal, +5 per card on a foundation, -5 if one comes back.
 *             One pass through the stock in draw one, three in draw three.
 *   Timed:    -2 per 10 seconds, and a 700000 / seconds bonus for a win that
 *             took at least 30 seconds (standard scoring only).
 */
#include <stdint.h>

#define TABLEAU 0
#define WASTE 1
#define FOUNDATION 2
#define STOCK 3

#define SCORE_NONE 0
#define SCORE_STANDARD 1
#define SCORE_VEGAS 2

#define FLAG_MANUAL_FLIP 1

#define ACTION_MOVE 0
#define ACTION_DRAW 1
#define ACTION_RECYCLE 2
#define ACTION_FLIP 3

#define COLUMN_CAPACITY 20 /* At most 6 face-down cards + 13 face-up cards. */
#define UNDO_LIMIT 2048

typedef struct {
    uint8_t tableau[7][COLUMN_CAPACITY];
    uint8_t lengths[7];
    uint8_t hidden[7];          /* Face-down cards at the bottom of each column. */
    uint8_t stock[24];          /* stock[stock_length - 1] is the top card. */
    uint8_t waste[24];          /* waste[waste_length - 1] is the top card. */
    uint8_t stock_length;
    uint8_t waste_length;
    uint8_t waste_fan;          /* Top waste cards spread out (draw three shows up to 3). */
    uint8_t pass;               /* Current pass through the stock, starting at 1. */
    int8_t foundation_suit[4];  /* -1 while the slot is empty. */
    uint8_t foundation_rank[4];
    int32_t score;
    uint32_t moves;
} Position;

static Position position;
static Position history[UNDO_LIMIT];
static unsigned history_head;
static unsigned history_count;
static uint32_t game_seed;
static int draw_count = 1;
static int scoring = SCORE_STANDARD;
static int flags;
static int suggested[6];

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

/* mulberry32: small, well-known and easy to reproduce in any language. */
static uint32_t random_state;
static uint32_t next_random(void) {
    uint32_t t = (random_state += 0x6D2B79F5U);
    t = (t ^ (t >> 15)) * (t | 1U);
    t ^= t + (t ^ (t >> 7)) * (t | 61U);
    return t ^ (t >> 14);
}

int sol_max_passes(void) {
    if (scoring != SCORE_VEGAS) return 0; /* Unlimited. */
    return draw_count == 3 ? 3 : 1;
}

static void clamp_score(void) {
    if (scoring == SCORE_STANDARD && position.score < 0) position.score = 0;
}

static void add_score(int standard, int vegas) {
    if (scoring == SCORE_STANDARD) position.score += standard;
    else if (scoring == SCORE_VEGAS) position.score += vegas;
    clamp_score();
}

/* seed: 1..2^31-1. draw: 1 or 3. mode: 0 none, 1 standard, 2 Vegas.
 * options: bit 0 = manual flips (face-down cards wait for an explicit flip). */
int sol_new(uint32_t seed, int draw, int mode, int options) {
    if (!seed || seed > 0x7fffffffU) return 0;
    if (draw != 1 && draw != 3) return 0;
    if (mode < SCORE_NONE || mode > SCORE_VEGAS) return 0;
    if (options & ~FLAG_MANUAL_FLIP) return 0;
    memset(&position, 0, sizeof(position));
    history_head = history_count = 0;
    game_seed = seed;
    draw_count = draw;
    scoring = mode;
    flags = options;

    uint8_t deck[52];
    for (int i = 0; i < 52; ++i) deck[i] = (uint8_t)i;
    random_state = seed;
    for (int i = 51; i > 0; --i) {
        int j = (int)(next_random() % (uint32_t)(i + 1));
        uint8_t swap = deck[i]; deck[i] = deck[j]; deck[j] = swap;
    }
    /* Deal row by row, left to right; the last card of each column is face up. */
    int next = 0;
    for (int row = 0; row < 7; ++row) {
        for (int column = row; column < 7; ++column) {
            position.tableau[column][position.lengths[column]++] = deck[next++];
        }
    }
    for (int column = 0; column < 7; ++column) position.hidden[column] = (uint8_t)column;
    /* The rest form the stock; deck[51] is drawn first. */
    for (int i = 0; i < 24; ++i) position.stock[i] = deck[28 + i];
    position.stock_length = 24;
    position.pass = 1;
    for (int i = 0; i < 4; ++i) position.foundation_suit[i] = -1;
    position.score = scoring == SCORE_VEGAS ? -52 : 0;
    return 1;
}

uint32_t sol_seed(void) { return game_seed; }
int sol_draw_count(void) { return draw_count; }
int sol_scoring(void) { return scoring; }
int sol_options(void) { return flags; }
uint32_t sol_moves(void) { return position.moves; }
int sol_score(void) { return position.score; }
int sol_pass(void) { return position.pass; }
int sol_stock_length(void) { return position.stock_length; }
int sol_stock_card(int index) {
    return index >= 0 && index < position.stock_length ? position.stock[index] : -1;
}
int sol_waste_length(void) { return position.waste_length; }
int sol_waste_card(int index) {
    return index >= 0 && index < position.waste_length ? position.waste[index] : -1;
}
int sol_waste_fan(void) { return position.waste_fan; }
int sol_column_length(int column) {
    return column >= 0 && column < 7 ? position.lengths[column] : -1;
}
int sol_column_hidden(int column) {
    return column >= 0 && column < 7 ? position.hidden[column] : -1;
}
int sol_column_card(int column, int index) {
    if (column < 0 || column >= 7 || index < 0 || index >= position.lengths[column]) return -1;
    return position.tableau[column][index];
}
int sol_foundation_suit(int slot) {
    return slot >= 0 && slot < 4 ? position.foundation_suit[slot] : -2;
}
int sol_foundation_rank(int slot) {
    return slot >= 0 && slot < 4 ? position.foundation_rank[slot] : -1;
}
int sol_status(void) {
    for (int i = 0; i < 4; ++i) if (position.foundation_rank[i] != 13) return 0;
    return 1;
}

static void remember(void) {
    history[history_head] = position;
    history_head = (history_head + 1) % UNDO_LIMIT;
    if (history_count < UNDO_LIMIT) ++history_count;
}

int sol_undo(void) {
    if (!history_count) return 0;
    history_head = (history_head + UNDO_LIMIT - 1) % UNDO_LIMIT;
    position = history[history_head];
    --history_count;
    return 1;
}

int sol_can_draw(void) { return !sol_status() && position.stock_length > 0; }

int sol_draw(void) {
    if (!sol_can_draw()) return 0;
    remember();
    int count = 0;
    while (count < draw_count && position.stock_length) {
        position.waste[position.waste_length++] = position.stock[--position.stock_length];
        ++count;
    }
    position.waste_fan = (uint8_t)count;
    ++position.moves;
    return 1;
}

int sol_can_recycle(void) {
    if (sol_status() || position.stock_length || !position.waste_length) return 0;
    int limit = sol_max_passes();
    return !limit || position.pass < limit;
}

int sol_recycle(void) {
    if (!sol_can_recycle()) return 0;
    remember();
    for (int i = 0; i < position.waste_length; ++i) {
        position.stock[i] = position.waste[position.waste_length - 1 - i];
    }
    position.stock_length = position.waste_length;
    position.waste_length = 0;
    position.waste_fan = 0;
    ++position.pass;
    if (draw_count == 1) add_score(-100, 0);
    else if (position.pass > 3) add_score(-20, 0);
    ++position.moves;
    return 1;
}

int sol_can_flip(int column) {
    if (column < 0 || column >= 7 || sol_status()) return 0;
    return position.lengths[column] > 0 && position.hidden[column] == position.lengths[column];
}

static void turn_over(int column) {
    --position.hidden[column];
    add_score(5, 0);
}

int sol_flip(int column) {
    if (!sol_can_flip(column)) return 0;
    remember();
    turn_over(column);
    ++position.moves;
    return 1;
}

static int valid_location(int kind, int index) {
    if (kind == TABLEAU) return index >= 0 && index < 7;
    if (kind == WASTE) return index == 0;
    if (kind == FOUNDATION) return index >= 0 && index < 4;
    return 0;
}

/* The card that would lead a move of `count` cards, or -1. */
static int lead_card(int kind, int index, int count) {
    if (kind == TABLEAU) {
        int length = position.lengths[index];
        if (count < 1 || count > length - position.hidden[index]) return -1;
        return position.tableau[index][length - count];
    }
    if (count != 1) return -1;
    if (kind == WASTE) return position.waste_length ? position.waste[position.waste_length - 1] : -1;
    if (kind == FOUNDATION) {
        int rank = position.foundation_rank[index];
        return rank ? position.foundation_suit[index] * 13 + rank - 1 : -1;
    }
    return -1;
}

int sol_can_move(int from_kind, int from, int to_kind, int to, int count) {
    if (!valid_location(from_kind, from) || !valid_location(to_kind, to)) return 0;
    if (to_kind != TABLEAU && to_kind != FOUNDATION) return 0;
    if (from_kind == to_kind && from == to) return 0;
    if (from_kind == FOUNDATION && to_kind == FOUNDATION) return 0;
    if (sol_status()) return 0;
    int card = lead_card(from_kind, from, count);
    if (card < 0) return 0;
    if (from_kind == TABLEAU) {
        int length = position.lengths[from];
        for (int i = length - count + 1; i < length; ++i) {
            if (!builds_on(position.tableau[from][i], position.tableau[from][i - 1])) return 0;
        }
    }
    if (to_kind == FOUNDATION) {
        if (count != 1) return 0;
        if (!position.foundation_rank[to]) return rank_of(card) == 1;
        return suit_of(card) == position.foundation_suit[to] &&
               rank_of(card) == position.foundation_rank[to] + 1;
    }
    int length = position.lengths[to];
    if (!length) return rank_of(card) == 13;
    if (position.hidden[to] == length) return 0; /* Face-down top card. */
    return builds_on(card, position.tableau[to][length - 1]);
}

int sol_move(int from_kind, int from, int to_kind, int to, int count) {
    if (!sol_can_move(from_kind, from, to_kind, to, count)) return 0;
    remember();
    int card = lead_card(from_kind, from, count);
    if (to_kind == FOUNDATION) {
        if (!position.foundation_rank[to]) position.foundation_suit[to] = (int8_t)suit_of(card);
        ++position.foundation_rank[to];
    } else if (from_kind == TABLEAU) {
        int start = position.lengths[from] - count;
        for (int i = start; i < position.lengths[from]; ++i) {
            position.tableau[to][position.lengths[to]++] = position.tableau[from][i];
        }
    } else {
        position.tableau[to][position.lengths[to]++] = (uint8_t)card;
    }

    if (from_kind == TABLEAU) {
        position.lengths[from] -= (uint8_t)count;
        if (to_kind == FOUNDATION) add_score(10, 5);
    } else if (from_kind == WASTE) {
        --position.waste_length;
        if (position.waste_fan > 1) --position.waste_fan;
        else position.waste_fan = position.waste_length ? 1 : 0;
        if (to_kind == FOUNDATION) add_score(10, 5);
        else add_score(5, 0);
    } else {
        if (!--position.foundation_rank[from]) position.foundation_suit[from] = -1;
        add_score(-15, -5);
    }

    if (from_kind == TABLEAU && !(flags & FLAG_MANUAL_FLIP) && position.lengths[from] &&
        position.hidden[from] == position.lengths[from]) {
        turn_over(from);
    }
    ++position.moves;
    return 1;
}

/* Timed games lose 2 points for every 10 seconds (standard scoring). */
int sol_time_penalty(int seconds) {
    if (scoring != SCORE_STANDARD || seconds < 0) return 0;
    return 2 * (seconds / 10);
}

int sol_time_bonus(int seconds) {
    if (scoring != SCORE_STANDARD || seconds < 30) return 0;
    return 700000 / seconds;
}

/* The standard score a timed game shows after `seconds`, with the win bonus
 * once every card is home. Never below zero. */
int sol_timed_score(int seconds) {
    if (scoring != SCORE_STANDARD) return position.score;
    int score = position.score - sol_time_penalty(seconds);
    if (score < 0) score = 0;
    if (sol_status()) score += sol_time_bonus(seconds);
    return score;
}

static int foundation_for(int card) {
    int empty = -1;
    for (int slot = 0; slot < 4; ++slot) {
        if (position.foundation_rank[slot] && position.foundation_suit[slot] == suit_of(card)) return slot;
        if (!position.foundation_rank[slot] && empty < 0) empty = slot;
    }
    return rank_of(card) == 1 ? empty : -1;
}

static int foundation_rank_of_suit(int suit) {
    for (int slot = 0; slot < 4; ++slot) {
        if (position.foundation_rank[slot] && position.foundation_suit[slot] == suit) return position.foundation_rank[slot];
    }
    return 0;
}

/* A card is safe to send home when no card of the other colour could still
 * want to build on it: both opposite-colour foundations already hold rank - 1. */
static int safe_foundation(int card) {
    int rank = rank_of(card);
    if (rank <= 2) return 1;
    for (int suit = 0; suit < 4; ++suit) {
        int opposite = (suit == 1 || suit == 2) != red(card);
        if (opposite && foundation_rank_of_suit(suit) < rank - 1) return 0;
    }
    return 1;
}

static int suggest(int action, int from_kind, int from, int to_kind, int to, int count) {
    if (action == ACTION_MOVE && !sol_can_move(from_kind, from, to_kind, to, count)) return 0;
    if (action == ACTION_DRAW && !sol_can_draw()) return 0;
    if (action == ACTION_RECYCLE && !sol_can_recycle()) return 0;
    if (action == ACTION_FLIP && !sol_can_flip(from)) return 0;
    suggested[0] = action; suggested[1] = from_kind; suggested[2] = from;
    suggested[3] = to_kind; suggested[4] = to; suggested[5] = count;
    return 1;
}

static int suggest_foundation(int kind, int index, int safe_only) {
    int card = lead_card(kind, index, 1);
    if (card < 0 || (safe_only && !safe_foundation(card))) return 0;
    int slot = foundation_for(card);
    return slot >= 0 && suggest(ACTION_MOVE, kind, index, FOUNDATION, slot, 1);
}

int sol_hint_part(int index) { return index >= 0 && index < 6 ? suggested[index] : -1; }

/* A legal, sensible next step. It is a heuristic, not a solver: it never
 * claims the deal is still winnable. Returns 0 when nothing is left to try. */
int sol_hint(void) {
    if (sol_status()) return 0;
    for (int column = 0; column < 7; ++column) {
        if (suggest(ACTION_FLIP, TABLEAU, column, TABLEAU, column, 0)) return 1;
    }
    /* 1. Foundation moves that uncover a face-down card. */
    for (int column = 0; column < 7; ++column) {
        int face_up = position.lengths[column] - position.hidden[column];
        if (face_up == 1 && position.hidden[column] && suggest_foundation(TABLEAU, column, 0)) return 1;
    }
    /* 2. Move a whole face-up run to uncover a face-down card (most hidden first). */
    for (int wanted = 6; wanted >= 1; --wanted) {
        for (int from = 0; from < 7; ++from) {
            if (position.hidden[from] != wanted) continue;
            int count = position.lengths[from] - position.hidden[from];
            for (int to = 0; to < 7; ++to) {
                if (suggest(ACTION_MOVE, TABLEAU, from, TABLEAU, to, count)) return 1;
            }
        }
    }
    /* 3. Anything else that goes home. */
    if (suggest_foundation(WASTE, 0, 0)) return 1;
    for (int column = 0; column < 7; ++column) if (suggest_foundation(TABLEAU, column, 0)) return 1;
    /* 4. Play the waste card onto the tableau (kings only to empty columns). */
    for (int to = 0; to < 7; ++to) {
        if (suggest(ACTION_MOVE, WASTE, 0, TABLEAU, to, 1)) return 1;
    }
    /* 5. Fill an empty column with a king that is not already at the bottom. */
    for (int from = 0; from < 7; ++from) {
        int count = position.lengths[from] - position.hidden[from];
        if (!count || count == position.lengths[from]) continue;
        for (int to = 0; to < 7; ++to) {
            if (!position.lengths[to] && suggest(ACTION_MOVE, TABLEAU, from, TABLEAU, to, count)) return 1;
        }
    }
    /* 6. Turn the stock. */
    if (suggest(ACTION_DRAW, STOCK, 0, WASTE, 0, 0)) return 1;
    if (suggest(ACTION_RECYCLE, WASTE, 0, STOCK, 0, 0)) return 1;
    return 0;
}

/* Send one safe card home (waste first, then columns left to right). */
int sol_auto_move(void) {
    if (sol_status()) return 0;
    if (suggest_foundation(WASTE, 0, 1) ||
        suggest_foundation(TABLEAU, 0, 1) || suggest_foundation(TABLEAU, 1, 1) ||
        suggest_foundation(TABLEAU, 2, 1) || suggest_foundation(TABLEAU, 3, 1) ||
        suggest_foundation(TABLEAU, 4, 1) || suggest_foundation(TABLEAU, 5, 1) ||
        suggest_foundation(TABLEAU, 6, 1)) {
        return sol_move(suggested[1], suggested[2], suggested[3], suggested[4], 1);
    }
    return 0;
}

/* The game can finish itself once nothing is hidden and every remaining
 * stock card is reachable: the stock and waste are empty, or we draw one
 * card at a time with unlimited passes. */
int sol_can_autofinish(void) {
    if (sol_status()) return 0;
    for (int column = 0; column < 7; ++column) if (position.hidden[column]) return 0;
    if (!position.stock_length && !position.waste_length) return 1;
    return draw_count == 1 && sol_max_passes() == 0;
}

/* One step of the automatic finish: send the lowest available card home,
 * otherwise turn the stock. Returns the action taken + 1, or 0. */
int sol_finish_step(void) {
    if (!sol_can_autofinish()) return 0;
    int best_kind = -1, best_index = 0, best_slot = 0, best_rank = 99;
    for (int index = 0; index < 8; ++index) {
        /* index 0 is the waste, 1..7 are the columns. */
        int kind = index ? TABLEAU : WASTE;
        int from = index ? index - 1 : 0;
        int card = lead_card(kind, from, 1);
        if (card < 0 || rank_of(card) >= best_rank) continue;
        int slot = foundation_for(card);
        if (slot >= 0 && sol_can_move(kind, from, FOUNDATION, slot, 1)) {
            best_kind = kind; best_index = from; best_slot = slot; best_rank = rank_of(card);
        }
    }
    if (best_kind >= 0) {
        return sol_move(best_kind, best_index, FOUNDATION, best_slot, 1) ? ACTION_MOVE + 1 : 0;
    }
    if (sol_draw()) return ACTION_DRAW + 1;
    if (sol_recycle()) return ACTION_RECYCLE + 1;
    return 0;
}
