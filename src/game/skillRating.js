const SQRT_2 = Math.SQRT2;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

export const DEFAULT_MU = 1500;
export const DEFAULT_SIGMA = 500;
export const OPEN_SKILL_BETA = 250;
export const DEFAULT_DISPLAY_RATING = 1000;

const DISPLAY_SCALE = 1000 / Math.LN2;
const DISPLAY_DIVISOR = 2485;
const MIN_SIGMA = 1;
const EPSILON = 1e-12;

function erf(x) {
    const sign = Math.sign(x) || 1;
    const absX = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * absX);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));
    return sign * y;
}

export function standardNormalPdf(x) {
    return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

export function standardNormalCdf(x) {
    return 0.5 * (1 + erf(x / SQRT_2));
}

function softplus(x) {
    if (x > 0) {
        return x + Math.log1p(Math.exp(-x));
    }
    return Math.log1p(Math.exp(x));
}

export function conservativeSkillFromDisplayRating(displayRating) {
    const normalizedDisplay = Math.max(0, Number(displayRating) || 0);
    const scaled = (normalizedDisplay * Math.LN2) / 1000;
    if (scaled === 0) return Number.NEGATIVE_INFINITY;
    return DISPLAY_DIVISOR * Math.log(Math.expm1(scaled));
}

export function displayRatingFromConservativeSkill(conservativeSkill) {
    const value = Number(conservativeSkill);
    if (!Number.isFinite(value)) return DEFAULT_DISPLAY_RATING;
    return Math.max(0, DISPLAY_SCALE * softplus(value / DISPLAY_DIVISOR));
}

export function getConservativeSkillEstimate(mu, sigma) {
    const normalizedMu = Number(mu);
    const normalizedSigma = Number(sigma);
    if (!Number.isFinite(normalizedMu) || !Number.isFinite(normalizedSigma)) {
        return DEFAULT_MU - 3 * DEFAULT_SIGMA;
    }
    return normalizedMu - 3 * normalizedSigma;
}

export function getDisplayRatingFromProfile(profile = {}) {
    if (Number.isFinite(Number(profile.mu)) && Number.isFinite(Number(profile.sigma))) {
        return Math.round(
            displayRatingFromConservativeSkill(
                getConservativeSkillEstimate(profile.mu, profile.sigma)
            )
        );
    }

    const legacyRating = Number(profile.rating);
    if (Number.isFinite(legacyRating)) {
        return Math.max(0, legacyRating);
    }

    return DEFAULT_DISPLAY_RATING;
}

export function normalizeSkillProfile(profile = {}) {
    const mu = Number(profile.mu);
    const sigma = Number(profile.sigma);
    if (Number.isFinite(mu) && Number.isFinite(sigma)) {
        const clampedSigma = Math.max(MIN_SIGMA, sigma);
        return {
            mu,
            sigma: clampedSigma,
            rating: Math.round(displayRatingFromConservativeSkill(mu - 3 * clampedSigma))
        };
    }

    const legacyRating = Number(profile.rating);
    if (Number.isFinite(legacyRating)) {
        const clampedRating = Math.max(0, legacyRating);
        const conservativeSkill = conservativeSkillFromDisplayRating(clampedRating);
        return {
            mu: conservativeSkill + 3 * DEFAULT_SIGMA,
            sigma: DEFAULT_SIGMA,
            rating: Math.round(clampedRating)
        };
    }

    return {
        mu: DEFAULT_MU,
        sigma: DEFAULT_SIGMA,
        rating: DEFAULT_DISPLAY_RATING
    };
}

function resolveProfile(input) {
    if (typeof input === 'number') {
        return normalizeSkillProfile({ rating: input });
    }
    return normalizeSkillProfile(input || {});
}

function updateSkillProfiles(winnerProfile, loserProfile) {
    const winner = resolveProfile(winnerProfile);
    const loser = resolveProfile(loserProfile);

    const winnerSigmaSq = winner.sigma ** 2;
    const loserSigmaSq = loser.sigma ** 2;
    const c = Math.sqrt(2 * OPEN_SKILL_BETA ** 2 + winnerSigmaSq + loserSigmaSq);
    const t = (winner.mu - loser.mu) / c;
    const p = Math.max(standardNormalCdf(t), EPSILON);
    const pdf = standardNormalPdf(t);
    const gamma = 1 / c;
    const v = (pdf * (t + pdf / p)) / p;

    const winnerMu = winner.mu + (winnerSigmaSq / c) * (pdf / p);
    const loserMu = loser.mu - (loserSigmaSq / c) * (pdf / p);
    const winnerSigma = Math.sqrt(Math.max(winnerSigmaSq * (1 - winnerSigmaSq * gamma * gamma * v), MIN_SIGMA ** 2));
    const loserSigma = Math.sqrt(Math.max(loserSigmaSq * (1 - loserSigmaSq * gamma * gamma * v), MIN_SIGMA ** 2));

    return {
        winner: {
            mu: winnerMu,
            sigma: winnerSigma,
            rating: Math.round(displayRatingFromConservativeSkill(getConservativeSkillEstimate(winnerMu, winnerSigma)))
        },
        loser: {
            mu: loserMu,
            sigma: loserSigma,
            rating: Math.round(displayRatingFromConservativeSkill(getConservativeSkillEstimate(loserMu, loserSigma)))
        }
    };
}

export function computeSkillDelta(profileA, profileB, scoreA) {
    const normalizedA = resolveProfile(profileA);
    const normalizedB = resolveProfile(profileB);

    if (scoreA === 0.5) {
        return {
            delta1: 0,
            delta2: 0,
            newR1: normalizedA.rating,
            newR2: normalizedB.rating,
            profile1: normalizedA,
            profile2: normalizedB
        };
    }

    const firstIsWinner = scoreA === 1;
    const { winner, loser } = firstIsWinner
        ? updateSkillProfiles(normalizedA, normalizedB)
        : updateSkillProfiles(normalizedB, normalizedA);

    const profile1 = firstIsWinner ? winner : loser;
    const profile2 = firstIsWinner ? loser : winner;

    return {
        delta1: profile1.rating - normalizedA.rating,
        delta2: profile2.rating - normalizedB.rating,
        newR1: profile1.rating,
        newR2: profile2.rating,
        profile1,
        profile2
    };
}
