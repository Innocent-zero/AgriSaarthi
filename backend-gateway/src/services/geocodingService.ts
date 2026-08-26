/**
 * Geocoding via OpenStreetMap Nominatim.
 *
 * Two jobs:
 *   1. Reverse — farm coordinates → state and district, so the farmer never
 *      types their state. This is what makes mandi discovery zero-input.
 *   2. Forward — AGMARKNET market names → coordinates, so the C++ engine gets
 *      real distances instead of the farmer measuring them by hand.
 *
 * Nominatim's usage policy caps requests at one per second and requires a
 * User-Agent identifying the application. Both are honoured below. Results are
 * cached hard because market locations never move; at production scale this
 * should move to a self-hosted Nominatim or a commercial geocoder.
 */
import axios, { AxiosInstance } from 'axios';
import { cacheGet, cacheSet } from '../config/redis';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface ReverseResult {
  state?: string;
  district?: string;
  subDistrict?: string;
  village?: string;
  displayName?: string;
}

export type GeocodePrecision = 'market' | 'district' | 'none';

export interface ForwardResult {
  lat: number;
  lon: number;
  precision: GeocodePrecision;
  matchedName?: string;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const CACHE_TTL_REVERSE = 30 * 86400;   // 30 days — a farm does not change district
const CACHE_TTL_FORWARD = 180 * 86400;  // 180 days — mandis do not move
const MIN_INTERVAL_MS = 1100;           // Nominatim policy: ≤ 1 req/sec

class GeocodingService {
  private readonly client: AxiosInstance;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;

  constructor() {
    this.client = axios.create({
      baseURL: NOMINATIM,
      timeout: 15000,
      headers: {
        'User-Agent': process.env.NOMINATIM_USER_AGENT
          || 'AgriSaarthi/1.0 (agricultural advisory for Indian smallholders)',
        'Accept-Language': 'en',
      },
    });
  }

  /**
   * Serialises every request through a single chain with a minimum gap.
   * Without this, geocoding twenty markets in parallel would breach the
   * policy and get the IP blocked.
   */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = MIN_INTERVAL_MS - (Date.now() - this.lastCall);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      return fn();
    });
    // Keep the chain alive even when one call rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ─────────────── reverse ───────────────
  async reverse(lat: number, lon: number): Promise<ReverseResult> {
    const key = `geo:rev:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const hit = await cacheGet<ReverseResult>(key);
    if (hit) return hit;

    try {
      const { data } = await this.schedule(() =>
        this.client.get('/reverse', {
          params: { lat, lon, format: 'jsonv2', zoom: 10, addressdetails: 1 },
        }),
      );

      const a = data?.address ?? {};
      const result: ReverseResult = {
        state: a.state,
        // Nominatim's district key varies by country and admin level.
        district: a.state_district || a.district || a.county,
        subDistrict: a.county || a.suburb,
        village: a.village || a.town || a.city || a.hamlet,
        displayName: data?.display_name,
      };

      await cacheSet(key, result, CACHE_TTL_REVERSE);
      return result;
    } catch (err) {
      console.warn('[geocode] reverse failed:', (err as Error).message);
      return {};
    }
  }

  // ─────────────── forward ───────────────
  /**
   * Resolve a market to coordinates. Falls back to the district centroid when
   * the specific market is not findable, and reports which happened — a
   * district-centroid distance is an estimate and the UI must say so rather
   * than presenting it as a measured figure.
   */
  async forwardMarket(
    market: string,
    district?: string,
    state?: string,
  ): Promise<ForwardResult> {
    const key = `geo:fwd:${[market, district, state].filter(Boolean).join('|')}`.toLowerCase();
    const hit = await cacheGet<ForwardResult>(key);
    if (hit) return hit;

    const cleaned = market
      .replace(/\b(apmc|mandi samiti|mandi|market|yard|krishi upaj)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const attempts: Array<{ q: string; precision: GeocodePrecision }> = [
      { q: [market, district, state, 'India'].filter(Boolean).join(', '), precision: 'market' },
      { q: [`${cleaned} mandi`, district, state, 'India'].filter(Boolean).join(', '), precision: 'market' },
      { q: [cleaned, district, state, 'India'].filter(Boolean).join(', '), precision: 'market' },
    ];
    if (district) {
      attempts.push({ q: [district, state, 'India'].filter(Boolean).join(', '), precision: 'district' });
    }

    for (const attempt of attempts) {
      try {
        const { data } = await this.schedule(() =>
          this.client.get('/search', {
            params: { q: attempt.q, format: 'jsonv2', limit: 1, countrycodes: 'in' },
          }),
        );
        const first = Array.isArray(data) ? data[0] : null;
        if (!first) continue;

        const result: ForwardResult = {
          lat: Number(first.lat),
          lon: Number(first.lon),
          precision: attempt.precision,
          matchedName: String(first.display_name ?? '').split(',').slice(0, 2).join(','),
        };
        if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon)) continue;

        await cacheSet(key, result, CACHE_TTL_FORWARD);
        return result;
      } catch {
        /* try the next formulation */
      }
    }

    const miss: ForwardResult = { lat: 0, lon: 0, precision: 'none' };
    // Short TTL on misses so a transient outage does not poison the cache.
    await cacheSet(key, miss, 3600);
    return miss;
  }
}

export const geocoding = new GeocodingService();