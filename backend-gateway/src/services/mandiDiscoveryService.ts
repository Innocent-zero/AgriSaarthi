/**
 * Automatic mandi discovery.
 *
 * From farm coordinates alone:
 *   1. reverse-geocode to state and district
 *   2. pull live APMC tickers for that state via Swytchcode
 *   3. geocode each market and compute real road-adjusted distance
 *   4. drop markets outside the search radius, keep the best by price
 *   5. hand the candidates to the C++ engine for net-profit ranking
 *
 * The farmer supplies a crop and a volume. Nothing else.
 */
import { swytchcode, MandiTicker } from './swytchcodeService';
import { geocoding, GeocodePrecision } from './geocodingService';
import { runMandiEngine, MandiEngineInput, MandiEngineOutput } from './mandiEngineBridge';
import { cacheGet, cacheSet } from '../config/redis';

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

    if (!state) {
      const rev = await geocoding.reverse(req.lat, req.lon);
      state = rev.state;
      district = district ?? rev.district;
      village = rev.village;
      if (!state) {
        warnings.push('Could not determine the state from your field location.');
      }
    }

    if (!state) {
      return {
        location: { state, district, village },
        discovered: [],
        skipped: 0,
        radiusKm,
        feedSource: 'demo-seed',
        ranking: null,
        warnings,
      };
    }

    // ── 2. Live tickers for the state ──
    const tickers = await swytchcode.getMandiPrices(state, req.crop);
    if (tickers.length === 0) {
      warnings.push(`No live price feed found for ${req.crop} in ${state}.`);
      return {
        location: { state, district, village },
        discovered: [],
        skipped: 0,
        radiusKm,
        feedSource: 'demo-seed',
        ranking: null,
        warnings,
      };
    }

    // Keep the best price per market for the day.
    const byMarket = new Map<string, MandiTicker>();
    for (const t of tickers) {
      const prev = byMarket.get(t.market);
      if (!prev || t.modalPrice > prev.modalPrice) byMarket.set(t.market, t);
    }

    // ── 3. Geocode and measure ──
    // Geocoding is rate-limited to 1/sec, so cap how many we resolve. Sort by
    // price first: a high-priced market far away is still worth evaluating,
    // whereas a cheap one nearby will lose on net profit anyway.
    const ordered = Array.from(byMarket.values())
      .sort((a, b) => b.modalPrice - a.modalPrice)
      .slice(0, maxCandidates * 2);

    const discovered: DiscoveredMandi[] = [];
    let skipped = 0;

    // Cache the resolved set so repeat visits are instant.
    const cacheKey = `mandi:disc:${state}:${req.crop}:${req.lat.toFixed(2)}:${req.lon.toFixed(2)}`.toLowerCase();
    const cached = await cacheGet<DiscoveredMandi[]>(cacheKey);

    if (cached && cached.length) {
      discovered.push(...cached);
    } else {
      for (const t of ordered) {
        let lat = t.lat;
        let lon = t.lon;
        let precision: GeocodePrecision = 'market';

        // Seed data ships with coordinates; only live AGMARKNET rows need a
        // geocoding round-trip, and each one costs a second of rate limit.
        if (lat === undefined || lon === undefined) {
          const geo = await geocoding.forwardMarket(t.market, t.district || district, state);
          if (geo.precision === 'none') { skipped += 1; continue; }
          lat = geo.lat;
          lon = geo.lon;
          precision = geo.precision;
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

        if (discovered.length >= maxCandidates) break;
      }
      // 12 hours: prices refresh daily, geocodes essentially never.
      if (discovered.length) await cacheSet(cacheKey, discovered, 43200);
    }

    if (discovered.length === 0) {
      warnings.push(`No mandis found within ${radiusKm} km. Try widening the search.`);
      return {
        location: { state, district, village },
        discovered: [],
        skipped,
        radiusKm,
        feedSource: tickers[0]?.source === 'demo-seed' ? 'demo-seed' : 'agmarknet',
        ranking: null,
        warnings,
      };
    }

    if (discovered.some((d) => d.precision === 'district')) {
      warnings.push('Some distances are estimated from the district centre — adjust them for an exact figure.');
    }

    // ── 4. Rank through the C++ engine ──
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