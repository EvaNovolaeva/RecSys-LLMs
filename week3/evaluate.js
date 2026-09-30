// Held-out evaluation of the user-based and item-based CF predictors in
// cf.js. Run standalone; not loaded by index.html.
//
// Ground truth is only ever real observed ratings. The split is produced by a
// seeded PRNG so the run is reproducible, and the CF lookup tables are built
// from TRAIN ratings alone -- a held-out rating is never visible to a
// similarity, a user mean, or the global mean. The one thing a held-out
// rating touches is the error arithmetic, and assertNoLeak() below checks
// that claim rather than assuming it.

// Reproducible PRNG (mulberry32). Math.random() is never used.
function mulberry32(seed) {
    let state = seed | 0;
    return function next() {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const DEFAULTS = {
    splitSeed: 42,
    sampleSeed: 4242,
    holdoutFraction: 0.2,
    minRatingsPerUser: 5,
    sampleLimit: 2000
};

// Fisher-Yates using the supplied PRNG, so order is determined by the seed.
function shuffleInPlace(items, random) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const swap = items[i];
        items[i] = items[j];
        items[j] = swap;
    }
    return items;
}

// Per-user holdout: each user's own observed ratings are shuffled and the
// first holdoutFraction of them move to test. Per-user rather than global, so
// heavy raters cannot dominate the metric. No invented ratings: only pairs
// that appear in the input data ever enter either list.
function splitRatings(ratings, options) {
    const settings = Object.assign({}, DEFAULTS, options);
    const random = mulberry32(settings.splitSeed);

    const byUser = new Map();
    for (const entry of ratings) {
        if (!byUser.has(entry.userId)) byUser.set(entry.userId, []);
        byUser.get(entry.userId).push(entry);
    }

    const train = [];
    const test = [];
    const skipped = [];

    const userIds = Array.from(byUser.keys()).sort((a, b) => a - b);
    for (const userId of userIds) {
        const userRatings = byUser.get(userId);
        if (userRatings.length < settings.minRatingsPerUser) {
            skipped.push({ userId, count: userRatings.length });
            for (const entry of userRatings) train.push(entry);
            continue;
        }
        shuffleInPlace(userRatings, random);
        const heldCount = Math.max(1, Math.round(userRatings.length * settings.holdoutFraction));
        for (let i = 0; i < userRatings.length; i++) {
            (i < heldCount ? test : train).push(userRatings[i]);
        }
    }

    return { train, test, skipped, settings };
}

// A bounded sample of the held-out ratings, so the run finishes on a laptop.
// Shuffled with its own seed, then truncated. Both methods score exactly this
// same list, so their numbers are directly comparable.
function sampleHeldOut(testRatings, options) {
    const settings = Object.assign({}, DEFAULTS, options);
    const shuffled = shuffleInPlace(testRatings.slice(), mulberry32(settings.sampleSeed));
    return shuffled.slice(0, Math.min(settings.sampleLimit, shuffled.length));
}

// Guards the central claim: no sampled pair may be readable in the tables the
// predictors consult. If this ever reports a violation, the numbers below are
// measured on training data and mean nothing.
function assertNoLeak(sample) {
    const violations = [];
    for (const pair of sample) {
        const userRatings = ratingsByUser(pair.userId);
        if (userRatings && userRatings.get(pair.movieId) !== undefined) {
            violations.push(pair);
        }
    }
    return violations;
}

// MAE, RMSE and the fallback tally over one predictor on one fixed sample.
function scoreMethod(sample, predict) {
    const started = Date.now();
    let absoluteError = 0;
    let squaredError = 0;
    let fallbacks = 0;
    let neighborsUsed = 0;
    const worst = [];

    for (const pair of sample) {
        const result = predict(pair.userId, pair.movieId);
        const error = result.rating - pair.rating;
        absoluteError += Math.abs(error);
        squaredError += error * error;
        if (result.fallback) {
            fallbacks++;
        } else {
            neighborsUsed += result.neighbors;
        }
        worst.push({ userId: pair.userId, movieId: pair.movieId, predicted: result.rating, actual: pair.rating, error: error });
    }

    const elapsedMs = Date.now() - started;
    const n = sample.length;
    worst.sort((a, b) => Math.abs(b.error) - Math.abs(a.error));

    return {
        n,
        mae: absoluteError / n,
        rmse: Math.sqrt(squaredError / n),
        fallbacks,
        fallbackPercent: (fallbacks / n) * 100,
        meanNeighbors: fallbacks === n ? null : neighborsUsed / (n - fallbacks),
        elapsedMs,
        worst: worst.slice(0, 5)
    };
}

// Global-mean baseline, taken from the TRAIN-only lookups, scored on the same
// sample. It is a mean predictor by construction, so it has no fallback rate.
function scoreGlobalMeanBaseline(sample) {
    const started = Date.now();
    const mean = globalMean();
    let absoluteError = 0;
    let squaredError = 0;
    for (const pair of sample) {
        const error = mean - pair.rating;
        absoluteError += Math.abs(error);
        squaredError += error * error;
    }
    const n = sample.length;
    return {
        n,
        mae: absoluteError / n,
        rmse: Math.sqrt(squaredError / n),
        globalMean: mean,
        elapsedMs: Date.now() - started
    };
}

function runEvaluation(allRatings, options) {
    const report = {};
    const wallStart = Date.now();

    const splitStarted = Date.now();
    const split = splitRatings(allRatings, options);
    const splitMs = Date.now() - splitStarted;

    // The only call that configures cf.js. TRAIN ratings only.
    const lookupStarted = Date.now();
    initCollaborativeFiltering(split.train);
    const lookupMs = Date.now() - lookupStarted;

    const sample = sampleHeldOut(split.test, options);
    const leaks = assertNoLeak(sample);

    const userBased = scoreMethod(sample, predictUserBased);
    const itemBased = scoreMethod(sample, predictItemBased);
    const baseline = scoreGlobalMeanBaseline(sample);

    report.settings = split.settings;
    report.splitRule = 'per user: shuffle each user\'s observed ratings with mulberry32(splitSeed), '
        + 'move the first round(n * holdoutFraction) to test, rest to train';
    report.seedNote = 'splitSeed drives the split, sampleSeed drives the bounded test sample; both fixed';
    report.observedRatings = allRatings.length;
    report.trainCount = split.train.length;
    report.testCount = split.test.length;
    report.sampleSize = sample.length;
    report.usersSplit = new Set(allRatings.map(r => r.userId)).size - split.skipped.length;
    report.skippedUsers = split.skipped;
    report.trainGlobalMean = globalMean();
    report.leakViolations = leaks.length;
    report.leakExamples = leaks.slice(0, 5);
    report.userBased = userBased;
    report.itemBased = itemBased;
    report.baseline = baseline;
    report.timing = {
        splitMs,
        lookupMs,
        userBasedMs: userBased.elapsedMs,
        itemBasedMs: itemBased.elapsedMs,
        baselineMs: baseline.elapsedMs,
        totalMs: Date.now() - wallStart
    };
    return report;
}

function printEvaluation(report) {
    const pad = (text, width) => String(text).padEnd(width);
    const num = (value, digits) => value === null ? 'n/a' : value.toFixed(digits);

    console.log('='.repeat(74));
    console.log('CF EVALUATION - user-based vs item-based, held-out observed ratings');
    console.log('='.repeat(74));
    console.log('split seed        : ' + report.settings.splitSeed);
    console.log('sample seed       : ' + report.settings.sampleSeed);
    console.log('split rule        : ' + report.splitRule);
    console.log('holdout fraction  : ' + report.settings.holdoutFraction);
    console.log('min ratings/user  : ' + report.settings.minRatingsPerUser);
    console.log('');
    console.log('observed ratings  : ' + report.observedRatings);
    console.log('train ratings     : ' + report.trainCount + '   (lookups and all means built from these only)');
    console.log('test ratings      : ' + report.testCount);
    console.log('evaluated sample  : ' + report.sampleSize + ' held-out pairs, identical for every row below');
    console.log('users split       : ' + report.usersSplit);
    console.log('skipped users     : ' + report.skippedUsers.length
        + (report.skippedUsers.length ? ' -> ' + JSON.stringify(report.skippedUsers) : ' (none: every user has >= '
            + report.settings.minRatingsPerUser + ' ratings)'));
    console.log('train global mean : ' + report.trainGlobalMean.toFixed(6));
    console.log('leak violations   : ' + report.leakViolations
        + ' (sampled pairs visible in the CF tables; 0 means the split is clean)');
    console.log('');

    console.log(pad('METHOD', 22) + pad('N', 7) + pad('MAE', 10) + pad('RMSE', 10)
        + pad('FALLBACKS', 12) + pad('FALLBACK %', 12) + 'TIME (ms)');
    console.log('-'.repeat(74));
    console.log(pad('user-based CF', 22) + pad(report.userBased.n, 7)
        + pad(num(report.userBased.mae, 4), 10) + pad(num(report.userBased.rmse, 4), 10)
        + pad(report.userBased.fallbacks, 12) + pad(num(report.userBased.fallbackPercent, 2) + '%', 12)
        + report.userBased.elapsedMs);
    console.log(pad('item-based CF', 22) + pad(report.itemBased.n, 7)
        + pad(num(report.itemBased.mae, 4), 10) + pad(num(report.itemBased.rmse, 4), 10)
        + pad(report.itemBased.fallbacks, 12) + pad(num(report.itemBased.fallbackPercent, 2) + '%', 12)
        + report.itemBased.elapsedMs);
    console.log(pad('global mean (base)', 22) + pad(report.baseline.n, 7)
        + pad(num(report.baseline.mae, 4), 10) + pad(num(report.baseline.rmse, 4), 10)
        + pad('n/a', 12) + pad('n/a', 12) + report.baseline.elapsedMs);
    console.log('-'.repeat(74));
    console.log('mean neighbours used when not falling back: user-based '
        + num(report.userBased.meanNeighbors, 2) + ', item-based ' + num(report.itemBased.meanNeighbors, 2));
    console.log('');

    console.log('timing breakdown (ms):');
    console.log('  split        ' + report.timing.splitMs);
    console.log('  build lookups' + String(report.timing.lookupMs).padStart(8));
    console.log('  user-based   ' + report.timing.userBasedMs);
    console.log('  item-based   ' + report.timing.itemBasedMs);
    console.log('  baseline     ' + report.timing.baselineMs);
    console.log('  total        ' + report.timing.totalMs);
    console.log('');
    console.log('largest absolute errors:');
    for (const [label, rows] of [['user-based', report.userBased.worst], ['item-based', report.itemBased.worst]]) {
        for (const row of rows) {
            console.log('  ' + pad(label, 12) + 'user ' + pad(row.userId, 6) + 'movie ' + pad(row.movieId, 6)
                + 'predicted ' + pad(row.predicted.toFixed(3), 8) + 'actual ' + pad(row.actual, 6)
                + 'error ' + row.error.toFixed(3));
        }
    }
    console.log('='.repeat(74));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DEFAULTS,
        mulberry32,
        shuffleInPlace,
        splitRatings,
        sampleHeldOut,
        assertNoLeak,
        scoreMethod,
        scoreGlobalMeanBaseline,
        runEvaluation,
        printEvaluation
    };
}
