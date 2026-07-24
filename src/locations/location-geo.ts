/**
 * Pure geo helpers for mapping a shared Telegram pin onto a configured location.
 * Kept free of Nest/TypeORM so the matching rule can be unit-tested directly.
 */

export type GeoCandidate = {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters: number;
};

export type GeoMatch = {
  id: string;
  name: string;
  distanceMeters: number;
};

const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two WGS84 points, in metres. */
export function haversineMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The nearest candidate whose own `radiusMeters` contains the point, or null if
 * the point falls outside every candidate's radius. Each location carries its
 * own radius so a dense city area and a rural town can coexist. Candidates
 * missing either coordinate are pick-from-list only and are skipped.
 *
 * Ties (identical distance) resolve to the first candidate in the input order,
 * so callers get a deterministic answer for a stably-ordered list.
 */
export function findNearestLocation(
  candidates: GeoCandidate[],
  latitude: number,
  longitude: number,
): GeoMatch | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  let best: GeoMatch | null = null;

  for (const candidate of candidates) {
    if (
      candidate.latitude === null || candidate.latitude === undefined ||
      candidate.longitude === null || candidate.longitude === undefined
    ) {
      continue;
    }

    const distanceMeters = haversineMeters(
      latitude,
      longitude,
      candidate.latitude,
      candidate.longitude,
    );

    if (distanceMeters > candidate.radiusMeters) continue;
    if (best && distanceMeters >= best.distanceMeters) continue;

    best = { id: candidate.id, name: candidate.name, distanceMeters };
  }

  return best;
}
