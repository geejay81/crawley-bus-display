function findNearestStop<T extends { lat: number; lon: number }>(
  lat: number,
  lon: number,
  chain: readonly T[],
): { stop: T; distanceKm: number } | null {
  let best: T | null = null;
  let minDist = Infinity;

  for (const stop of chain) {
    const d = haversineKm(lat, lon, stop.lat, stop.lon);
    if (d < minDist) {
      minDist = d;
      best = stop;
    }
  }

  return best ? { stop: best, distanceKm: minDist } : null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export { findNearestStop, haversineKm };