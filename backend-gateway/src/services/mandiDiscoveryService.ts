/**
 * Automatic mandi discovery.
 *
 * From farm coordinates alone:
 *   1. reverse-geocode to state and district
 *   2. pull live APMC tickers for that state (AGMARKNET via data.gov.in)
 *   3. resolve each market to coordinates and compute road-adjusted distance
 *   4. drop markets outside the search radius
 *   5. hand the survivors to the C++ engine for net-profit ranking
 *
 * The farmer supplies a crop and a volume. Nothing else.
 *
 * Coordinate resolution is the expensive step: AGMARKNET returns market names
 * with no coordinates, and Nominatim allows one request per second. Three
 * sources are tried in order of cost — the ticker itself (seed data ships with
 * coordinates), then the pre-built gazetteer, then live geocoding.
 */
import { swytchcode, MandiTicker } from './swytchcodeService';
import { geocoding, GeocodePrecision } from './geocodingService';
import { runMandiEngine, MandiEngineInput, MandiEngineOutput } from './mandiEngineBridge';
import { cacheGet, cacheSet } from '../config/redis';

// Optional: present once scripts/buildGazetteer.ts has been run.
// Wrapped so a missing file does not break the build.
let GAZETTEER = new Map<string, { lat: number; lon: number; precision: 'market' | 'district' }>();
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const raw = require('../data/mandiGazetteer.json') as Array<{
    market: string; district: string; state: string;
    lat: number; lon: number; precision: 'market' | 'district';
  }>;
  GAZETTEER = new Map(
    raw.map((e) => [`${e.market.toLowerCase()}|${e.state.toLowerCase()}`,
      { lat: e.lat, lon: e.lon, precision: e.precision }]),
  );
  console.log(`[mandi] gazetteer loaded: ${GAZETTEER.size} pre-geocoded markets`);
} catch {
  console.warn('[mandi] no gazetteer found — falling back to live geocoding (slow). '
    + 'Run: npx ts-node scripts/buildGazetteer.ts');
}

export interface DiscoveryRequest {
  lat: number;
  lon: number;
  crop: string;
  volumeQuintals: number;
  radiusKm?: number;
  localPricePerQuintal?: number;
  state?: string;
  district?: string;
  vehicle?: MandiEngineInput['vehicle'];
}

export interface DiscoveredMandi {
  id: string;
  name: string;
  district: string;
  lat: number;
  lon: number;
  distanceKm: number;
  precision: GeocodePrecision;
  pricePerQuintal: number;
  minPrice: number;
  maxPrice: number;
  arrivalDate: string;
  feedSource: string;
}

export interface DiscoveryResult {
  location: { state?: string; district?: string; village?: string };
  discovered: DiscoveredMandi[];
  skipped: number;
  radiusKm: number;
  feedSource: 'agmarknet' | 'demo-seed' | 'mixed';
  ranking: MandiEngineOutput | null;
  warnings: string[];
}

const EARTH_R = 6371.0088;
const ROAD_FACTOR = 1.32;

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Typical APMC charges when the feed does not carry them. */
const DEFAULT_HANDLING_FEE = 150;
const DEFAULT_LOADING_PER_QTL = 12;
const DEFAULT_COMMISSION_PCT = 1.5;

class MandiDiscoveryService {
  async discover(req: DiscoveryRequest): Promise<DiscoveryResult> {
    const warnings: string[] = [];
    const radiusKm = req.radiusKm ?? Number(process.env.MANDI_SEARCH_RADIUS_KM || 120);
    const maxCandidates = Number(process.env.MANDI_MAX_CANDIDATES || 12);
    const origin = { lat: req.lat, lon: req.lon };

    // ── 1. Where is this farm? ──
    let state = req.state;
    let district = req.district;
    let village: string | undefined;

    if (!state || !district) {
      const rev = await geocoding.reverse(req.lat, req.lon);
      state = state ?? rev.state;
      district = district ?? rev.district;
      village = rev.village;
    }

    if (!state) {
      warnings.push('Could not determine the state from your field location.');
      return {
        location: { state, district, village },
        discovered: [], skipped: 0, radiusKm,
        feedSource: 'demo-seed', ranking: null, warnings,
      };
    }

    // ── 2. Live tickers for the state ──
    const tickers = await swytchcode.getMandiPrices(state, req.crop);
    if (tickers.length === 0) {
      warnings.push(`No price feed found for ${req.crop} in ${state}.`);
      return {
        location: { state, district, village },
        discovered: [], skipped: 0, radiusKm,
        feedSource: 'demo-seed', ranking: null, warnings,
      };
    }

    // Keep the best price per market for the day.
    const byMarket = new Map<string, MandiTicker>();
    for (const t of tickers) {
      const prev = byMarket.get(t.market);
      if (!prev || t.modalPrice > prev.modalPrice) byMarket.set(t.market, t);
    }

    // ── 3. Choose which markets to resolve ──
    // Ordering matters more than count. Sorting purely by price can spend the
    // whole geocoding budget on markets 400 km away, so markets already
    // resolvable for free come first, then the farmer's own district, then
    // price. Distance filtering happens after resolution.
    const homeDistrict = (district ?? '').trim().toLowerCase();

    const ordered = Array.from(byMarket.values())
      .map((t) => {
        const free = (t.lat !== undefined && t.lon !== undefined)
          || GAZETTEER.has(`${t.market.toLowerCase()}|${state!.toLowerCase()}`);
        const local = homeDistrict && t.district.toLowerCase().includes(homeDistrict);
        return { t, rank: (free ? 2 : 0) + (local ? 1 : 0) };
      })
      .sort((a, b) => (b.rank - a.rank) || (b.t.modalPrice - a.t.modalPrice))
      .map((s) => s.t);

    // ── 4. Resolve coordinates and measure ──
    const cacheKey =
      `mandi:disc:${state}:${req.crop}:${req.lat.toFixed(2)}:${req.lon.toFixed(2)}:${radiusKm}`
        .toLowerCase();
    const cached = await cacheGet<DiscoveredMandi[]>(cacheKey);

    const discovered: DiscoveredMandi[] = [];
    let skipped = 0;
    let liveGeocodes = 0;
    // Hard cap on live lookups: each costs about a second of wall time, and a
    // farmer on a weak connection will not wait two minutes for a price list.
    const liveGeocodeBudget = Number(process.env.MANDI_GEOCODE_BUDGET || 8);

    if (cached && cached.length) {
      discovered.push(...cached);
    } else {
      for (const t of ordered) {
        if (discovered.length >= maxCandidates) break;

        let lat = t.lat;
        let lon = t.lon;
        let precision: GeocodePrecision = 'market';

        if (lat === undefined || lon === undefined) {
          const known = GAZETTEER.get(`${t.market.toLowerCase()}|${state.toLowerCase()}`);
          if (known) {
            lat = known.lat;
            lon = known.lon;
            precision = known.precision;
          } else if (liveGeocodes < liveGeocodeBudget) {
            liveGeocodes += 1;
            const geo = await geocoding.forwardMarket(t.market, t.district || district, state);
            if (geo.precision === 'none') { skipped += 1; continue; }
            lat = geo.lat;
            lon = geo.lon;
            precision = geo.precision;
          } else {
            skipped += 1;
            continue;
          }
        }

        const distanceKm = haversineKm(origin, { lat, lon }) * ROAD_FACTOR;
        if (distanceKm > radiusKm) { skipped += 1; continue; }

        discovered.push({
          id: `apmc_${discovered.length + 1}`,
          name: t.market,
          district: t.district,
          lat,
          lon,
          distanceKm: Number(distanceKm.toFixed(1)),
          precision,
          pricePerQuintal: t.modalPrice,
          minPrice: t.minPrice,
          maxPrice: t.maxPrice,
          arrivalDate: t.arrivalDate,
          feedSource: t.source ?? 'agmarknet',
        });
      }

      // 12 hours: prices refresh daily, resolved coordinates never change.
      if (discovered.length) await cacheSet(cacheKey, discovered, 43200);
    }

    if (discovered.length === 0) {
      warnings.push(`No mandis found within ${radiusKm} km. Try widening the search.`);
      return {
        location: { state, district, village },
        discovered: [], skipped, radiusKm,
        feedSource: tickers[0]?.source === 'demo-seed' ? 'demo-seed' : 'agmarknet',
        ranking: null, warnings,
      };
    }

    if (discovered.some((d) => d.precision === 'district')) {
      warnings.push('Some distances are estimated from the district centre — adjust them for an exact figure.');
    }
    if (skipped > 0 && liveGeocodes >= liveGeocodeBudget) {
      warnings.push(`${skipped} more markets were not checked to keep the search fast.`);
    }

    // ── 5. Rank through the C++ engine ──
    const engineInput: MandiEngineInput = {
      origin,
      volumeQuintals: req.volumeQuintals,
      crop: req.crop,
      localPricePerQuintal: req.localPricePerQuintal,
      vehicle: req.vehicle,
      mandis: discovered.map((d) => ({
        id: d.id,
        name: d.name,
        district: d.district,
        distanceKm: d.distanceKm,
        pricePerQuintal: d.pricePerQuintal,
        handlingFee: DEFAULT_HANDLING_FEE,
        loadingChargePerQuintal: DEFAULT_LOADING_PER_QTL,
        commissionPct: DEFAULT_COMMISSION_PCT,
      })),
    };

    let ranking: MandiEngineOutput | null = null;
    try {
      ranking = await runMandiEngine(engineInput);
    } catch (err) {
      warnings.push(`Ranking engine unavailable: ${(err as Error).message}`);
    }

    const sources = new Set(discovered.map((d) => d.feedSource));
    const feedSource: DiscoveryResult['feedSource'] =
      sources.size > 1 ? 'mixed' : (sources.has('demo-seed') ? 'demo-seed' : 'agmarknet');

    return {
      location: { state, district, village },
      discovered,
      skipped,
      radiusKm,
      feedSource,
      ranking,
      warnings,
    };
  }
}

export const mandiDiscovery = new MandiDiscoveryService();