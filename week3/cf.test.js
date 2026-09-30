// Small test for cf.js. Run it with:  node cf.test.js
// It also runs by pasting both files into a browser console, or by
// concatenating them into one script for a plain JavaScript engine.

const cf = (typeof require !== 'undefined' && typeof module !== 'undefined')
    ? require('./cf.js')
    : {
        MIN_COMMON,
        MAX_NEIGHBORS,
        buildLookups,
        initCollaborativeFiltering,
        ratingsByUser,
        ratingsByMovie,
        userMean,
        globalMean,
        clipRating,
        coRatedEntries,
        userSimilarity,
        itemSimilarity,
        predictUserBased,
        predictItemBased
    };

// The fixture from the design notes. (u1, m3) and (u3, m4) are deliberately
// absent, so nothing in the test can accidentally treat a blank as a zero.
const FIXTURE = [
    { userId: 1, movieId: 1, rating: 5 },
    { userId: 1, movieId: 2, rating: 4 },
    { userId: 1, movieId: 4, rating: 2 },
    { userId: 2, movieId: 1, rating: 4 },
    { userId: 2, movieId: 2, rating: 4 },
    { userId: 2, movieId: 3, rating: 4 },
    { userId: 2, movieId: 4, rating: 1 },
    { userId: 3, movieId: 1, rating: 1 },
    { userId: 3, movieId: 2, rating: 2 },
    { userId: 3, movieId: 3, rating: 5 }
];

// Closed forms worked out by hand. The dot product is 38 in both cases,
// but the two norms are NOT the same, so the two similarities differ.
//
//   users (u1,u2) over common movies m1,m2,m4
//     vectors (5,4,2) and (4,4,1); dot 5*4+4*4+2*1 = 38
//     norms 25+16+4 = 45 and 16+16+1 = 33   -> 38 / sqrt(1485) = 0.98610
//
//   movies (m1,m2) over common users u1,u2,u3
//     vectors (5,4,1) and (4,4,2); dot 5*4+4*4+1*2 = 38
//     norms 25+16+1 = 42 and 16+16+4 = 36   -> 38 / sqrt(1512) = 0.97725
const EXPECTED_USER = 38 / Math.sqrt(1485);
const EXPECTED_ITEM = 38 / Math.sqrt(1512);

// (u1, m3) worked out by hand.
//   user-based: m3 was rated by u2 (4) and u3 (5). sim(u1,u3) is null (only
//   2 common movies), so u2 is the only neighbor. With one neighbor the
//   weight cancels, leaving mu_u1 + (4 - mu_u2) = 11/3 + 3/4 = 53/12.
//   item-based: m3 shares only 2 users with m1, 2 with m2, 1 with m4, so
//   nothing clears MIN_COMMON and the prediction falls back to mu_u1.
const EXPECTED_U1_M3_USER_BASED = 53 / 12;
const EXPECTED_U1_M3_ITEM_BASED = 11 / 3;
const EXPECTED_GLOBAL_MEAN = 32 / 10;

// Gives m3 at least three co-rating users so item-based has real neighbors.
// u1 rates both m1 and m2 a 4, so the weighted average is exactly 4 whatever
// the two similarity weights turn out to be.
const ITEM_FIXTURE = [
    { userId: 1, movieId: 1, rating: 4 },
    { userId: 1, movieId: 2, rating: 4 },
    { userId: 2, movieId: 1, rating: 4 },
    { userId: 2, movieId: 2, rating: 4 },
    { userId: 2, movieId: 3, rating: 5 },
    { userId: 3, movieId: 1, rating: 1 },
    { userId: 3, movieId: 2, rating: 2 },
    { userId: 3, movieId: 3, rating: 5 },
    { userId: 4, movieId: 1, rating: 2 },
    { userId: 4, movieId: 2, rating: 1 },
    { userId: 4, movieId: 3, rating: 4 }
];

// Enough aligned users to overflow the 30-neighbor cap.
const CROWD_FIXTURE = [{ userId: 1, movieId: 1, rating: 5 },
    { userId: 1, movieId: 2, rating: 4 },
    { userId: 1, movieId: 4, rating: 2 }];
for (let i = 1; i <= 35; i++) {
    CROWD_FIXTURE.push({ userId: i + 1, movieId: 1, rating: 5 });
    CROWD_FIXTURE.push({ userId: i + 1, movieId: 2, rating: 4 });
    CROWD_FIXTURE.push({ userId: i + 1, movieId: 4, rating: 2 });
    CROWD_FIXTURE.push({ userId: i + 1, movieId: 3, rating: 4 });
}

// A pair built so the FIRST Map is the larger one and the two ratings on
// every shared key differ, which is what exposes an ordering swap.
const ORDER_FIXTURE = [
    { userId: 4, movieId: 1, rating: 5 },
    { userId: 4, movieId: 2, rating: 4 },
    { userId: 4, movieId: 4, rating: 2 },
    { userId: 4, movieId: 5, rating: 1 },
    { userId: 5, movieId: 1, rating: 1 },
    { userId: 5, movieId: 2, rating: 2 },
    { userId: 5, movieId: 4, rating: 5 }
];

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
    const ok = typeof expected === 'number'
        ? typeof actual === 'number' && Math.abs(actual - expected) < 1e-12
        : actual === expected;
    if (ok) {
        passed++;
        console.log(`  pass  ${name} = ${actual === null ? 'no similarity' : actual}`);
    } else {
        failed++;
        console.log(`  FAIL  ${name} = ${actual}, expected ${expected === null ? 'no similarity' : expected}`);
    }
}

function checkTriples(name, actual, expected) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson === expectedJson) {
        passed++;
        console.log(`  pass  ${name} = ${actualJson}`);
    } else {
        failed++;
        console.log(`  FAIL  ${name} = ${actualJson}, expected ${expectedJson}`);
    }
}

// Asserts one field of a prediction result.
function checkField(name, actual, expected) {
    const ok = typeof expected === 'number'
        ? typeof actual === 'number' && Math.abs(actual - expected) < 1e-12
        : actual === expected;
    if (ok) {
        passed++;
        console.log(`  pass  ${name} = ${actual === null ? 'null' : actual}`);
    } else {
        failed++;
        console.log(`  FAIL  ${name} = ${actual}, expected ${expected}`);
    }
}

function runCfTests() {
    cf.initCollaborativeFiltering(FIXTURE);

    console.log('cf.js co-rated cosine similarity\n');

    console.log('lookups keep missing ratings absent, not zero:');
    const u1 = cf.ratingsByUser(1);
    const m3 = cf.ratingsByMovie(3);
    check('u1 rating count', u1.size, 3);
    check('u1 has no m3 entry', u1.has(3), false);
    check('m3 rating count', m3.size, 2);
    check('m3 has no u1 entry', m3.has(1), false);

    console.log('\nco-rated cosine over 3 shared observations:');
    check('userSimilarity(u1, u2)', cf.userSimilarity(1, 2), EXPECTED_USER);
    check('itemSimilarity(m1, m2)', cf.itemSimilarity(1, 2), EXPECTED_ITEM);

    console.log('\nunderlap below MIN_COMMON = 3:');
    check('userSimilarity(u1, u3) [2 common movies]', cf.userSimilarity(1, 3), null);
    check('itemSimilarity(m3, m1) [2 common users]', cf.itemSimilarity(3, 1), null);

    console.log('\nsymmetry and unknown ids:');
    check('userSimilarity(u2, u1) matches u1, u2', cf.userSimilarity(2, 1), EXPECTED_USER);
    check('itemSimilarity(m2, m1) matches m1, m2', cf.itemSimilarity(2, 1), EXPECTED_ITEM);
    check('userSimilarity(u1, unknown)', cf.userSimilarity(1, 99), null);
    check('itemSimilarity(m1, unknown)', cf.itemSimilarity(1, 99), null);

    console.log('\ntriple order survives a larger first Map:');
    cf.initCollaborativeFiltering(ORDER_FIXTURE);
    // u4 has 4 ratings, u5 has 3, so the loop walks u5 but the triples must
    // still read [movieId, ratingFromFirstArg, ratingFromSecondArg].
    checkTriples('coRatedEntries(u4, u5) [u4 is larger]', cf.coRatedEntries(cf.ratingsByUser(4), cf.ratingsByUser(5)), [
        [1, 5, 1],
        [2, 4, 2],
        [4, 2, 5]
    ]);
    checkTriples('coRatedEntries(u5, u4) [u5 is smaller]', cf.coRatedEntries(cf.ratingsByUser(5), cf.ratingsByUser(4)), [
        [1, 1, 5],
        [2, 2, 4],
        [4, 5, 2]
    ]);
    check('userSimilarity stays symmetric after the fix', cf.userSimilarity(4, 5), cf.userSimilarity(5, 4));

    console.log('\nuser-based prediction for (u1, m3):');
    cf.initCollaborativeFiltering(FIXTURE);
    const ub = cf.predictUserBased(1, 3);
    checkField('user-based rating', ub.rating, EXPECTED_U1_M3_USER_BASED);
    checkField('user-based method', ub.method, 'user-based');
    checkField('user-based neighbors', ub.neighbors, 1);
    checkField('user-based fallback', ub.fallback, false);
    checkField('user-based fallbackReason', ub.fallbackReason, null);

    console.log('\nitem-based prediction for (u1, m3):');
    const ib = cf.predictItemBased(1, 3);
    checkField('item-based rating', ib.rating, EXPECTED_U1_M3_ITEM_BASED);
    checkField('item-based method', ib.method, 'item-based');
    checkField('item-based neighbors', ib.neighbors, 0);
    checkField('item-based fallback', ib.fallback, true);
    checkField('item-based label mentions mean fallback',
        /mean fallback/.test(ib.fallbackReason) && !/global mean/.test(ib.fallbackReason), true);

    console.log('\nitem-based with real neighbors (u1, m3) on ITEM_FIXTURE:');
    cf.initCollaborativeFiltering(ITEM_FIXTURE);
    const ibReal = cf.predictItemBased(1, 3);
    checkField('item-based rating', ibReal.rating, 4);
    checkField('item-based neighbors', ibReal.neighbors, 2);
    checkField('item-based fallback', ibReal.fallback, false);

    console.log('\nuser with no ratings falls back to the global mean:');
    cf.initCollaborativeFiltering(FIXTURE);
    const ubNew = cf.predictUserBased(99, 3);
    const ibNew = cf.predictItemBased(99, 3);
    checkField('user-based new user rating', ubNew.rating, EXPECTED_GLOBAL_MEAN);
    checkField('user-based new user neighbors', ubNew.neighbors, 0);
    checkField('user-based new user fallback', ubNew.fallback, true);
    checkField('user-based label mentions global mean', /global mean/.test(ubNew.fallbackReason), true);
    checkField('item-based new user rating', ibNew.rating, EXPECTED_GLOBAL_MEAN);
    checkField('item-based new user neighbors', ibNew.neighbors, 0);
    checkField('item-based new user fallback', ibNew.fallback, true);
    checkField('item-based label mentions global mean', /global mean/.test(ibNew.fallbackReason), true);

    console.log('\nneighbor cap:');
    cf.initCollaborativeFiltering(CROWD_FIXTURE);
    checkField('at most MAX_NEIGHBORS are used', cf.predictUserBased(1, 3).neighbors, cf.MAX_NEIGHBORS);
    checkField('35 aligned candidates were available', cf.ratingsByMovie(3).size, 35);

    console.log('\nevery prediction is finite and inside [1, 5]:');
    let outOfRange = 0;
    let sawFallback = 0;
    let worst = null;
    for (const ratingList of [FIXTURE, ITEM_FIXTURE, CROWD_FIXTURE]) {
        cf.initCollaborativeFiltering(ratingList);
        const userIds = [...new Set(ratingList.map(r => r.userId))];
        const movieIds = [...new Set(ratingList.map(r => r.movieId))];
        for (const userId of [...userIds, 99]) {
            for (const movieId of movieIds) {
                for (const result of [cf.predictUserBased(userId, movieId), cf.predictItemBased(userId, movieId)]) {
                    if (!Number.isFinite(result.rating) || result.rating < 1 || result.rating > 5) outOfRange++;
                    if (result.fallback) sawFallback++;
                    if (worst === null || result.rating < worst) worst = result.rating;
                    if (result.fallback && !result.fallbackReason) outOfRange++;
                }
            }
        }
    }
    checkField('out-of-range or unlabeled results', outOfRange, 0);
    console.log(`        (lowest prediction seen: ${worst.toFixed(3)}, ${sawFallback} of these used a labeled fallback)`);

    console.log('\nzero denominator is reported as no similarity:');
    cf.initCollaborativeFiltering(FIXTURE.concat([
        { userId: 9, movieId: 1, rating: 0 },
        { userId: 9, movieId: 2, rating: 0 },
        { userId: 9, movieId: 4, rating: 0 }
    ]));
    check('userSimilarity(u1, u9) [all-zero profile]', cf.userSimilarity(1, 9), null);

    console.log(`\n${passed} passed, ${failed} failed`);
    return failed;
}

const failures = runCfTests();

if (typeof process !== 'undefined') {
    process.exit(failures === 0 ? 0 : 1);
}
