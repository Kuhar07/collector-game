/**
 * Coordinate normalization utility for cross-migration compatibility.
 * Supports multiple formats: [row, col], {r, c}, {row, col}, {x, y}
 * Always normalizes to [row, col] tuple format.
 */

/**
 * Normalize a single coordinate point to [row, col] format.
 * Accepts: [r, c], {r, c}, {row, col}, {x, y}
 * Returns: [row, col] or null if invalid.
 */
export function normalizeCoordinate(point) {
  if (!point) return null;

  // Already a valid tuple [row, col]
  if (
    Array.isArray(point) &&
    point.length === 2 &&
    Number.isInteger(point[0]) &&
    Number.isInteger(point[1])
  ) {
    return [point[0], point[1]];
  }

  // Object with r, c keys
  if (
    typeof point === 'object' &&
    Number.isInteger(point.r) &&
    Number.isInteger(point.c)
  ) {
    return [point.r, point.c];
  }

  // Object with row, col keys
  if (
    typeof point === 'object' &&
    Number.isInteger(point.row) &&
    Number.isInteger(point.col)
  ) {
    return [point.row, point.col];
  }

  // Object with x, y keys (legacy Electron format)
  if (
    typeof point === 'object' &&
    Number.isInteger(point.x) &&
    Number.isInteger(point.y)
  ) {
    return [point.x, point.y];
  }

  return null;
}

/**
 * Normalize a placement history array to [[row, col], ...] format.
 * Removes invalid entries silently.
 * Accepts: [[r, c], ...], [{r, c}, ...], [{row, col}, ...], etc.
 * Returns: [[row, col], ...]
 */
export function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map(normalizeCoordinate)
    .filter((coord) => coord !== null);
}

/**
 * Validate that a coordinate is within grid bounds.
 * Returns true if 0 <= row < size and 0 <= col < size.
 */
export function isCoordinateInBounds(row, col, size) {
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    row >= 0 &&
    row < size &&
    col >= 0 &&
    col < size
  );
}

/**
 * Normalize and filter history to only include in-bounds coordinates.
 * Useful for defensive rendering.
 */
export function normalizeAndFilterHistory(history, size) {
  const normalized = normalizeHistory(history);
  return normalized.filter(([row, col]) => isCoordinateInBounds(row, col, size));
}
