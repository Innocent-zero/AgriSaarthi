const EARTH_RADIUS_M = 6371008.8;

export interface LatLon {
  lat: number;
  lon: number;
}

export function polygonAreaHectares(points: LatLon[]): number {
  if (points.length < 3) return 0;

  const meanLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const latRad = (meanLat * Math.PI) / 180;
  const metersPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const metersPerDegLon = metersPerDegLat * Math.cos(latRad);

  const projected = points.map((point) => ({
    x: point.lon * metersPerDegLon,
    y: point.lat * metersPerDegLat,
  }));

  let doubleArea = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const current = projected[i];
    const next = projected[(i + 1) % projected.length];
    doubleArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(doubleArea) / 2 / 10000;
}
