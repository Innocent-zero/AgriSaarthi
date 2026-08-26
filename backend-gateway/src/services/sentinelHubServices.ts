/**
 * Sentinel Hub — NDVI time series via the Statistical API.
 *
 * One request returns several years of cloud-masked NDVI statistics aggregated
 * over the farmer's field polygon. From that we derive:
 *   - current vegetation vigour
 *   - a phenology-aware baseline (same calendar window, previous years)
 *   - an anomaly z-score
 *   - a short-term trend slope
 *
 * Phenology matters: NDVI 0.35 is alarming in mid-season and completely normal
 * two weeks after sowing. Comparing against the same calendar window in prior
 * years is what makes the number mean something.
 */
import axios, { AxiosInstance } from 'axios';
import { withCache } from '../config/redis';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface NdviPoint {
  from: string;          // ISO date, interval start
  to: string;
  mean: number;
  min: number;
  max: number;
  stDev: number;
  validPixelPct: number; // 0–100, how much of the field was cloud-free
}

export interface NdviAnalysis {
  available: boolean;
  mixedPixels?: boolean;
  reason?: string;
  series: NdviPoint[];          // full history, oldest first
  current: NdviPoint | null;    // most recent usable observation
  previous: NdviPoint | null;   // the observation before that
  baselineMean: number | null;  // same calendar window, prior years
  baselineStDev: number | null;
  baselineSamples: number;
  anomaly: number | null;       // current.mean − baselineMean
  anomalyZ: number | null;      // anomaly ÷ baselineStDev
  trendPerInterval: number | null; // least-squares slope over recent points
  dropFromPeakPct: number | null;  // decline from this season's peak
  seasonPeak: NdviPoint | null;
  source: 'sentinel-hub';
  fetchedAt: string;
}

// Cloud/shadow/snow classes in the Sentinel-2 Scene Classification Layer.
// Excluding these is what separates a real NDVI drop from a passing cloud.
const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  // 0 no-data, 1 saturated, 3 shadow, 7 low-prob cloud/haze,
  // 8 medium cloud, 9 high cloud, 10 thin cirrus, 11 snow.
  // 7 and 10 are included deliberately: haze depresses NDVI and would
  // otherwise read as crop damage in an insurance claim.
  var bad = [0, 1, 3, 7, 8, 9, 10, 11];
  var valid = s.dataMask;
  for (var i = 0; i < bad.length; i++) {
    if (s.SCL === bad[i]) { valid = 0; break; }
  }
  var denom = s.B08 + s.B04;
  var ndvi = denom === 0 ? 0 : (s.B08 - s.B04) / denom;
  return { ndvi: [ndvi], dataMask: [valid] };
}`

const MIN_VALID_PCT = 40;      // below this the interval is too cloudy to trust
const TREND_WINDOW = 4;        // intervals used for the slope
const DOY_WINDOW = 18;         // ± days when matching the calendar window

class SentinelHubService {
  private readonly client: AxiosInstance;
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor() {
    this.client = axios.create({ timeout: 45_000 });
  }

  get configured(): boolean {
    return Boolean(process.env.SENTINEL_CLIENT_ID && process.env.SENTINEL_CLIENT_SECRET);
  }

  // ─────────────── auth ───────────────
  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry - 60_000) return this.token;

    const url = process.env.SENTINEL_AUTH_URL
      || 'https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token';

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SENTINEL_CLIENT_ID as string,
      client_secret: process.env.SENTINEL_CLIENT_SECRET as string,
    });

    const { data } = await this.client.post(url, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!data?.access_token) throw new Error('Sentinel Hub returned no access token');
    this.token = data.access_token as string;
    this.tokenExpiry = Date.now() + Number(data.expires_in ?? 3600) * 1000;
    return this.token;
  }

  // ─────────────── geometry ───────────────
  /**
   * Sentinel Hub wants a closed GeoJSON ring in lon,lat order. When the farmer
   * has not drawn a boundary we synthesise a small square around the centroid
   * so the field still gets analysed — roughly a hectare, which is a fair
   * default for a smallholding.
   */
  private buildPolygon(boundary: LatLon[] | undefined, centre: LatLon): number[][] {
    if (boundary && boundary.length >= 3) {
      const ring = boundary.map((p) => [p.lon, p.lat]);
      const [fx, fy] = ring[0];
      const [lx, ly] = ring[ring.length - 1];
      if (fx !== lx || fy !== ly) ring.push([fx, fy]);
      return ring;
    }

    const half = 0.0005; // ~55 m at Indian latitudes → ~1.2 ha
    const latPad = half;
    const lonPad = half / Math.max(0.2, Math.cos((centre.lat * Math.PI) / 180));
    return [
      [centre.lon - lonPad, centre.lat - latPad],
      [centre.lon + lonPad, centre.lat - latPad],
      [centre.lon + lonPad, centre.lat + latPad],
      [centre.lon - lonPad, centre.lat + latPad],
      [centre.lon - lonPad, centre.lat - latPad],
    ];
  }

  // ─────────────── public entry ───────────────
  async getNdviAnalysis(centre: LatLon, boundary?: LatLon[]): Promise<NdviAnalysis> {
    const empty = (reason: string): NdviAnalysis => ({
      available: false,
      reason,
      series: [],
      current: null,
      previous: null,
      baselineMean: null,
      baselineStDev: null,
      baselineSamples: 0,
      anomaly: null,
      anomalyZ: null,
      trendPerInterval: null,
      dropFromPeakPct: null,
      seasonPeak: null,
      source: 'sentinel-hub',
      fetchedAt: new Date().toISOString(),
    });

    if (!this.configured) return empty('SENTINEL_CLIENT_ID / SECRET not configured');

    const key = `ndvi:${centre.lat.toFixed(4)}:${centre.lon.toFixed(4)}:${boundary?.length ?? 0}`;
    const ttl = Number(process.env.CACHE_TTL_NDVI || 21600);

    try {
      const { data } = await withCache<NdviAnalysis>(key, ttl, async () => {
        const series = await this.fetchSeries(centre, boundary);
        return this.analyse(series);
      });
      return data;
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status ?? ''} ${JSON.stringify(err.response?.data ?? err.message).slice(0, 300)}`
        : (err as Error).message;
      console.warn('[sentinel] NDVI fetch failed:', msg);
      return empty(`Sentinel Hub request failed: ${msg}`);
    }
  }

  private async fetchSeries(centre: LatLon, boundary?: LatLon[]): Promise<NdviPoint[]> {
    const token = await this.getToken();
    const years = Number(process.env.SENTINEL_HISTORY_YEARS || 3);

    const to = new Date();
    const from = new Date(to.getTime() - years * 365 * 86_400_000);

    const payload = {
      input: {
        bounds: {
          geometry: { type: 'Polygon', coordinates: [this.buildPolygon(boundary, centre)] },
          properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
        },
        data: [{
          type: 'sentinel-2-l2a',
          dataFilter: { mosaickingOrder: 'leastCC' },
        }],
      },
      aggregation: {
        timeRange: {
          from: `${from.toISOString().slice(0, 10)}T00:00:00Z`,
          to: `${to.toISOString().slice(0, 10)}T23:59:59Z`,
        },
        aggregationInterval: { of: process.env.SENTINEL_INTERVAL || 'P10D' },
        evalscript: EVALSCRIPT,
        // ~10 m ground resolution, matching Sentinel-2's native red/NIR bands.
        resx: 0.0001,
        resy: 0.0001,
      },
      calculations: { ndvi: { statistics: { default: {} } } },
    };

    const url = process.env.SENTINEL_STATS_URL || 'https://services.sentinel-hub.com/api/v1/statistics';
    const { data } = await this.client.post(url, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    const intervals: any[] = data?.data ?? [];
    const points: NdviPoint[] = [];

    for (const iv of intervals) {
      const stats = iv?.outputs?.ndvi?.bands?.B0?.stats;
      if (!stats) continue;

      const sampled = Number(stats.sampleCount ?? 0);
      const noData = Number(stats.noDataCount ?? 0);
      const valid = sampled - noData;
      if (sampled <= 0 || valid <= 0) continue;

      const validPct = (valid / sampled) * 100;
      if (validPct < MIN_VALID_PCT) continue;   // too cloudy to be meaningful

      const mean = Number(stats.mean);
      if (!Number.isFinite(mean)) continue;

      points.push({
        from: String(iv.interval?.from ?? '').slice(0, 10),
        to: String(iv.interval?.to ?? '').slice(0, 10),
        mean: Number(mean.toFixed(4)),
        min: Number(Number(stats.min ?? mean).toFixed(4)),
        max: Number(Number(stats.max ?? mean).toFixed(4)),
        stDev: Number(Number(stats.stDev ?? 0).toFixed(4)),
        validPixelPct: Number(validPct.toFixed(1)),
      });
    }

    points.sort((a, b) => a.from.localeCompare(b.from));
    return points;
  }

  // ─────────────── analysis ───────────────
  private dayOfYear(iso: string): number {
    const d = new Date(`${iso}T00:00:00Z`);
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor((d.getTime() - start) / 86_400_000) + 1;
  }

  /** Circular day-of-year distance, so 5 Jan and 28 Dec are 8 days apart. */
  private doyDistance(a: number, b: number): number {
    const raw = Math.abs(a - b);
    return Math.min(raw, 365 - raw);
  }

  private analyse(series: NdviPoint[]): NdviAnalysis {
    const base: NdviAnalysis = {
      available: series.length > 0,
      series,
      current: null,
      previous: null,
      baselineMean: null,
      baselineStDev: null,
      baselineSamples: 0,
      anomaly: null,
      anomalyZ: null,
      trendPerInterval: null,
      dropFromPeakPct: null,

      seasonPeak: null,
      source: 'sentinel-hub',
      fetchedAt: new Date().toISOString(),
    };

    if (series.length === 0) {
      base.reason = 'No cloud-free Sentinel-2 observations in the requested window';
      return base;
    }

    const current = series[series.length - 1];
    base.current = current;
    if (current.stDev > 0.18 || current.mean < 0.2) {
      base.mixedPixels = true;
      base.reason = current.mean < 0.2
        ? `Mean NDVI ${current.mean.toFixed(2)} indicates bare or built-up land rather than a standing crop.`
        : `High variation within the field (σ ${current.stDev.toFixed(2)}) suggests the boundary includes non-crop area.`;
    }
    base.previous = series.length >= 2 ? series[series.length - 2] : null;

    // ── phenology-aware baseline: same calendar window, earlier years ──
    const curDoy = this.dayOfYear(current.from);
    const curYear = current.from.slice(0, 4);
    const matches = series.filter(
      (p) => p.from.slice(0, 4) !== curYear &&
             this.doyDistance(this.dayOfYear(p.from), curDoy) <= DOY_WINDOW,
    );

    if (matches.length >= 2) {
      const values = matches.map((p) => p.mean);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
      const sd = Math.sqrt(variance);

      base.baselineMean = Number(mean.toFixed(4));
      base.baselineStDev = Number(sd.toFixed(4));
      base.baselineSamples = matches.length;
      base.anomaly = Number((current.mean - mean).toFixed(4));
      // Floor the divisor: a near-zero historical spread would otherwise
      // manufacture an enormous z-score from a trivial difference.
      base.anomalyZ = Number((base.anomaly / Math.max(sd, 0.03)).toFixed(2));
    }

    // ── short-term trend: least-squares slope over recent intervals ──
    const recent = series.slice(-TREND_WINDOW);
    if (recent.length >= 3) {
      const n = recent.length;
      const xMean = (n - 1) / 2;
      const yMean = recent.reduce((s, p) => s + p.mean, 0) / n;
      let num = 0;
      let den = 0;
      recent.forEach((p, i) => {
        num += (i - xMean) * (p.mean - yMean);
        den += (i - xMean) ** 2;
      });
      base.trendPerInterval = den === 0 ? 0 : Number((num / den).toFixed(4));
    }

    // ── decline from this season's peak (last 150 days) ──
    const cutoff = new Date(Date.now() - 150 * 86_400_000).toISOString().slice(0, 10);
    const season = series.filter((p) => p.from >= cutoff);
    if (season.length >= 2) {
      const peak = season.reduce((a, b) => (b.mean > a.mean ? b : a), season[0]);
      base.seasonPeak = peak;
      if (peak.mean > 0.05 && peak.from < current.from) {
        base.dropFromPeakPct = Number((((peak.mean - current.mean) / peak.mean) * 100).toFixed(1));
      } else {
        base.dropFromPeakPct = 0;
      }
    }

    return base;
  }

  /**
   * Pre/post NDVI pair around a damage event, for the PMFBY passbook.
   * Replaces the hardcoded 0.68 / 0.34 placeholders with observed values.
   */
  async getEventPair(
    centre: LatLon,
    boundary: LatLon[] | undefined,
    eventDateIso: string,
  ): Promise<{
    pre: NdviPoint | null;
    post: NdviPoint | null;
    lossPct: number | null;
    usable: boolean;
    reason?: string;
  }> {
    const analysis = await this.getNdviAnalysis(centre, boundary);
    if (!analysis.available) {
      return { pre: null, post: null, lossPct: null, usable: false, reason: analysis.reason };
    }

    const event = eventDateIso.slice(0, 10);
    const before = analysis.series.filter((p) => p.to <= event);
    const after = analysis.series.filter((p) => p.from >= event);

    const pre = before.length ? before[before.length - 1] : null;
    const post = after.length ? after[0] : null;

    if (!pre || !post) {
      return {
        pre, post, lossPct: null, usable: false,
        reason: !post
          ? 'No cloud-free image yet after the event date. Sentinel-2 cannot see through monsoon cloud — try again in a few days.'
          : 'No cloud-free image found before the event date.',
      };
    }

    // Below ~0.25 the polygon is mostly bare soil or built-up land, not crop.
    // A percentage decline computed from that baseline is meaningless, and
    // putting it in an insurance passbook would misrepresent the evidence.
    if (pre.mean < 0.25) {
      return {
        pre, post, lossPct: null, usable: false,
        reason: `Pre-event NDVI of ${pre.mean.toFixed(2)} is too low to represent a standing crop. Draw your field boundary precisely and try again.`,
      };
    }

    // Gaps beyond ~40 days mean the "decline" is mostly normal phenology.
    const gapDays = Math.round(
      (new Date(post.from).getTime() - new Date(pre.to).getTime()) / 86_400_000,
    );
    if (gapDays > 40) {
      return {
        pre, post, lossPct: null, usable: false,
        reason: `The nearest clear images are ${gapDays} days apart, too far to attribute the change to this event.`,
      };
    }

    return {
      pre,
      post,
      lossPct: Number((((pre.mean - post.mean) / pre.mean) * 100).toFixed(1)),
      usable: true,
    };
  }
}
export const sentinelHub = new SentinelHubService();