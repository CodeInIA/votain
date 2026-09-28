pragma circom 2.1.5;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/escalarmulfix.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-kit/binary-merkle-root.circom/src/binary-merkle-root.circom";

/*
 * A Votain ballot whose re-votes nobody can see.
 *
 * WHAT IT REPLACES. A ballot used to carry the voter's Semaphore nullifier and
 * a nonce, both public. Only the last ballot per nullifier counted, which is
 * the coercion defence, but anybody who learned a voter's nullifier could see
 * THAT they had voted again. A coercer only needs that much.
 *
 * WHAT A BALLOT IS NOW. An exponential ElGamal encryption of a one-hot vote,
 * over Baby Jubjub, with one tally key per option and one shared randomness:
 *   A = r·G,   B_i = v_i·G + r·H_i
 * plus a CANCELLATION of the voter's previous ballot, re-randomised:
 *   A' = -A_prev + s·G,   B'_i = -B_prev_i + s·H_i
 * (an encryption of zero when there is no previous ballot). Summing EVERY
 * ballot, votes and cancellations alike, telescopes each voter's chain down to
 * their last vote, so the tally needs no deduplication and nothing public says
 * which ballots belong together.
 *
 * WHAT THE PROOF SAYS, without revealing which voter or which previous ballot:
 *   - the voter is in the election's roll (Semaphore identity, members tree);
 *   - the vote is exactly one of the election's options;
 *   - `tag` = Poseidon(TAG, secret, scope, k) for a private counter k, so each
 *     step of a voter's chain can be cast once and nothing links the steps;
 *   - for k > 0, the cancelled ballot is the one this voter cast at step k-1,
 *     proved by membership in the ballots tree rather than by pointing at it;
 *   - `epochTag` = Poseidon(EPOCH, secret, scope, epoch), so one voter can cast
 *     at most one ballot per epoch, which bounds how fast anyone can spend the
 *     organizer's gas, without linking a voter's ballots across epochs;
 *   - `leaf` is this ballot's entry in the ballots tree, for the next step.
 *
 * A first ballot and a re-vote are indistinguishable: both carry a vote and a
 * cancellation, and only the voter knows whether the cancellation is of zero.
 */

// Domain separators, so a tag can never collide with an epoch tag or a leaf.
function TAG_DOMAIN() { return 1953718116; }   // "tagd"
function EPOCH_DOMAIN() { return 1701867371; } // "epok"

// Order of the prime subgroup of Baby Jubjub.
function SUBGROUP_ORDER() {
    return 2736030358979909402780800718157159386076813972158567259200215660948447373041;
}

/// A scalar in [1, l): Semaphore's own range check, and non-zero, because the
/// variable-base multiplier is only guaranteed for a non-zero scalar.
template CheckScalar() {
    signal input in;
    component lt = LessThan(251);
    lt.in <== [in, SUBGROUP_ORDER()];
    lt.out === 1;
    component zero = IsZero();
    zero.in <== in;
    zero.out === 0;
}

/// scalar · P for an arbitrary point P (the identity included).
template MulAny() {
    signal input scalar;
    signal input p[2];
    signal output out[2];
    component bits = Num2Bits(253);
    bits.in <== scalar;
    component mul = EscalarMulAny(253);
    mul.e <== bits.out;
    mul.p <== p;
    out <== mul.out;
}

/// scalar · G for the Baby Jubjub base point Base8.
template MulBase() {
    signal input scalar;
    signal output out[2];
    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    component bits = Num2Bits(253);
    bits.in <== scalar;
    component mul = EscalarMulFix(253, BASE8);
    mul.e <== bits.out;
    out <== mul.out;
}

/// Poseidon chain over a point list, seeded with `seed`.
template HashPoints(N) {
    signal input seed;
    signal input points[N][2];
    signal output out;
    signal h[N + 1];
    h[0] <== seed;
    for (var i = 0; i < N; i++) {
        h[i + 1] <== Poseidon(3)([h[i], points[i][0], points[i][1]]);
    }
    out <== h[N];
}

/// The ballots-tree leaf of a vote: Poseidon chain over (tag, A, B_0..B_n).
template BallotLeaf(SLOTS) {
    signal input tag;
    signal input a[2];
    signal input b[SLOTS][2];
    signal output out;
    signal head <== Poseidon(3)([tag, a[0], a[1]]);
    out <== HashPoints(SLOTS)(head, b);
}

template Ballot(SLOTS, MAX_DEPTH) {
    // ── public ──────────────────────────────────────────────────────────────
    signal input votersRoot;
    signal input ballotsRoot;
    signal input scope;
    signal input keysHash;
    signal input slots;
    signal input epoch;
    signal input voteA[2];
    signal input voteB[SLOTS][2];
    signal input cancelA[2];
    signal input cancelB[SLOTS][2];

    signal output tag;
    signal output epochTag;
    signal output leaf;

    // ── private ─────────────────────────────────────────────────────────────
    signal input secret;
    signal input votersDepth, votersIndex, votersSiblings[MAX_DEPTH];
    signal input keys[SLOTS][2];
    signal input choice[SLOTS];
    signal input r;
    signal input s;
    signal input k;
    signal input prevA[2];
    signal input prevB[SLOTS][2];
    signal input ballotsDepth, ballotsIndex, ballotsSiblings[MAX_DEPTH];

    var G[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];

    // 1. The voter is on the roll, exactly as Semaphore V4 proves it.
    CheckScalar()(secret);
    var Ax, Ay;
    (Ax, Ay) = BabyPbk()(secret);
    signal commitment <== Poseidon(2)([Ax, Ay]);
    signal computedVotersRoot <== BinaryMerkleRoot(MAX_DEPTH)(commitment, votersDepth, votersIndex, votersSiblings);
    computedVotersRoot === votersRoot;

    // 2. The keys are the election's.
    signal computedKeysHash <== HashPoints(SLOTS)(0, keys);
    computedKeysHash === keysHash;

    // 3. Exactly one option, and only among the options this election has.
    component slotsRange = Num2Bits(8);
    slotsRange.in <== slots;
    signal inUse[SLOTS];
    var total = 0;
    for (var i = 0; i < SLOTS; i++) {
        choice[i] * (choice[i] - 1) === 0;
        inUse[i] <== LessThan(8)([i, slots]);
        choice[i] * (1 - inUse[i]) === 0;
        total += choice[i];
    }
    total === 1;

    // 4. The vote: A = r·G, B_i = v_i·G + r·H_i.
    CheckScalar()(r);
    signal rG[2] <== MulBase()(r);
    voteA[0] === rG[0];
    voteA[1] === rG[1];
    signal rH[SLOTS][2];
    signal vGx[SLOTS];
    signal vGy[SLOTS];
    for (var i = 0; i < SLOTS; i++) {
        rH[i] <== MulAny()(r, keys[i]);
        // v·G for a bit v: G itself, or the identity (0, 1).
        vGx[i] <== choice[i] * G[0];
        vGy[i] <== 1 + choice[i] * (G[1] - 1);
        var bx, by;
        (bx, by) = BabyAdd()(vGx[i], vGy[i], rH[i][0], rH[i][1]);
        voteB[i][0] === bx;
        voteB[i][1] === by;
    }

    // 5. The tags.
    tag <== Poseidon(4)([TAG_DOMAIN(), secret, scope, k]);
    epochTag <== Poseidon(4)([EPOCH_DOMAIN(), secret, scope, epoch]);
    leaf <== BallotLeaf(SLOTS)(tag, voteA, voteB);

    // 6. The previous ballot. At k = 0 there is none: it must be the identity
    //    everywhere and no tree membership is asked for. Otherwise it is the
    //    ballot this voter cast at step k-1, found in the ballots tree.
    component bits = Num2Bits(32);
    bits.in <== k;
    signal isFirst <== IsZero()(k);
    signal prevTag <== Poseidon(4)([TAG_DOMAIN(), secret, scope, k - 1]);
    signal prevLeaf <== BallotLeaf(SLOTS)(prevTag, prevA, prevB);
    signal computedBallotsRoot <== BinaryMerkleRoot(MAX_DEPTH)(prevLeaf, ballotsDepth, ballotsIndex, ballotsSiblings);
    (computedBallotsRoot - ballotsRoot) * (1 - isFirst) === 0;
    prevA[0] * isFirst === 0;
    (prevA[1] - 1) * isFirst === 0;
    for (var i = 0; i < SLOTS; i++) {
        prevB[i][0] * isFirst === 0;
        (prevB[i][1] - 1) * isFirst === 0;
    }

    // 7. The cancellation: -prev, re-randomised so it points at nothing.
    CheckScalar()(s);
    signal sG[2] <== MulBase()(s);
    var cax, cay;
    (cax, cay) = BabyAdd()(-prevA[0], prevA[1], sG[0], sG[1]);
    cancelA[0] === cax;
    cancelA[1] === cay;
    signal sH[SLOTS][2];
    for (var i = 0; i < SLOTS; i++) {
        sH[i] <== MulAny()(s, keys[i]);
        var cbx, cby;
        (cbx, cby) = BabyAdd()(-prevB[i][0], prevB[i][1], sH[i][0], sH[i][1]);
        cancelB[i][0] === cbx;
        cancelB[i][1] === cby;
    }
}
