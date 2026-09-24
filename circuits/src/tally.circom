pragma circom 2.1.5;

include "ballot.circom";

/*
 * The decryption of a Votain tally, checked on chain.
 *
 * The election adds every ballot, votes and cancellations, into one aggregate
 * as they arrive (ElectionV4 keeps it). Because each re-vote cancels the one
 * before, that aggregate encrypts each voter's LAST vote, and decrypting it
 * gives the counts. This proves the decryption:
 *
 *   H_i = x_i·G            the organizer holds the keys the ballots used
 *   B_i = count_i·G + x_i·A  and the aggregate decrypts to these counts
 *
 * so a result reaches the chain only if it is what the ballots say.
 *
 * TWO MODES, for the privacy quorum. Publishing (`publish = 1`) reveals the
 * counts. Voiding (`publish = 0`) reveals only how many voted, proves that is
 * below the quorum, and outputs zero counts: an election too small to publish
 * can end without its handful of votes ever being disclosed.
 */
template Tally(SLOTS) {
    // ── public ──────────────────────────────────────────────────────────────
    signal input keysHash;
    signal input slots;
    signal input aggA[2];
    signal input aggB[SLOTS][2];
    signal input quorum;
    signal input publish;

    signal output counts[SLOTS];
    signal output voters;

    // ── private ─────────────────────────────────────────────────────────────
    signal input secrets[SLOTS];
    signal input count[SLOTS];

    publish * (1 - publish) === 0;
    component slotsRange = Num2Bits(8);
    slotsRange.in <== slots;

    signal keys[SLOTS][2];
    signal xG[SLOTS][2];
    signal xA[SLOTS][2];
    signal mG[SLOTS][2];
    signal inUse[SLOTS];
    signal countBits[SLOTS][32];
    var total = 0;
    for (var i = 0; i < SLOTS; i++) {
        inUse[i] <== LessThan(8)([i, slots]);

        // The key of a slot in use is x·G; an unused slot's key is the identity,
        // exactly as the ballots hashed it.
        CheckScalar()(secrets[i]);
        xG[i] <== MulBase()(secrets[i]);
        keys[i][0] <== inUse[i] * xG[i][0];
        keys[i][1] <== 1 + inUse[i] * (xG[i][1] - 1);

        // Counts are small, and zero where there is no option.
        countBits[i] <== Num2Bits(32)(count[i]);
        count[i] * (1 - inUse[i]) === 0;
        total += count[i];

        // count·G, built from bits so a zero count is the identity.
        mG[i] <== SmallMulBase(32)(count[i]);

        // B = count·G + x·A.
        xA[i] <== MulAny()(secrets[i], aggA);
        var bx, by;
        (bx, by) = BabyAdd()(mG[i][0], mG[i][1], xA[i][0], xA[i][1]);
        (aggB[i][0] - bx) * inUse[i] === 0;
        (aggB[i][1] - by) * inUse[i] === 0;

        counts[i] <== publish * count[i];
    }

    signal computedKeysHash <== HashPoints(SLOTS)(0, keys);
    computedKeysHash === keysHash;

    voters <== total;

    // Voiding is only for an election below its quorum.
    signal below <== LessThan(32)([total, quorum]);
    (1 - publish) * (1 - below) === 0;
}

/// k·G for a small k, by double-and-add over its bits: exact for k = 0.
template SmallMulBase(BITS) {
    signal input k;
    signal output out[2];
    var G[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    component bits = Num2Bits(BITS);
    bits.in <== k;
    // acc_{j+1} = acc_j + bit_j · (2^j·G), with 2^j·G precomputed as constants.
    signal acc[BITS + 1][2];
    signal termX[BITS];
    signal termY[BITS];
    acc[0] <== [0, 1];
    var P[2] = G;
    for (var j = 0; j < BITS; j++) {
        termX[j] <== bits.out[j] * P[0];
        termY[j] <== 1 + bits.out[j] * (P[1] - 1);
        var ax, ay;
        (ax, ay) = BabyAdd()(acc[j][0], acc[j][1], termX[j], termY[j]);
        acc[j + 1] <== [ax, ay];
        P = babyDouble(P);
    }
    out <== acc[BITS];
}

/// Doubling of a constant point, evaluated at compile time.
function babyDouble(p) {
    var a = 168700;
    var d = 168696;
    var x = p[0];
    var y = p[1];
    var denX = 1 + d * x * x * y * y;
    var denY = 1 - d * x * x * y * y;
    var nx = (2 * x * y) / denX;
    var ny = (y * y - a * x * x) / denY;
    return [nx, ny];
}
