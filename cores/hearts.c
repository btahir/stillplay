/* Original-authored Hearts rules and opponents. This is not a decompilation of
 * Microsoft software and has not been compared against an original executable.
 *
 * Cards use the shared suit-major ids: clubs 0-12, diamonds 13-25, hearts
 * 26-38, spades 39-51; id % 13 is 0 for the ace through 12 for the king.
 * Aces are high in Hearts. Seats: 0 is the human (south), then 1 west,
 * 2 north, 3 east; play runs 0 -> 1 -> 2 -> 3. Passing left gives to seat + 1.
 *
 * The computer players are fair: they decide from their own hand and public
 * information only (cards played, observed voids, points taken, the cards
 * they passed). See docs/hearts-core.md.
 */
#include <stdint.h>

typedef uint64_t Set;

#define PHASE_PASS 0
#define PHASE_PLAY 1
#define PHASE_HAND_OVER 2
#define PHASE_GAME_OVER 3

#define HUMAN 0
#define RANDOM 1
#define CASUAL 2
#define STANDARD 3

#define TWO_CLUBS 1
#define ACE_SPADES 39
#define KING_SPADES 51
#define QUEEN_SPADES 50
#define MAX_HANDS 64
#define GAME_TARGET 100
/* A rival holding every point so far is treated as a moon threat once they
 * have this many points: before trick 4, before trick 8, and after. */
#define THREAT_EARLY 13
#define THREAT_MID 5
#define THREAT_LATE 2
#define THREAT_LEAD 600   /* under a threat, lead a heart nobody can beat */

#define BIT(card) ((Set)1 << (card))
#define SUIT_MASK(suit) ((Set)0x1FFF << (13 * (suit)))
#define HEARTS_MASK SUIT_MASK(2)
#define POINT_MASK (HEARTS_MASK | BIT(QUEEN_SPADES))

static Set hands[4];
static Set played;                 /* every card played this hand, including the current trick */
static Set passed_cards[4];        /* what each seat gave away this hand */
static Set received_cards[4];
static int player_kind[4];
static int scores[4];
static int hand_points[4];
static int last_points[4];
static int moon_shooter = -1;
static int history[MAX_HANDS][4];
static int history_count;
static int phase;
static int hand_number;
static int turn;
static int hearts_broken;
static int tricks_done;
static int trick_size;
static int trick_card[4];
static int trick_seat[4];
static int log_card[52], log_seat[52], log_count;
static int trick_winner[13], trick_points_taken[13];
static uint8_t known_void[4];      /* bit per suit: seat failed to follow it */
static int shooting[4];            /* a standard player is going for the moon */
static uint32_t game_seed;
static int game_difficulty;
static int hint_cards[3];

void *memset(void *destination, int value, unsigned long size) {
    unsigned char *to = destination;
    for (unsigned long i = 0; i < size; ++i) to[i] = (unsigned char)value;
    return destination;
}

void *memcpy(void *destination, const void *source, unsigned long size) {
    unsigned char *to = destination;
    const unsigned char *from = source;
    for (unsigned long i = 0; i < size; ++i) to[i] = from[i];
    return destination;
}

/* ---- Seeded randomness (PCG32): one stream for deals, one for casual and random players ---- */

typedef struct { uint64_t state, increment; } Rng;
static Rng deck_rng, ai_rng;

static uint32_t rng_next(Rng *rng) {
    uint64_t old = rng->state;
    rng->state = old * 6364136223846793005ULL + rng->increment;
    uint32_t shifted = (uint32_t)(((old >> 18) ^ old) >> 27);
    uint32_t rotation = (uint32_t)(old >> 59);
    return (shifted >> rotation) | (shifted << ((32 - rotation) & 31));
}

static void rng_seed(Rng *rng, uint32_t seed, uint32_t stream) {
    rng->state = 0;
    rng->increment = ((uint64_t)stream << 1) | 1U;
    rng_next(rng);
    rng->state += seed;
    rng_next(rng);
}

static uint32_t rng_below(Rng *rng, uint32_t bound) {
    uint32_t threshold = (0U - bound) % bound;
    for (;;) {
        uint32_t value = rng_next(rng);
        if (value >= threshold) return value % bound;
    }
}

/* ---- Card helpers ---- */

static int suit_of(int card) { return card / 13; }
static int power(int card) { return (card % 13 + 12) % 13; } /* 2 = 0 ... king = 11, ace = 12 */
static int count(Set set) { return __builtin_popcountll(set); }
static int card_points(int card) { return card == QUEEN_SPADES ? 13 : suit_of(card) == 2 ? 1 : 0; }

static int highest(Set set) {
    int best = -1;
    for (int card = 0; card < 52; ++card) {
        if ((set & BIT(card)) && (best < 0 || power(card) > power(best))) best = card;
    }
    return best;
}

static int lowest(Set set) {
    int best = -1;
    for (int card = 0; card < 52; ++card) {
        if ((set & BIT(card)) && (best < 0 || power(card) < power(best))) best = card;
    }
    return best;
}

static Set above(Set set, int card) {
    Set result = 0;
    for (int other = 0; other < 52; ++other) {
        if ((set & BIT(other)) && suit_of(other) == suit_of(card) && power(other) > power(card)) result |= BIT(other);
    }
    return result;
}

static Set below(Set set, int card) {
    Set result = 0;
    for (int other = 0; other < 52; ++other) {
        if ((set & BIT(other)) && suit_of(other) == suit_of(card) && power(other) < power(card)) result |= BIT(other);
    }
    return result;
}

static int nth_card(Set set, int index) {
    for (int card = 0; card < 52; ++card) {
        if ((set & BIT(card)) && index-- == 0) return card;
    }
    return -1;
}

static int pass_target(int seat) {
    int direction = hand_number % 4;
    return direction == 0 ? (seat + 1) % 4 : direction == 1 ? (seat + 3) % 4 : (seat + 2) % 4;
}

/* ---- Rules ---- */

static Set legal_set(int seat) {
    Set hand = hands[seat];
    if (!trick_size) {
        if (!tricks_done) return hand & BIT(TWO_CLUBS);
        if (!hearts_broken && (hand & ~HEARTS_MASK)) return hand & ~HEARTS_MASK;
        return hand;
    }
    Set follow = hand & SUIT_MASK(suit_of(trick_card[0]));
    if (follow) return follow;
    if (!tricks_done && (hand & ~POINT_MASK)) return hand & ~POINT_MASK;
    return hand;
}

static int current_winner_index(void) {
    int best = 0;
    for (int i = 1; i < trick_size; ++i) {
        if (suit_of(trick_card[i]) == suit_of(trick_card[0]) && power(trick_card[i]) > power(trick_card[best])) best = i;
    }
    return best;
}

static int trick_points_so_far(void) {
    int total = 0;
    for (int i = 0; i < trick_size; ++i) total += card_points(trick_card[i]);
    return total;
}

static void finish_hand(void) {
    moon_shooter = -1;
    for (int seat = 0; seat < 4; ++seat) if (hand_points[seat] == 26) moon_shooter = seat;
    for (int seat = 0; seat < 4; ++seat) {
        last_points[seat] = moon_shooter < 0 ? hand_points[seat] : seat == moon_shooter ? 0 : 26;
        scores[seat] += last_points[seat];
        if (history_count < MAX_HANDS) history[history_count][seat] = last_points[seat];
    }
    if (history_count < MAX_HANDS) ++history_count;
    phase = PHASE_HAND_OVER;
    for (int seat = 0; seat < 4; ++seat) if (scores[seat] >= GAME_TARGET) phase = PHASE_GAME_OVER;
    /* Safety valve: the history buffer bounds a game. Unreachable in practice. */
    if (hand_number + 1 >= MAX_HANDS) phase = PHASE_GAME_OVER;
}

static void play_card(int seat, int card) {
    hands[seat] &= ~BIT(card);
    played |= BIT(card);
    if (trick_size && suit_of(card) != suit_of(trick_card[0])) known_void[seat] |= (uint8_t)(1 << suit_of(trick_card[0]));
    if (suit_of(card) == 2) hearts_broken = 1;
    trick_card[trick_size] = card;
    trick_seat[trick_size] = seat;
    ++trick_size;
    log_card[log_count] = card;
    log_seat[log_count] = seat;
    ++log_count;
    turn = (seat + 1) % 4;
    if (trick_size < 4) return;

    int winner = trick_seat[current_winner_index()];
    int points = trick_points_so_far();
    hand_points[winner] += points;
    trick_winner[tricks_done] = winner;
    trick_points_taken[tricks_done] = points;
    ++tricks_done;
    trick_size = 0;
    turn = winner;
    /* A moon attempt ends as soon as anyone else holds a point. */
    for (int shooter = 0; shooter < 4; ++shooter) {
        for (int other = 0; other < 4; ++other) {
            if (other != shooter && hand_points[other]) shooting[shooter] = 0;
        }
    }
    if (tricks_done == 13) finish_hand();
}

/* ---- Computer players ---- */

static int is_standard(int seat) { return player_kind[seat] == STANDARD; }

/* Cards not yet seen by `seat`: held by somebody else. */
static Set unseen(int seat, int suit) { return SUIT_MASK(suit) & ~played & ~hands[seat]; }

/* Rough count of tricks a hand can force: top cards in sequence per suit. */
static int sure_winners(Set hand, int suit) {
    int winners = 0;
    for (int rank_power = 12; rank_power >= 0; --rank_power) {
        int card = suit * 13 + (rank_power + 1) % 13;
        if (hand & BIT(card)) ++winners; else break;
    }
    return winners;
}

static int moon_worthy(Set hand) {
    int hearts = count(hand & HEARTS_MASK);
    int heart_tops = sure_winners(hand, 2);
    int tops = 0, high = 0;
    for (int suit = 0; suit < 4; ++suit) tops += sure_winners(hand, suit);
    for (int card = 0; card < 52; ++card) if ((hand & BIT(card)) && power(card) >= 10) ++high;
    return hearts >= 5 && heart_tops >= 3 && tops >= 6 && high >= 7;
}

static int pass_score(int seat, Set hand, int card) {
    int suit = suit_of(card), strength = power(card);
    int in_suit = count(hand & SUIT_MASK(suit));
    if (player_kind[seat] == CASUAL) {
        int score = strength * 2 + (card == QUEEN_SPADES ? 40 : 0) + (suit == 2 ? 6 : 0);
        return score + (int)rng_below(&ai_rng, 7);
    }
    if (moon_worthy(hand)) return 20 - strength - (suit == 2 ? 30 : 0);
    int low_spades = count(hand & SUIT_MASK(3) & ~(BIT(QUEEN_SPADES) | BIT(KING_SPADES) | BIT(ACE_SPADES)));
    if (card == QUEEN_SPADES) return low_spades >= 4 ? 4 : 100;
    if (card == ACE_SPADES || card == KING_SPADES) return low_spades >= 4 ? 10 + strength : 70 + strength;
    if (suit == 3) return strength / 3 - 12;  /* low spades protect against the queen */
    if (suit == 2) return strength * 3;
    int score = strength * 2;
    if (in_suit <= 3) score += (4 - in_suit) * 9; /* empty a short suit */
    if (card == TWO_CLUBS) score -= 4;
    return score;
}

static void choose_pass(int seat, int out[3]) {
    Set hand = hands[seat];
    for (int pick = 0; pick < 3; ++pick) {
        if (player_kind[seat] == RANDOM) {
            out[pick] = nth_card(hand, (int)rng_below(&ai_rng, (uint32_t)count(hand)));
        } else {
            int best = -1, best_score = 0;
            for (int card = 0; card < 52; ++card) {
                if (!(hand & BIT(card))) continue;
                int score = pass_score(seat, hand, card);
                if (best < 0 || score > best_score) { best = card; best_score = score; }
            }
            out[pick] = best;
        }
        hand &= ~BIT(out[pick]);
    }
}

/* A rival who has taken every point so far and is close to taking them all. */
static int moon_threat(int seat) {
    int total = 0, holder = -1, holders = 0;
    for (int other = 0; other < 4; ++other) {
        if (hand_points[other]) { total += hand_points[other]; holder = other; ++holders; }
    }
    if (holders != 1 || holder == seat) return -1;
    int need = tricks_done < 4 ? THREAT_EARLY : tricks_done < 8 ? THREAT_MID : THREAT_LATE;
    return total >= need ? holder : -1;
}

static int choose_shooting(int seat, Set legal) {
    if (!trick_size) {
        /* Lead a card nobody can beat, else the strongest card held. */
        int best = -1;
        for (int card = 0; card < 52; ++card) {
            if (!(legal & BIT(card))) continue;
            if (!above(unseen(seat, suit_of(card)), card)) {
                if (best < 0 || suit_of(card) != 2 || suit_of(best) == 2) best = card;
            }
        }
        return best >= 0 ? best : highest(legal);
    }
    int winner = trick_card[current_winner_index()];
    Set beat = above(legal, winner);
    if (beat) return trick_size == 3 ? lowest(beat) : highest(beat);
    Set safe = legal & ~POINT_MASK;
    return lowest(safe ? safe : legal);
}

static int lead_risk(int seat, int card) {
    int suit = suit_of(card), strength = power(card);
    Set out = unseen(seat, suit);
    int higher = count(above(out, card));
    int queen_out = !(played & BIT(QUEEN_SPADES)) && !(hands[seat] & BIT(QUEEN_SPADES));
    int risk;
    if (!out) risk = 1000 + strength;
    else if (!higher) risk = 400 + strength * 4;
    else risk = strength * 4 - higher * 3;
    for (int other = 0; other < 4; ++other) {
        if (other != seat && (known_void[other] & (1 << suit))) risk += 35;
    }
    if (suit == 2) risk += 12;
    if (suit == 3) {
        if (card == QUEEN_SPADES) risk += (out & (BIT(ACE_SPADES) | BIT(KING_SPADES))) ? 300 : 1200;
        else if (queen_out && (card == ACE_SPADES || card == KING_SPADES)) risk += 300;
        else if (queen_out && power(card) < power(QUEEN_SPADES)) risk -= 25; /* flush the queen out */
    }
    return risk;
}

static int choose_standard(int seat, Set legal) {
    if (shooting[seat]) return choose_shooting(seat, legal);
    int threat = moon_threat(seat);
    int queen_out = !(played & BIT(QUEEN_SPADES)) && !(hands[seat] & BIT(QUEEN_SPADES));

    if (!trick_size) {
        int best = -1, best_risk = 0;
        for (int card = 0; card < 52; ++card) {
            if (!(legal & BIT(card))) continue;
            int risk = lead_risk(seat, card);
            if (threat >= 0 && suit_of(card) == 2) {
                /* Take a heart yourself: a sure winner ends the moon shot. */
                risk -= above(unseen(seat, 2), card) ? 30 : THREAT_LEAD;
            }
            if (best < 0 || risk < best_risk || (risk == best_risk && power(card) < power(best))) {
                best = card; best_risk = risk;
            }
        }
        return best;
    }

    int led = suit_of(trick_card[0]);
    int winner_index = current_winner_index();
    int winner = trick_card[winner_index];
    int winner_seat = trick_seat[winner_index];
    int last = trick_size == 3;

    if (legal & SUIT_MASK(led)) {
        if (!tricks_done) return highest(legal); /* nothing can be dumped on the first trick */
        Set duck = below(legal, winner);
        Set beat = above(legal, winner);
        if (threat >= 0 && threat == winner_seat && beat && trick_points_so_far() > 0) return highest(beat);
        if (duck) return highest(duck);
        Set no_queen = beat & ~BIT(QUEEN_SPADES);
        if (last) return highest(no_queen ? no_queen : beat);
        if (led == 2 || (led == 3 && queen_out)) return lowest(no_queen ? no_queen : beat);
        int voids_left = 0;
        for (int i = trick_size + 1; i < 4; ++i) {
            int later = (trick_seat[0] + i) % 4;
            if (known_void[later] & (1 << led)) ++voids_left;
        }
        if (voids_left) return lowest(no_queen ? no_queen : beat);
        return highest(no_queen ? no_queen : beat);
    }

    /* Void in the led suit: get rid of danger, unless that could feed a moon
     * (the shooter is winning, or still to play). */
    int threat_to_play = 0;
    for (int i = trick_size + 1; i < 4; ++i) if ((trick_seat[0] + i) % 4 == threat) threat_to_play = 1;
    if (threat >= 0 && (threat == winner_seat || threat_to_play)) {
        Set safe = legal & ~POINT_MASK;
        if (safe) return highest(safe);
    }
    if (legal & BIT(QUEEN_SPADES)) return QUEEN_SPADES;
    if (queen_out || (hands[seat] & BIT(QUEEN_SPADES))) {
        if (legal & BIT(ACE_SPADES)) return ACE_SPADES;
        if (legal & BIT(KING_SPADES)) return KING_SPADES;
    }
    if (legal & HEARTS_MASK) return highest(legal & HEARTS_MASK);
    /* Otherwise the highest card, preferring short suits so they empty sooner. */
    int best = -1, best_score = 0;
    for (int card = 0; card < 52; ++card) {
        if (!(legal & BIT(card))) continue;
        int score = power(card) * 4 - count(hands[seat] & SUIT_MASK(suit_of(card)));
        if (suit_of(card) == 3 && power(card) < power(QUEEN_SPADES) && queen_out) score -= 30;
        if (best < 0 || score > best_score) { best = card; best_score = score; }
    }
    return best;
}

static int choose_casual(Set legal) {
    if (tricks_done && rng_below(&ai_rng, 100) < 15) {
        return nth_card(legal, (int)rng_below(&ai_rng, (uint32_t)count(legal)));
    }
    if (!trick_size) return lowest(legal);
    int winner = trick_card[current_winner_index()];
    if (legal & SUIT_MASK(suit_of(trick_card[0]))) {
        Set duck = below(legal, winner);
        return duck ? highest(duck) : lowest(legal);
    }
    if (legal & BIT(QUEEN_SPADES)) return QUEEN_SPADES;
    if (legal & HEARTS_MASK) return highest(legal & HEARTS_MASK);
    return highest(legal);
}

static int choose_play(int seat, int kind) {
    Set legal = legal_set(seat);
    if (count(legal) == 1) return lowest(legal);
    if (kind == RANDOM) return nth_card(legal, (int)rng_below(&ai_rng, (uint32_t)count(legal)));
    if (kind == CASUAL) return choose_casual(legal);
    return choose_standard(seat, legal);
}

/* ---- Flow ---- */

static void run_computers(void) {
    while (phase == PHASE_PLAY && player_kind[turn] != HUMAN) {
        play_card(turn, choose_play(turn, player_kind[turn]));
    }
}

static void begin_play(void) {
    phase = PHASE_PLAY;
    for (int seat = 0; seat < 4; ++seat) {
        if (hands[seat] & BIT(TWO_CLUBS)) turn = seat;
        shooting[seat] = is_standard(seat) && moon_worthy(hands[seat]);
    }
    run_computers();
}

static void exchange(const int human[3]) {
    int chosen[4][3];
    for (int seat = 0; seat < 4; ++seat) {
        if (player_kind[seat] == HUMAN) for (int i = 0; i < 3; ++i) chosen[seat][i] = human[i];
        else choose_pass(seat, chosen[seat]);
    }
    for (int seat = 0; seat < 4; ++seat) {
        for (int i = 0; i < 3; ++i) {
            int card = chosen[seat][i];
            hands[seat] &= ~BIT(card);
            passed_cards[seat] |= BIT(card);
        }
    }
    for (int seat = 0; seat < 4; ++seat) {
        int target = pass_target(seat);
        hands[target] |= passed_cards[seat];
        received_cards[target] = passed_cards[seat];
    }
    begin_play();
}

static void start_hand(void) {
    int deck[52];
    for (int i = 0; i < 52; ++i) deck[i] = i;
    for (int i = 51; i > 0; --i) {
        int j = (int)rng_below(&deck_rng, (uint32_t)i + 1);
        int swap = deck[i]; deck[i] = deck[j]; deck[j] = swap;
    }
    for (int seat = 0; seat < 4; ++seat) {
        hands[seat] = passed_cards[seat] = received_cards[seat] = 0;
        hand_points[seat] = 0;
        known_void[seat] = 0;
        shooting[seat] = 0;
    }
    for (int i = 0; i < 52; ++i) hands[i % 4] |= BIT(deck[i]);
    played = 0;
    hearts_broken = tricks_done = trick_size = log_count = 0;
    if (hand_number % 4 == 3) { begin_play(); return; }
    phase = PHASE_PASS;
    int any_human = 0;
    for (int seat = 0; seat < 4; ++seat) if (player_kind[seat] == HUMAN) any_human = 1;
    if (!any_human) {
        int none[3] = { 0, 0, 0 };
        exchange(none);
    }
}

/* ---- Exports ---- */

int hz_new(uint32_t seed, int difficulty) {
    if (difficulty != 0 && difficulty != 1) return 0;
    game_seed = seed;
    game_difficulty = difficulty;
    rng_seed(&deck_rng, seed, 0x4844U);  /* "HD" */
    rng_seed(&ai_rng, seed, 0x4841U);    /* "HA" */
    player_kind[0] = HUMAN;
    for (int seat = 1; seat < 4; ++seat) player_kind[seat] = difficulty ? STANDARD : CASUAL;
    for (int seat = 0; seat < 4; ++seat) scores[seat] = last_points[seat] = 0;
    history_count = hand_number = 0;
    moon_shooter = -1;
    start_hand();
    return 1;
}

/* Re-seats players and restarts the game from the same seed. Kinds:
 * 0 human, 1 random, 2 casual, 3 standard. At most seat 0 may be human. */
int hz_configure(int kind0, int kind1, int kind2, int kind3) {
    int kinds[4] = { kind0, kind1, kind2, kind3 };
    for (int seat = 0; seat < 4; ++seat) {
        if (kinds[seat] < HUMAN || kinds[seat] > STANDARD || (seat && kinds[seat] == HUMAN)) return 0;
    }
    rng_seed(&deck_rng, game_seed, 0x4844U);
    rng_seed(&ai_rng, game_seed, 0x4841U);
    for (int seat = 0; seat < 4; ++seat) { player_kind[seat] = kinds[seat]; scores[seat] = last_points[seat] = 0; }
    history_count = hand_number = 0;
    moon_shooter = -1;
    start_hand();
    return 1;
}

int hz_pass(int a, int b, int c) {
    if (phase != PHASE_PASS || player_kind[0] != HUMAN) return 0;
    int cards[3] = { a, b, c };
    for (int i = 0; i < 3; ++i) {
        if (cards[i] < 0 || cards[i] > 51 || !(hands[0] & BIT(cards[i]))) return 0;
        for (int j = 0; j < i; ++j) if (cards[j] == cards[i]) return 0;
    }
    exchange(cards);
    return 1;
}

int hz_can_play(int card) {
    if (phase != PHASE_PLAY || turn != 0 || player_kind[0] != HUMAN || card < 0 || card > 51) return 0;
    return (legal_set(0) & BIT(card)) != 0;
}

int hz_play(int card) {
    if (!hz_can_play(card)) return 0;
    play_card(0, card);
    run_computers();
    return 1;
}

int hz_next_hand(void) {
    if (phase != PHASE_HAND_OVER) return 0;
    ++hand_number;
    start_hand();
    return 1;
}

/* Hints use the standard player's judgement for seat 0. They never touch the
 * random streams, so asking for a hint does not change the game. */
int hz_hint_play(void) {
    if (phase != PHASE_PLAY || turn != 0) return -1;
    return choose_play(0, STANDARD);
}

int hz_hint_pass(int index) {
    if (phase != PHASE_PASS || index < 0 || index > 2) return -1;
    if (index == 0) {
        int kind = player_kind[0];
        player_kind[0] = STANDARD;
        choose_pass(0, hint_cards);
        player_kind[0] = kind;
    }
    return hint_cards[index];
}

uint32_t hz_seed(void) { return game_seed; }
int hz_difficulty(void) { return game_difficulty; }
int hz_player(int seat) { return seat >= 0 && seat < 4 ? player_kind[seat] : -1; }
int hz_phase(void) { return phase; }
int hz_hand_number(void) { return hand_number; }
int hz_pass_direction(void) { return hand_number % 4; } /* 0 left, 1 right, 2 across, 3 hold */
int hz_turn(void) { return phase == PHASE_PLAY ? turn : -1; }
int hz_hearts_broken(void) { return hearts_broken; }
int hz_tricks_done(void) { return tricks_done; }
int hz_holds(int seat, int card) {
    return seat >= 0 && seat < 4 && card >= 0 && card < 52 && (hands[seat] & BIT(card)) != 0;
}
int hz_hand_size(int seat) { return seat >= 0 && seat < 4 ? count(hands[seat]) : -1; }
int hz_passed(int seat, int card) {
    return seat >= 0 && seat < 4 && card >= 0 && card < 52 && (passed_cards[seat] & BIT(card)) != 0;
}
int hz_received(int seat, int card) {
    return seat >= 0 && seat < 4 && card >= 0 && card < 52 && (received_cards[seat] & BIT(card)) != 0;
}
int hz_score(int seat) { return seat >= 0 && seat < 4 ? scores[seat] : -1; }
int hz_hand_points(int seat) { return seat >= 0 && seat < 4 ? hand_points[seat] : -1; }
int hz_last_points(int seat) { return seat >= 0 && seat < 4 ? last_points[seat] : -1; }
int hz_moon(void) { return moon_shooter; }
int hz_log_count(void) { return log_count; }
int hz_log_card(int index) { return index >= 0 && index < log_count ? log_card[index] : -1; }
int hz_log_seat(int index) { return index >= 0 && index < log_count ? log_seat[index] : -1; }
int hz_trick_winner(int trick) { return trick >= 0 && trick < tricks_done ? trick_winner[trick] : -1; }
int hz_trick_points(int trick) { return trick >= 0 && trick < tricks_done ? trick_points_taken[trick] : -1; }
int hz_history_count(void) { return history_count; }
int hz_history(int hand, int seat) {
    return hand >= 0 && hand < history_count && seat >= 0 && seat < 4 ? history[hand][seat] : -1;
}
