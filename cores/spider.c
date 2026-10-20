/* Stillplay's own Spider Solitaire rules, written from scratch in C.
 *
 * Two decks, 104 physical cards. Each physical card has a stable uid 0..103:
 * rank = uid % 13 (0 = ace .. 12 = king), deck slot = uid / 13 (0..7).
 * The face shown to players is a shared card id 0..51 (suit-major, clubs,
 * diamonds, hearts, spades), derived from the uid and the suit count:
 *   1 suit:  every card is a spade
 *   2 suits: even slots spades, odd slots hearts
 *   4 suits: slot % 4 picks clubs, diamonds, hearts, spades
 * See docs/spider-core.md for rules, scoring and limits.
 */
#include <stdint.h>

#define COLUMNS 10
#define CARDS 104
#define STOCK_SIZE 50
#define RUNS 8
#define UNDO_LIMIT 4096
#define MAX_HINTS 256
#define START_SCORE 500

typedef struct {
    uint8_t cards[COLUMNS][CARDS];   /* index 0 is the covered bottom, len-1 the playable top */
    uint8_t length[COLUMNS];
    uint8_t down[COLUMNS];           /* cards [0, down) are face down */
    uint8_t stock[STOCK_SIZE];       /* dealt from the end */
    uint8_t stock_length;
    uint8_t run_cards[RUNS][13];     /* completed runs, king first, in completion order */
    uint8_t runs;
} Position;

/* Compact snapshot for undo: every uid once, in column/stock/run order. */
typedef struct {
    uint8_t order[CARDS];
    uint8_t length[COLUMNS];
    uint8_t down[COLUMNS];
    uint8_t stock_length;
    uint8_t runs;
} Snapshot;

static Position position;
static Snapshot history[UNDO_LIMIT];
static unsigned history_head;
static unsigned history_count;
static uint32_t game_seed;
static int suit_count = 1;
static uint32_t actions_taken;      /* moves, deals and undos; each costs a point */
static uint32_t last_flips;         /* bit per column flipped by the last action */
static uint32_t last_completed;     /* bit per column that completed a run in the last action */

static int hint_from[MAX_HINTS], hint_to[MAX_HINTS], hint_count_value[MAX_HINTS], hint_score[MAX_HINTS];
static int hints;

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

/* ---- Seeded randomness (PCG32, XSH-RR) ---- */

static uint64_t rng_state, rng_increment;

static uint32_t rng_next(void) {
    uint64_t old = rng_state;
    rng_state = old * 6364136223846793005ULL + rng_increment;
    uint32_t shifted = (uint32_t)(((old >> 18) ^ old) >> 27);
    uint32_t rotation = (uint32_t)(old >> 59);
    return (shifted >> rotation) | (shifted << ((32 - rotation) & 31));
}

static void rng_seed(uint32_t seed, uint32_t stream) {
    rng_state = 0;
    rng_increment = ((uint64_t)stream << 1) | 1U;
    rng_next();
    rng_state += seed;
    rng_next();
}

/* Unbiased integer in [0, bound). */
static uint32_t rng_below(uint32_t bound) {
    uint32_t threshold = (0U - bound) % bound;
    for (;;) {
        uint32_t value = rng_next();
        if (value >= threshold) return value % bound;
    }
}

/* ---- Card helpers ---- */

static int rank_of(int uid) { return uid % 13; }
static int suit_of(int uid) {
    int slot = uid / 13;
    if (suit_count == 1) return 3;
    if (suit_count == 2) return (slot & 1) ? 2 : 3;
    return slot & 3;
}
static int top_uid(int column) {
    int length = position.length[column];
    return length ? position.cards[column][length - 1] : -1;
}

int sp_card_face(int uid) {
    if (uid < 0 || uid >= CARDS) return -1;
    return suit_of(uid) * 13 + rank_of(uid);
}

/* Number of cards at the top of a column forming a face-up, same-suit,
 * descending run. These are the only groups that may be picked up. */
int sp_run_length(int column) {
    if (column < 0 || column >= COLUMNS) return 0;
    int length = position.length[column];
    if (!length) return 0;
    int run = 1;
    for (int i = length - 1; i > position.down[column]; --i) {
        int upper = position.cards[column][i], lower = position.cards[column][i - 1];
        if (suit_of(upper) != suit_of(lower) || rank_of(upper) + 1 != rank_of(lower)) break;
        ++run;
    }
    return run;
}

/* ---- Undo snapshots ---- */

static void save_snapshot(void) {
    Snapshot *snapshot = &history[history_head];
    int at = 0;
    for (int c = 0; c < COLUMNS; ++c) {
        for (int i = 0; i < position.length[c]; ++i) snapshot->order[at++] = position.cards[c][i];
        snapshot->length[c] = position.length[c];
        snapshot->down[c] = position.down[c];
    }
    for (int i = 0; i < position.stock_length; ++i) snapshot->order[at++] = position.stock[i];
    for (int r = 0; r < position.runs; ++r) {
        for (int i = 0; i < 13; ++i) snapshot->order[at++] = position.run_cards[r][i];
    }
    snapshot->stock_length = position.stock_length;
    snapshot->runs = position.runs;
    history_head = (history_head + 1) % UNDO_LIMIT;
    if (history_count < UNDO_LIMIT) ++history_count;
}

static void load_snapshot(const Snapshot *snapshot) {
    int at = 0;
    for (int c = 0; c < COLUMNS; ++c) {
        position.length[c] = snapshot->length[c];
        position.down[c] = snapshot->down[c];
        for (int i = 0; i < position.length[c]; ++i) position.cards[c][i] = snapshot->order[at++];
    }
    position.stock_length = snapshot->stock_length;
    for (int i = 0; i < position.stock_length; ++i) position.stock[i] = snapshot->order[at++];
    position.runs = snapshot->runs;
    for (int r = 0; r < position.runs; ++r) {
        for (int i = 0; i < 13; ++i) position.run_cards[r][i] = snapshot->order[at++];
    }
}

/* ---- Game setup ---- */

int sp_new(uint32_t seed, int suits) {
    if (suits != 1 && suits != 2 && suits != 4) return 0;
    memset(&position, 0, sizeof(position));
    suit_count = suits;
    game_seed = seed;
    history_head = history_count = 0;
    actions_taken = last_flips = last_completed = 0;
    hints = 0;

    uint8_t deck[CARDS];
    for (int i = 0; i < CARDS; ++i) deck[i] = (uint8_t)i;
    rng_seed(seed, 0x5350U + (uint32_t)suits); /* "SP" plus the suit count */
    for (int i = CARDS - 1; i > 0; --i) {
        int j = (int)rng_below((uint32_t)i + 1);
        uint8_t swap = deck[i]; deck[i] = deck[j]; deck[j] = swap;
    }
    /* 54 cards dealt row by row: columns 0-3 receive six, columns 4-9 five. */
    for (int i = 0; i < 54; ++i) {
        int column = i % COLUMNS;
        position.cards[column][position.length[column]++] = deck[i];
    }
    for (int c = 0; c < COLUMNS; ++c) position.down[c] = position.length[c] - 1;
    for (int i = 0; i < STOCK_SIZE; ++i) position.stock[i] = deck[54 + i];
    position.stock_length = STOCK_SIZE;
    return 1;
}

uint32_t sp_seed(void) { return game_seed; }
int sp_suits(void) { return suit_count; }
uint32_t sp_moves(void) { return actions_taken; }
int sp_score(void) { return START_SCORE - (int)actions_taken + 100 * position.runs; }
int sp_status(void) { return position.runs == RUNS; }
int sp_stock(void) { return position.stock_length; }
int sp_completed(void) { return position.runs; }
int sp_completed_suit(int index) {
    return index >= 0 && index < position.runs ? suit_of(position.run_cards[index][0]) : -1;
}
int sp_column_length(int column) {
    return column >= 0 && column < COLUMNS ? position.length[column] : -1;
}
int sp_column_down(int column) {
    return column >= 0 && column < COLUMNS ? position.down[column] : -1;
}
int sp_column_card(int column, int index) {
    if (column < 0 || column >= COLUMNS || index < 0 || index >= position.length[column]) return -1;
    return position.cards[column][index];
}
/* The 50-card stock, by position (0 is the last card that will be dealt). */
int sp_stock_card(int index) {
    return index >= 0 && index < position.stock_length ? position.stock[index] : -1;
}
uint32_t sp_last_flips(void) { return last_flips; }
uint32_t sp_last_completed(void) { return last_completed; }

/* ---- Rules ---- */

static void flip_top(int column) {
    if (position.length[column] && position.down[column] == position.length[column]) {
        --position.down[column];
        last_flips |= 1U << column;
    }
}

/* Remove a finished king-to-ace run of one suit from the top of a column. */
static void collect_run(int column) {
    int length = position.length[column];
    if (length < 13 || length - 13 < position.down[column]) return;
    if (sp_run_length(column) < 13) return;
    int start = length - 13;
    if (rank_of(position.cards[column][start]) != 12) return;
    for (int i = 0; i < 13; ++i) position.run_cards[position.runs][i] = position.cards[column][start + i];
    ++position.runs;
    position.length[column] = (uint8_t)start;
    last_completed |= 1U << column;
    flip_top(column);
}

int sp_can_move(int from, int to, int count) {
    if (from < 0 || from >= COLUMNS || to < 0 || to >= COLUMNS || from == to) return 0;
    if (sp_status() || count < 1 || count > sp_run_length(from)) return 0;
    int moving = position.cards[from][position.length[from] - count];
    int target = top_uid(to);
    return target < 0 || rank_of(target) == rank_of(moving) + 1;
}

int sp_move(int from, int to, int count) {
    if (!sp_can_move(from, to, count)) return 0;
    save_snapshot();
    last_flips = last_completed = 0;
    int start = position.length[from] - count;
    for (int i = start; i < position.length[from]; ++i) {
        position.cards[to][position.length[to]++] = position.cards[from][i];
    }
    position.length[from] = (uint8_t)start;
    flip_top(from);
    collect_run(to);
    ++actions_taken;
    return 1;
}

/* Classic rule: a row can be dealt only when every column holds a card. */
int sp_can_deal(void) {
    if (sp_status() || position.stock_length < COLUMNS) return 0;
    for (int c = 0; c < COLUMNS; ++c) if (!position.length[c]) return 0;
    return 1;
}

int sp_deal(void) {
    if (!sp_can_deal()) return 0;
    save_snapshot();
    last_flips = last_completed = 0;
    for (int c = 0; c < COLUMNS; ++c) {
        position.cards[c][position.length[c]++] = position.stock[--position.stock_length];
    }
    for (int c = 0; c < COLUMNS; ++c) collect_run(c);
    ++actions_taken;
    return 1;
}

/* Undo restores the previous layout. It counts as an action, so it costs a
 * point, and the 100 points of an undone completed run are taken back. */
int sp_undo(void) {
    if (!history_count) return 0;
    history_head = (history_head + UNDO_LIMIT - 1) % UNDO_LIMIT;
    load_snapshot(&history[history_head]);
    --history_count;
    last_flips = last_completed = 0;
    ++actions_taken;
    return 1;
}

int sp_can_undo(void) { return history_count > 0; }

/* ---- Hints ----
 * Every useful legal move is scored and ranked. Pointless moves are left out:
 * moving a whole column into an empty one, and sideways moves that leave the
 * run on an equally good parent. A deal, when allowed, is ranked last. */

static int same_suit_run_below(int column, int skip) {
    /* Length of the same-suit run at the top of `column`, ignoring the top `skip` cards. */
    int length = position.length[column] - skip;
    if (length <= 0) return 0;
    int run = 1;
    for (int i = length - 1; i > position.down[column]; --i) {
        int upper = position.cards[column][i], lower = position.cards[column][i - 1];
        if (suit_of(upper) != suit_of(lower) || rank_of(upper) + 1 != rank_of(lower)) break;
        ++run;
    }
    return run;
}

#define SKIP (-100000)

static int score_move(int from, int to, int count) {
    int length = position.length[from];
    int moving = position.cards[from][length - count];
    int beneath = length - count - 1;
    int target = top_uid(to);
    int same_suit_target = target >= 0 && suit_of(target) == suit_of(moving);
    int score = 0;

    if (beneath >= 0 && beneath >= position.down[from]) {
        int parent = position.cards[from][beneath];
        if (rank_of(parent) == rank_of(moving) + 1) {
            /* Already on a natural parent. Worth it only to trade an off-suit
             * parent for a same-suit one, or to fill an empty column so the
             * next row can be dealt. */
            if (target >= 0) {
                if (suit_of(parent) == suit_of(moving) || !same_suit_target) return SKIP;
            } else {
                if (!position.stock_length) return SKIP;
                return -400 - count;
            }
        } else score += 5;
    } else if (beneath >= 0) {
        score += 50 + 2 * (COLUMNS - position.down[from]); /* expose a face-down card */
    } else {
        if (target < 0) return SKIP;                       /* whole column into an empty one */
        score += 40;                                        /* frees a column */
    }

    if (target >= 0) {
        score += 20;
        if (same_suit_target) {
            int built = count + same_suit_run_below(to, 0);
            score += 60 + 2 * built;
            if (built >= 13) score += 500;                  /* completes king to ace */
        }
    } else score -= 60 + count;                             /* spends an empty column */
    return score;
}

static void add_hint(int from, int to, int count, int score) {
    if (hints >= MAX_HINTS) return;
    int at = hints++;
    /* Insertion sort: higher score first; earlier generation order breaks ties. */
    while (at > 0 && hint_score[at - 1] < score) {
        hint_from[at] = hint_from[at - 1];
        hint_to[at] = hint_to[at - 1];
        hint_count_value[at] = hint_count_value[at - 1];
        hint_score[at] = hint_score[at - 1];
        --at;
    }
    hint_from[at] = from; hint_to[at] = to; hint_count_value[at] = count; hint_score[at] = score;
}

/* Rebuilds the ranked hint list and returns its length. A deal appears as
 * from = -1. Read entries with sp_hint_part. */
int sp_hints(void) {
    hints = 0;
    if (sp_status()) return 0;
    int first_empty = -1;
    for (int c = 0; c < COLUMNS && first_empty < 0; ++c) if (!position.length[c]) first_empty = c;
    for (int from = 0; from < COLUMNS; ++from) {
        int run = sp_run_length(from);
        if (!run) continue;
        for (int to = 0; to < COLUMNS; ++to) {
            if (to == from) continue;
            int target = top_uid(to);
            if (target < 0) {
                /* Empty columns are interchangeable: offer only the first one,
                 * with every legal group size. */
                if (to != first_empty) continue;
                for (int count = run; count > 0; --count) {
                    int score = score_move(from, to, count);
                    if (score != SKIP) add_hint(from, to, count, score);
                }
                continue;
            }
            int count = rank_of(target) - rank_of(position.cards[from][position.length[from] - 1]);
            if (count < 1 || count > run || !sp_can_move(from, to, count)) continue;
            int score = score_move(from, to, count);
            if (score != SKIP) add_hint(from, to, count, score);
        }
    }
    if (sp_can_deal()) add_hint(-1, -1, 0, -1000); /* below every move */
    return hints;
}

int sp_hint_part(int index, int part) {
    if (index < 0 || index >= hints) return -2;
    if (part == 0) return hint_from[index];
    if (part == 1) return hint_to[index];
    if (part == 2) return hint_count_value[index];
    if (part == 3) return hint_score[index];
    return -2;
}

/* True while a useful move or a deal remains. */
int sp_has_moves(void) { return sp_hints() > 0; }

/* Position hash for search and loop detection (ignores score and history). */
uint32_t sp_hash(uint32_t salt) {
    uint32_t hash = 2166136261U ^ salt;
    for (int c = 0; c < COLUMNS; ++c) {
        hash = (hash ^ (uint32_t)(position.down[c] + 200)) * 16777619U;
        for (int i = 0; i < position.length[c]; ++i) {
            /* Hash faces, not uids: identical-looking layouts are the same position. */
            hash = (hash ^ (uint32_t)sp_card_face(position.cards[c][i])) * 16777619U;
        }
        hash = (hash ^ 255U) * 16777619U;
    }
    hash = (hash ^ position.stock_length) * 16777619U;
    hash ^= hash >> 15; hash *= 0x2c1b3c6dU; hash ^= hash >> 12;
    return hash;
}
