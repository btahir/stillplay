/*
 * Stillplay's own deterministic Minesweeper rules, written from scratch in C.
 *
 * Build without a C runtime, e.g.:
 * clang --target=wasm32 -O2 -fno-builtin -nostdlib \
 *   -Wl,--no-entry -Wl,--export-all minesweeper.c -o minesweeper.wasm
 */

typedef unsigned int u32;

#define MAX_CELLS 480
#define MINE 1
#define REVEALED 2
#define FLAGGED 4
#define ADJACENT_SHIFT 3

static unsigned char cells[MAX_CELLS];
static int queue[MAX_CELLS];
static int board_width;
static int board_height;
static int mine_count;
static int flag_count;
static int revealed_count;
static int game_status; /* 0 ready, 1 playing, 2 won, 3 lost */
static int game_level;
static u32 initial_seed;
static u32 random_state;

static u32 next_random(void) {
    random_state = random_state * 214013u + 2531011u;
    return (random_state >> 16) & 0x7fffu;
}

static int valid(int x, int y) {
    return x >= 0 && x < board_width && y >= 0 && y < board_height;
}

static void count_neighbors(void) {
    for (int y = 0; y < board_height; ++y) {
        for (int x = 0; x < board_width; ++x) {
            int adjacent = 0;
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    if ((dx || dy) && valid(x + dx, y + dy)) {
                        adjacent += !!(cells[(y + dy) * board_width + x + dx] & MINE);
                    }
                }
            }
            int index = y * board_width + x;
            cells[index] = (cells[index] & 7) | (adjacent << ADJACENT_SHIFT);
        }
    }
}

void ms_new_game(int level, u32 seed) {
    game_level = level >= 0 && level <= 2 ? level : 0;
    board_width = game_level == 0 ? 9 : game_level == 1 ? 16 : 30;
    board_height = game_level == 0 ? 9 : 16;
    mine_count = game_level == 0 ? 10 : game_level == 1 ? 40 : 99;
    flag_count = 0;
    revealed_count = 0;
    game_status = 0;
    initial_seed = seed;
    random_state = seed;
    int total = board_width * board_height;
    for (int i = 0; i < MAX_CELLS; ++i) cells[i] = 0;
    for (int placed = 0; placed < mine_count;) {
        int index = next_random() % total;
        if (!(cells[index] & MINE)) {
            cells[index] |= MINE;
            ++placed;
        }
    }
    count_neighbors();
}

static void finish_if_won(void) {
    if (game_status == 1 && revealed_count == board_width * board_height - mine_count) {
        game_status = 2;
        for (int i = 0; i < board_width * board_height; ++i) {
            if ((cells[i] & MINE) && !(cells[i] & FLAGGED)) {
                cells[i] |= FLAGGED;
                ++flag_count;
            }
        }
    }
}

static void uncover(int start) {
    if (cells[start] & (REVEALED | FLAGGED)) return;
    if (cells[start] & MINE) {
        game_status = 3;
        for (int i = 0; i < board_width * board_height; ++i) {
            if (cells[i] & MINE) cells[i] |= REVEALED;
        }
        return;
    }

    int head = 0;
    int tail = 0;
    cells[start] |= REVEALED;
    ++revealed_count;
    queue[tail++] = start;
    while (head < tail) {
        int index = queue[head++];
        if (cells[index] >> ADJACENT_SHIFT) continue;
        int x = index % board_width;
        int y = index / board_width;
        for (int dy = -1; dy <= 1; ++dy) {
            for (int dx = -1; dx <= 1; ++dx) {
                if (!(dx || dy) || !valid(x + dx, y + dy)) continue;
                int next = (y + dy) * board_width + x + dx;
                if (cells[next] & (MINE | REVEALED | FLAGGED)) continue;
                cells[next] |= REVEALED;
                ++revealed_count;
                queue[tail++] = next;
            }
        }
    }
    finish_if_won();
}

void ms_reveal(int x, int y) {
    if (!valid(x, y) || game_status > 1) return;
    int index = y * board_width + x;
    if (cells[index] & (REVEALED | FLAGGED)) return;
    if (game_status == 0) {
        /* An initial mine moves to the first unoccupied cell in row order. */
        if (cells[index] & MINE) {
            cells[index] &= ~MINE;
            for (int target = 0; target < board_width * board_height; ++target) {
                if (target != index && !(cells[target] & MINE)) {
                    cells[target] |= MINE;
                    break;
                }
            }
            count_neighbors();
        }
        game_status = 1;
    }
    uncover(index);
}

void ms_flag(int x, int y) {
    if (!valid(x, y) || game_status > 1) return;
    int index = y * board_width + x;
    if (cells[index] & REVEALED) return;
    cells[index] ^= FLAGGED;
    flag_count += cells[index] & FLAGGED ? 1 : -1;
}

void ms_chord(int x, int y) {
    if (!valid(x, y) || game_status != 1) return;
    int index = y * board_width + x;
    int adjacent = cells[index] >> ADJACENT_SHIFT;
    if (!(cells[index] & REVEALED) || !adjacent) return;
    int flags = 0;
    for (int dy = -1; dy <= 1; ++dy) {
        for (int dx = -1; dx <= 1; ++dx) {
            if ((dx || dy) && valid(x + dx, y + dy)) {
                flags += !!(cells[(y + dy) * board_width + x + dx] & FLAGGED);
            }
        }
    }
    if (flags != adjacent) return;
    for (int dy = -1; dy <= 1 && game_status == 1; ++dy) {
        for (int dx = -1; dx <= 1 && game_status == 1; ++dx) {
            if ((dx || dy) && valid(x + dx, y + dy)) {
                uncover((y + dy) * board_width + x + dx);
            }
        }
    }
}

int ms_cell(int index) {
    return index >= 0 && index < board_width * board_height ? cells[index] : -1;
}
int ms_width(void) { return board_width; }
int ms_height(void) { return board_height; }
int ms_mines(void) { return mine_count; }
int ms_flags(void) { return flag_count; }
int ms_revealed(void) { return revealed_count; }
int ms_status(void) { return game_status; }
int ms_level(void) { return game_level; }
u32 ms_seed(void) { return initial_seed; }
