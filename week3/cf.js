// Collaborative filtering primitives: co-rated cosine similarity.
//
// A missing rating is unknown, not zero. Nothing in this file enumerates
// unrated pairs or pads anything with zeros. Every similarity is computed
// only from the observations that two users (or two movies) actually share.

// Minimum number of co-rated observations required before a similarity is
// reported at all. Below this the overlap is noise, not evidence.
const MIN_COMMON = 3;

// Neighbours used by a prediction, and the rating scale predictions are
// clipped back onto.
const MAX_NEIGHBORS = 30;
const MIN_RATING = 1;
const MAX_RATING = 5;

// Lookup tables, rebuilt from a ratings array. They hold only observed
// entries, so an absent key means "not rated" instead of "rated 0".
let cfLookups = { byUser: new Map(), byMovie: new Map() };

// ratingList: [{ userId: number, movieId: number, rating: number }]
function buildLookups(ratingList) {
    const byUser = new Map();
    const byMovie = new Map();
    let total = 0;

    for (const entry of ratingList) {
        if (!byUser.has(entry.userId)) byUser.set(entry.userId, new Map());
        byUser.get(entry.userId).set(entry.movieId, entry.rating);

        if (!byMovie.has(entry.movieId)) byMovie.set(entry.movieId, new Map());
        byMovie.get(entry.movieId).set(entry.userId, entry.rating);

        total += entry.rating;
    }

    // Mean over observed ratings only. Unrated pairs are absent from the
    // sum entirely rather than being counted as zeros, which would drag the
    // mean toward 0 and make sparse users look like harsh critics.
    const globalMean = ratingList.length > 0 ? total / ratingList.length : null;

    return { byUser, byMovie, globalMean };
}

// Build the tables that userSimilarity/itemSimilarity read from.
function initCollaborativeFiltering(ratingList) {
    cfLookups = buildLookups(ratingList);
    return cfLookups;
}

// Observed ratings of one user as a Map(movieId -> rating), or null if unknown.
function ratingsByUser(userId) {
    return cfLookups.byUser.get(userId) || null;
}

// Observed ratings of one movie as a Map(userId -> rating), or null if unknown.
function ratingsByMovie(movieId) {
    return cfLookups.byMovie.get(movieId) || null;
}

// Mean of one user's observed ratings, or null if the user rated nothing.
function userMean(userId) {
    const ratings = ratingsByUser(userId);
    if (!ratings || ratings.size === 0) return null;

    let total = 0;
    for (const rating of ratings.values()) total += rating;
    return total / ratings.size;
}

// Mean of every observed rating in the dataset, or null if it is empty.
function globalMean() {
    return cfLookups.globalMean;
}

// Confine a prediction to the rating scale. A non-finite value is passed
// through untouched on purpose: Math.min/max would quietly turn NaN into
// 1 or 5 and hide a bug instead of surfacing it.
function clipRating(value) {
    return Math.min(MAX_RATING, Math.max(MIN_RATING, value));
}

// Intersect two rating Maps, walking the smaller one for speed.
// Always returns [key, ratingFromA, ratingFromB] triples for the shared
// entries only, in the caller's order: swapping which Map is iterated must
// never swap the two ratings inside a triple. Cosine happens to be
// symmetric, so it cannot detect that mistake on its own -- the triples are
// the contract, and anything asymmetric built on top of them depends on it.
function coRatedEntries(ratingsA, ratingsB) {
    const aIsSmaller = ratingsA.size <= ratingsB.size;
    const [smaller, larger] = aIsSmaller
        ? [ratingsA, ratingsB]
        : [ratingsB, ratingsA];

    const shared = [];
    for (const [key, ratingSmaller] of smaller) {
        const ratingLarger = larger.get(key);
        if (ratingLarger === undefined) continue;
        shared.push(aIsSmaller
            ? [key, ratingSmaller, ratingLarger]
            : [key, ratingLarger, ratingSmaller]);
    }
    return shared;
}

// Cosine over co-rated triples. Cosine is scale-invariant, so it compares
// the direction of a rating profile, not its level: an all-5 profile and an
// all-3 profile over the same movies score 1, not less than 1. A user's
// rating generosity is therefore invisible to this function, and a lone
// co-rated rating far from the user's usual level moves the similarity as
// much as a whole profile of agreement does.
function cosineFromCoRated(shared) {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (const [, ratingA, ratingB] of shared) {
        dot += ratingA * ratingB;
        normA += ratingA * ratingA;
        normB += ratingB * ratingB;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return null;

    return dot / denominator;
}

// Cosine similarity between two users over the movies both of them rated.
// Returns null ("no similarity") on underlap or a zero denominator.
function userSimilarity(userA, userB) {
    const ratingsA = ratingsByUser(userA);
    const ratingsB = ratingsByUser(userB);
    if (!ratingsA || !ratingsB) return null;

    const shared = coRatedEntries(ratingsA, ratingsB);
    if (shared.length < MIN_COMMON) return null;

    return cosineFromCoRated(shared);
}

// Cosine similarity between two movies over the users who rated both.
// Returns null ("no similarity") on underlap or a zero denominator.
function itemSimilarity(movieA, movieB) {
    const ratingsA = ratingsByMovie(movieA);
    const ratingsB = ratingsByMovie(movieB);
    if (!ratingsA || !ratingsB) return null;

    const shared = coRatedEntries(ratingsA, ratingsB);
    if (shared.length < MIN_COMMON) return null;

    return cosineFromCoRated(shared);
}

// ---------------------------------------------------------------------
// Predictions for a user/movie pair the user has not rated.
//
// Both methods are self-contained. Neither one ever calls the other, and
// neither one borrows evidence it cannot see: user-based looks only at
// ratings of the target movie, item-based only at the target user's own
// ratings of other movies.
// ---------------------------------------------------------------------

// Mean-based fallback, shared by both methods because it is the only
// estimate available when no neighbour can be trusted. Preference order:
// the target user's own mean, then the global mean if the user has no
// ratings at all. Never falls back to 0, and never borrows the other method.
function meanFallbackResult(userId, method, cause) {
    const ownMean = userMean(userId);
    const mean = ownMean !== null ? ownMean : globalMean();
    const label = ownMean !== null
        ? `mean fallback (target user mean ${ownMean.toFixed(3)}): ${cause}`
        : `global mean fallback (${mean === null ? 'no data' : mean.toFixed(3)}): ${cause}`;

    return {
        rating: clipRating(mean),
        method,
        neighbors: 0,
        fallback: true,
        fallbackReason: label
    };
}

// Keep only positive-similarity candidates, strongest first, capped at
// MAX_NEIGHBORS. A non-positive or missing similarity is dropped outright
// rather than treated as a weight of zero, which would still distort the
// denominator.
function selectPositiveNeighbors(candidates) {
    return candidates
        .filter(candidate => candidate.weight !== null && candidate.weight > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_NEIGHBORS);
}

// User-based CF. The contributing observations are the ratings of the
// target movie by users similar to the target user, each expressed as a
// deviation from that neighbour's own mean so the estimate lands in the
// target user's scale rather than the neighbour's.
function predictUserBased(userId, movieId) {
    const targetMean = userMean(userId);
    if (targetMean === null) {
        return meanFallbackResult(userId, 'user-based', 'target user has no ratings');
    }

    const movieRatings = ratingsByMovie(movieId);
    if (!movieRatings) {
        return meanFallbackResult(userId, 'user-based', 'target movie has no ratings');
    }

    const candidates = [];
    for (const [neighborId, ratingOfTargetMovie] of movieRatings) {
        if (neighborId === userId) continue;
        candidates.push({
            id: neighborId,
            weight: userSimilarity(userId, neighborId),
            ratingOfTargetMovie
        });
    }

    const neighbors = selectPositiveNeighbors(candidates);
    if (neighbors.length === 0) {
        return meanFallbackResult(userId, 'user-based', 'no user neighbor has positive similarity');
    }

    let weightedSum = 0;
    let weightTotal = 0;
    for (const neighbor of neighbors) {
        const neighborMean = userMean(neighbor.id);
        weightedSum += neighbor.weight * (neighbor.ratingOfTargetMovie - neighborMean);
        weightTotal += neighbor.weight;
    }
    if (weightTotal === 0) {
        return meanFallbackResult(userId, 'user-based', 'positive weights summed to zero');
    }

    // With a single neighbor the weight cancels and only the deviation
    // survives, so the similarity value does not change the estimate.
    const predicted = targetMean + weightedSum / weightTotal;

    return {
        rating: clipRating(predicted),
        method: 'user-based',
        neighbors: neighbors.length,
        fallback: false,
        fallbackReason: null
    };
}

// Item-based CF. The contributing observations are the target user's own
// ratings of movies similar to the target movie. Those ratings are already
// on the target user's scale, so no deviation correction is applied.
function predictItemBased(userId, movieId) {
    const userRatings = ratingsByUser(userId);
    if (!userRatings || userRatings.size === 0) {
        return meanFallbackResult(userId, 'item-based', 'target user has no ratings');
    }

    const candidates = [];
    for (const [neighborMovieId, ratingOfNeighborMovie] of userRatings) {
        if (neighborMovieId === movieId) continue;
        candidates.push({
            id: neighborMovieId,
            weight: itemSimilarity(movieId, neighborMovieId),
            ratingOfNeighborMovie
        });
    }

    const neighbors = selectPositiveNeighbors(candidates);
    if (neighbors.length === 0) {
        return meanFallbackResult(userId, 'item-based', 'no movie neighbor has positive similarity');
    }

    let weightedSum = 0;
    let weightTotal = 0;
    for (const neighbor of neighbors) {
        weightedSum += neighbor.weight * neighbor.ratingOfNeighborMovie;
        weightTotal += neighbor.weight;
    }
    if (weightTotal === 0) {
        return meanFallbackResult(userId, 'item-based', 'positive weights summed to zero');
    }

    return {
        rating: clipRating(weightedSum / weightTotal),
        method: 'item-based',
        neighbors: neighbors.length,
        fallback: false,
        fallbackReason: null
    };
}

// Allows the test file to require() this module under Node, while the
// browser keeps using the plain global functions above.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
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
}
