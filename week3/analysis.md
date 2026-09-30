# HW3 Analysis: User-Based and Item-Based Collaborative Filtering

Data: MovieLens 100K (`u.data`, `u.item`) — 100,000 observed ratings, 943 users,
1,682 movies. Implementation in `cf.js`; evaluation harness in `evaluate.js`
(standalone, not loaded by the page).

## 1. Missing-value strategy (as implemented)

An unrated user–movie pair is treated as **unknown, not as a value**. The lookup
tables (`byUser`, `byMovie`) store only observed ratings, so a missing entry is
absent rather than zero. This distinction is what makes the rest of the
pipeline work: a pair that was never rated contributes neither to a similarity
nor to a mean, instead of silently pulling a prediction toward the bottom of
the scale.

**Similarity** is cosine computed over **only the co-rated observations** of the
two profiles being compared (`coRatedEntries` returns just the shared keys, and
walks the smaller profile for speed). If a pair shares **fewer than
`MIN_COMMON = 3` co-rated items**, similarity returns `null` — no similarity. A
zero-norm denominator also returns `null` rather than a number.

**Prediction** keeps only neighbors whose similarity is `null`-free and
**strictly positive**, sorts them strongest-first, and caps them at
**`MAX_NEIGHBORS = 30`**. Non-positive similarities are dropped outright rather
than treated as a weight of zero, which would still distort the denominator.

The two methods aggregate differently, and the difference is deliberate:

- **User-based** is mean-centered. Each neighbor's rating of the target movie
  is expressed as a **deviation from that neighbor's own mean**, then added back
  to the target user's own mean:
  `targetMean + Σ wᵢ(rᵢₘ − meanᵢ) / Σ wᵢ`. Neighbors rate in their own
  generosity scale, so without centering the estimate would drift toward the
  average rater rather than the person being predicted for.
- **Item-based** is a direct similarity-weighted average of the target user's
  own ratings of similar movies, `Σ wᵢrᵢ / Σ wᵢ`. Those contributing ratings
  are already on the target user's scale, so no deviation correction is applied.

**Fallback** (`meanFallbackResult`, shared by both methods) is used when no
neighbor can be trusted — no qualifying neighbors, or positive weights summing
to zero. Preference order: the **target user's own mean** of observed ratings,
then the **global mean** if that user has no ratings at all. It never returns 0
and never borrows the other method's estimate. User-based additionally falls
back when the target movie has no ratings in train. All predictions are clipped
to [1, 5]; a non-finite value is passed through untouched so a bug surfaces
rather than being hidden as a 1 or a 5.

## 2. Quality

One fixed-seed train/test split, scored on one bounded sample of held-out
**real observed ratings**. No invented or imputed ratings appear anywhere.

- **Split seed** `42`; **sample seed** `4242`. A mulberry32 PRNG with seeded
  Fisher–Yates, no `Math.random()`. Both seeds are fixed and the run is
  reproducible.
- **Split rule:** per user, shuffle that user's observed ratings and move the
  first `round(n × 0.2)` to test, remainder to train. 80,000 train / 20,000 test.
- **Evaluation sample:** 2,000 held-out pairs, shuffled with the sample seed and
  truncated. Both methods and the baseline score **the identical list**, so the
  rows are directly comparable.
- **Users split:** 943. **Users skipped: 0** — every user's profile is at or
  above the `minRatingsPerUser = 5` guard (the smallest profile in this dataset
  is 20 ratings).
- **Leakage check:** 0 violations. The script verifies that no sampled held-out
  pair is readable in the tables the predictors consult, so no held-out rating
  influenced a similarity, a user mean, or the global mean (3.527375, from train
  only).

| Method | N | MAE | RMSE | Mean-fallbacks | Fallback % | Time (ms) |
|---|---|---|---|---|---|---|
| User-based CF | 2000 | **0.7492** | **0.9520** | 5 | 0.25% | ~9,400–9,500 |
| Item-based CF | 2000 | 0.8013 | 1.0212 | 16 | 0.80% | ~8,200–8,400 |
| Global-mean baseline (train) | 2000 | 0.9639 | 1.1463 | n/a | n/a | ~0 |

Mean neighbors used when not falling back: 28.38 (user-based), 29.20
(item-based) — close to the cap of 30, so the cap is doing real work.

Both methods beat the global-mean baseline: user-based reduces MAE by 22.3% and
RMSE by 17.0%; item-based by 16.9% and 10.9%. These percentages are arithmetic
derived from the table above, not separate measurements.

**This is one sampled split, not a universal ranking.** The 0.0521 MAE gap
between the two methods is a single point estimate on 2,000 pairs with no
confidence interval and no repeated runs across seeds. A different sample seed
could plausibly reorder them, and on this dataset the two are close enough that
the gap alone should not be reported as "user-based is better" in general.

**On the per-user split and weighting.** Splitting per user fixes the
*held-out fraction* of every profile at roughly 20% and guarantees that **every
user appears in the test set at all**, since the held-out count is floored at one
(`Math.max(1, ...)`) — a global random split could leave a low-activity user with
nothing held out, and that user would then drop out of the evaluation entirely.
What it does **not** do is stop active users from dominating the metrics. MAE
and RMSE are means over the 2,000 sampled **pairs**, not means over users, and
an active user contributes proportionally more pairs, so a user with 700
ratings still has roughly 35 times the influence on each error total as a user
with 20. Equalizing the held-out *rate* is not the same as equalizing each
user's *weight*; only a per-user metric — averaging absolute error within each
user first, then averaging those per-user averages — would weight users equally,
and that is not what these numbers are.

## 3. Efficiency

Measured evaluation times, 2,000 predictions per method: user-based ~9.4–9.5 s,
item-based ~8.2–8.4 s, on one machine, single-threaded. Splitting and building
the lookup tables are negligible beside prediction (41 ms and 37 ms).

**These times describe this implementation on this runtime, not the two methods
in general.** The gap of roughly 1.2 s was repeatable on this machine across
runs, which is a statement about measurement stability rather than about
inherent speed. The figures come from one runtime (JavaScriptCore via
`osascript`), one sample, and one particular code path: this code computes
similarities **lazily, on demand, with no precomputed table and no caching**, so
the numbers reflect that design plus the raw popularity distribution. An
implementation that precomputes or memoizes similarities would land somewhere
else entirely, and was not measured here. Prediction cost in both methods is
dominated by candidate enumeration: user-based scans every rater of the target
movie and computes a similarity per rater, item-based scans every movie the
target user rated and computes a similarity per movie. Those costs track
*popularity of the movie* versus *profile size of the user*, so which method
looks faster depends on the catalog's popularity distribution rather than on the
algorithms in the abstract.

**Users versus items, structurally.** The number of similarity pairs that could
ever exist scales with the square of the entity count, and this dataset has more
items than users:

- possible user pairs `C(943, 2)` = **444,153**
- possible item pairs `C(1,682, 2)` = **1,413,721**
- ratio **≈ 3.18×** more possible item pairs

(These are combinatorial counts, not measured times.) So a precomputed
all-pairs item-similarity table would be roughly three times larger and more
expensive to fill than the user equivalent, and would grow quadratically as the
catalog grows — a well-known scaling argument for item-based CF on services with
many more items than active users. This implementation does **not** precompute
any table: it computes similarities lazily, on demand, per prediction, which
keeps startup cheap but repeats work across the 2,000 predictions and is the
main reason both methods take seconds rather than milliseconds.

The asymmetry in profile size cuts the other way at lookup time. The mean
profile is 106.04 movies per user but only 59.45 ratings per movie, so a
user-based similarity is an intersection over two longer lists than an
item-based one, while the item-based candidate pool per prediction is the target
user's whole 106-item profile against the target movie's 59-rater list. Since
`coRatedEntries` walks the smaller of the two maps, the real cost depends on
the intersection of a user-pair and a movie-pair at once, which is why the two
methods land in the same order of magnitude rather than one clearly dominating.

## 4. Cold start and sparsity

Density here is 6.30% (100,000 of 1,586,126 cells) — 93.7% of the matrix is
missing, and the two methods depend on those missing entries staying missing.

**Both methods are similarity-based, so both are structurally weak when
evidence is absent.** A brand-new user has no profile: every similarity returns
`null` (one side is `null` outright), so no neighbor can qualify and the
prediction falls back to the global mean. That is honest but uninformative — the
answer carries no information about the individual. A brand-new movie likewise
has no raters in train, so it has no co-rated profile to intersect; user-based
CF falls back explicitly via the `ratingsByMovie` guard, and item-based CF
inherits the same problem from the other direction, since no item similarity can
involve a movie nobody has rated. Neither method can recommend an item the
training set has never seen, and neither can personalize for a user the
training set has never seen.

**Why overlap under 3 is rejected.** Every rating lies in [1, 5], so all
coordinates are strictly positive and a cosine built from co-rated entries
**can never be negative** — the dot product of two positive vectors is
positive. The danger of thin overlap is therefore not weak or negative
similarity, it is *spuriously high* similarity. With exactly one common item the
two vectors are one-dimensional and their cosine is **exactly 1**, a perfect
score produced by a single observation. With two common items the score is still
guaranteed positive and can sit very close to 1 even for profiles with no
meaningful agreement. Because `selectPositiveNeighbors` keeps the 30 **highest**
weights, a large supply of such inflated scores is exactly what would crowd out
genuine neighbors — the cap cannot protect against this, because it ranks on
the inflated weight itself. Thin overlaps also arise *by accident* in a
6.3%-dense matrix, where sharing two movies is far more likely to be
coincidence than evidence of taste. Rejecting underlap trades recall for
precision, and `MIN_COMMON = 3` is a **heuristic cutoff, not a proof**: it does
not establish that three co-ratings are independent evidence, or that two
profiles sharing three movies really are similar in taste — only that three
shared keys are enough to stop single-observation artifacts from scoring a
perfect 1. A zero-norm denominator is rejected separately, since it yields a
0/0 ratio that carries no directional information.

**This evaluation did not directly test new-user performance.** Every one of
the 943 users in the test sample was present in train, contributing 80% of
their ratings, so the 0.25% and 0.80% fallback rates describe users with
established profiles — not cold-start behavior. True cold-start accuracy would
need a split holding out users *entirely*, which was not run, so no number here
should be read as a cold-start result.

## 5. Trade-offs

**Observed-only (implemented).** Missing means unknown. Nothing is imputed, so
no fabricated value can contaminate a similarity, a mean, or a user profile. The
cost is concentrated sparsity: with 93.7% of cells empty, a cold user or item
gets the global mean and personalization degrades to a constant.

**Mean imputation (not implemented).** Replacing each missing cell with the
user mean, item mean, or global mean would make the matrix dense and let dense
linear algebra apply. The problem is not filling cells in itself, it is
**discarding the knowledge of which cells were filled**: an imputed cell then
looks identical to an observed one, and a similarity computed over such entries
measures agreement between two people's *averages* rather than their tastes. On
this 6.3%-dense data, filled cells outnumber real evidence many times over, so
once the mask is dropped the similarities become largely artifacts of the
imputation choice. Keeping a mask avoids that failure entirely, so the
objection is to the naive variant rather than to imputation as such — an
implementation that carries an observation mask through its algebra can use a
dense formulation without ever counting an invented rating as evidence. This
implementation takes the mask-preserving route already, by storing only
observed ratings and intersecting on jointly-observed keys, which is the
clearest reason the observed-only strategy is the defensible one here.

**Matrix factorization (code retained in `script.js`, unused, not evaluated
here).** MF learns latent factors from observed entries only, and it handles a
**thinly rated but known** movie far better than pairwise similarity can: a
movie with only a handful of training ratings still receives an embedding
fitted from those ratings together with every item co-occurring with them, and
it can be related to other items through factor space rather than through
shared raters. That is the sense in which it beats the neighbourhood methods
on a 6.3%-dense matrix — and it is a narrower claim than "MF handles new items".
Two caveats for the writeup. First, it is **not** covered by the table above:
the split, lookups, and sampling in `evaluate.js` measure only the two CF
methods, and no like-for-like MF number from the same split is available to
compare. Second, MF does **not** solve cold start on either axis. A completely
new movie absent from the training data gets no gradient and therefore no
learned embedding: the embedding table is sized to the catalog
(`inputDim: numMovies + 1`), so a catalogued but never-rated movie occupies a
slot that simply never receives an update, and a movie outside the catalog has
no slot at all. The distinction that matters is between a movie that is
**known but sparsely rated**, which MF can embed, and a movie that is **new**,
which it cannot — closing the latter gap would need side information such as
genre, cast or tags, none of which this implementation uses. A new user is the
mirror case: no ratings means no rows to train against, so it needs the same
mean fallback. MF also makes an extra global assumption (a low-rank, factorized
structure) that the pairwise methods do not.

The implemented design keeps the two neighborhood methods as the primary
answer, with mean fallbacks that degrade predictably instead of failing. The MF
code is still present in `script.js` for reference but is not wired to the page
and is not trained on load, so nothing the user sees depends on it.
