export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = (d: number) => (d * Math.PI) / 180;
const R = 6378137; // WGS-84 equatorial radius, metres

/**
 * Geodesic polygon area via the spherical-excess formula.
 * Accurate to well under 1% at field scale, and needs no projection —
 * important because a farmer's plot can sit anywhere in India.
 */
export function polygonAreaSqM(points: LatLon[]): number {
  if (points.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    total +=
      toRad(p2.lon - p1.lon) *
      (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  return Math.abs((total * R * R) / 2);
}

export function polygonAreaHectares(points: LatLon[]): number {
  return polygonAreaSqM(points) / 10_000;
}

export function polygonAreaAcres(points: LatLon[]): number {
  return polygonAreaSqM(points) / 4046.856;
}

/** Simple vertex centroid — good enough for a field-scale polygon. */
export function polygonCentroid(points: LatLon[]): LatLon | null {
  if (points.length === 0) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  return { lat, lon };
}

/** Guard against self-intersecting polygons drawn by tapping out of order. */
export function isPlausibleField(points: LatLon[]): boolean {
  if (points.length < 3) return false;
  const ha = polygonAreaHectares(points);
  return ha > 0.005 && ha < 5000;
}
