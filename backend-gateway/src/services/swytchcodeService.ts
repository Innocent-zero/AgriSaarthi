/**
 * Data Execution Service — LOCAL MODE.
 *
 * In production this layer routes through Swytchcode. For local development we
 * call the providers directly: Open-Meteo (keyless), SoilGrids (keyless) and
 * data.gov.in AGMARKNET (falls back to bundled seed tickers when no key is set).
 *
 * The public surface (getWeather / getSoil / getMandiPrices) is identical to the
 * Swytchcode-backed version, so swapping back is a one-file change.
 */
import axios from 'axios';
import { withCache } from '../config/redis';
import { sentinelHub, NdviAnalysis, LatLon } from './sentinelHubServices';

export interface Localised {
  code: string;
  params?: Record<string, string | number>;
}

export interface WeatherSnapshot {
  latitude: number;
  longitude: number;
  current: {
    temperatureC: number;
    humidityPct: number;
    windSpeedKmh: number;
    precipitationMm: number;
    weatherCode: number;
  };
  daily: Array<{
    date: string;
    tMaxC: number;
    tMinC: number;
    rainMm: number;
    rainProbPct: number;
    windMaxKmh: number;
  }>;
  advisories: Localised[];
  source: 'open-meteo';
}

export interface SoilSnapshot {
  latitude: number;
  longitude: number;
  phH2O: number;
  organicCarbonGkg: number;
  nitrogenGkg: number;
  clayPct: number;
  sandPct: number;
  siltPct: number;
  cecCmolKg: number;
  texture: string;
  source: 'soilgrids' | 'regional-default';
}

export interface MandiTicker {
  market: string;
  district: string;
  state: string;
  commodity: string;
  variety: string;
  minPrice: number;
  maxPrice: number;
  modalPrice: number;
  arrivalDate: string;
  source?: 'agmarknet' | 'demo-seed';
}

const TIMEOUT = 12000;

/**
 * Demo seed tickers used only when DATA_GOV_IN_API_KEY is blank.
 * Prices are representative 2026 modal ranges, NOT live quotes — every response
 * carries source:'demo-seed' so the UI and your demo script can say so plainly.
 */
const SEED_TICKERS: Record<string, Array<{ market: string; district: string; modal: number }>> = {
  wheat: [
    { market: 'Sitapur APMC', district: 'Sitapur', modal: 2385 },
    { market: 'Lucknow Grain Mandi', district: 'Lucknow', modal: 2310 },
    { market: 'Kanpur Anaj Mandi', district: 'Kanpur Nagar', modal: 2440 },
    { market: 'Hardoi Mandi Samiti', district: 'Hardoi', modal: 2290 },
    { market: 'Barabanki APMC', district: 'Barabanki', modal: 2355 },
  ],
  rice: [
    { market: 'Lucknow Grain Mandi', district: 'Lucknow', modal: 3120 },
    { market: 'Raebareli APMC', district: 'Raebareli', modal: 3040 },
    { market: 'Gonda Mandi Samiti', district: 'Gonda', modal: 3210 },
    { market: 'Sitapur APMC', district: 'Sitapur', modal: 2980 },
  ],
  paddy: [
    { market: 'Gonda Mandi Samiti', district: 'Gonda', modal: 2180 },
    { market: 'Sitapur APMC', district: 'Sitapur', modal: 2115 },
    { market: 'Barabanki APMC', district: 'Barabanki', modal: 2240 },
  ],
  maize: [
    { market: 'Kanpur Anaj Mandi', district: 'Kanpur Nagar', modal: 2050 },
    { market: 'Unnao Mandi', district: 'Unnao', modal: 1975 },
    { market: 'Lucknow Grain Mandi', district: 'Lucknow', modal: 2120 },
  ],
  mustard: [
    { market: 'Hardoi Mandi Samiti', district: 'Hardoi', modal: 5680 },
    { market: 'Sitapur APMC', district: 'Sitapur', modal: 5520 },
    { market: 'Lakhimpur Mandi', district: 'Kheri', modal: 5790 },
  ],
  potato: [
    { market: 'Agra Potato Mandi', district: 'Agra', modal: 1180 },
    { market: 'Farrukhabad Mandi', district: 'Farrukhabad', modal: 1095 },
    { market: 'Kanpur Anaj Mandi', district: 'Kanpur Nagar', modal: 1260 },
  ],
  cotton: [
    { market: 'Kanpur Cotton Yard', district: 'Kanpur Nagar', modal: 7420 },
    { market: 'Jhansi APMC', district: 'Jhansi', modal: 7180 },
  ],
  sugarcane: [
    { market: 'Lakhimpur Mandi', district: 'Kheri', modal: 370 },
    { market: 'Sitapur APMC', district: 'Sitapur', modal: 358 },
  ],
  soybean: [
    { market: 'Jhansi APMC', district: 'Jhansi', modal: 4630 },
    { market: 'Lalitpur Mandi', district: 'Lalitpur', modal: 4510 },
  ],
};

class DataExecutionService {
  /** Kept for API compatibility with the Swytchcode-backed build. */
  readonly mode = 'direct' as const;

  // ─────────────────────────── Weather ───────────────────────────
  async getWeather(lat: number, lon: number): Promise<WeatherSnapshot> {
    const ttl = Number(process.env.CACHE_TTL_WEATHER || 1800);
    const key = `wx:     ${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const { data } = await withCache<WeatherSnapshot>(key, ttl, async () => {
      const raw = await this.fetchOpenMeteo(lat, lon);
      return this.normaliseWeather(raw, lat, lon);
    });
    return data;
  }

  private async fetchOpenMeteo(lat: number, lon: number): Promise<Record<string, unknown>> {
    const url = process.env.OPEN_METEO_URL || 'https://api.open-meteo.com/v1/forecast';
    const { data } = await axios.get(url, {
      timeout: TIMEOUT,
      params: {
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code',
        daily:
          'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
        timezone: 'Asia/Kolkata',
        forecast_days: 7,
      },
    });
    return data as Record<string, unknown>;
  }

  private normaliseWeather(raw: Record<string, any>, lat: number, lon: number): WeatherSnapshot {
    const cur = raw?.current ?? {};
    const d = raw?.daily ?? {};
    const days: WeatherSnapshot['daily'] = (d.time ?? []).map((date: string, i: number) => ({
      date,
      tMaxC: Number(d.temperature_2m_max?.[i] ?? 0),
      tMinC: Number(d.temperature_2m_min?.[i] ?? 0),
      rainMm: Number(d.precipitation_sum?.[i] ?? 0),
      rainProbPct: Number(d.precipitation_probability_max?.[i] ?? 0),
      windMaxKmh: Number(d.wind_speed_10m_max?.[i] ?? 0),
    }));

    const snapshot: WeatherSnapshot = {
      latitude: lat,
      longitude: lon,
      current: {
        temperatureC: Number(cur.temperature_2m ?? 0),
        humidityPct: Number(cur.relative_humidity_2m ?? 0),
        windSpeedKmh: Number(cur.wind_speed_10m ?? 0),
        precipitationMm: Number(cur.precipitation ?? 0),
        weatherCode: Number(cur.weather_code ?? 0),
      },
      daily: days,
      advisories: [],
      source: 'open-meteo',
    };
    snapshot.advisories = this.deriveAdvisories(snapshot);
    return snapshot;
  }

  /** Raw metrics → operational instructions with a financial consequence. */
  /**
   * Emits translation CODES, never prose. The client renders them in the
   * farmer's language — this is why advisories translate correctly.
   */
  private deriveAdvisories(w: WeatherSnapshot): Localised[] {
    const out: Localised[] = [];
    const next48 = w.daily.slice(0, 2);
    const rain48 = next48.reduce((s, d) => s + d.rainMm, 0);
    const maxProb48 = Math.max(0, ...next48.map((d) => d.rainProbPct));
    const maxWind = Math.max(0, ...w.daily.slice(0, 3).map((d) => d.windMaxKmh));
    const maxTemp = Math.max(0, ...w.daily.slice(0, 3).map((d) => d.tMaxC));

    if (rain48 >= 10 || maxProb48 >= 70) {
      out.push({ code: 'wx.delayUrea', params: { rain: rain48.toFixed(0) } });
      out.push({ code: 'wx.skipIrrigation' });
    } else if (rain48 < 2 && maxTemp > 35) {
      out.push({ code: 'wx.irrigateEarly' });
    }
    if (maxWind >= 25) {
      out.push({ code: 'wx.windNoSpray', params: { wind: maxWind.toFixed(0) } });
    }
    if (w.current.humidityPct >= 80 && w.current.temperatureC >= 22 && w.current.temperatureC <= 32) {
      out.push({ code: 'wx.blightRisk' });
    }
    if (maxTemp >= 40) {
      out.push({ code: 'wx.heatStress' });
    }
    if (out.length === 0) {
      out.push({ code: 'wx.stable' });
    }
    return out;
  }

  // ─────────────────────────── Soil ───────────────────────────
  async getSoil(lat: number, lon: number): Promise<SoilSnapshot> {
    const ttl = Number(process.env.CACHE_TTL_SOIL || 604800);
    const key = `soil:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const { data } = await withCache<SoilSnapshot>(key, ttl, async () => {
      try {
        const raw = await this.fetchSoilGrids(lat, lon);
        return this.normaliseSoil(raw, lat, lon);
      } catch (err) {
        // SoilGrids rate-limits aggressively and occasionally times out. A typical
        // Indo-Gangetic alluvial profile keeps the NPK calculator usable meanwhile.
        console.warn('[soil] SoilGrids unavailable, using regional default:', (err as Error).message);
        return this.regionalDefault(lat, lon);
      }
    });
    return data;
  }

  private async fetchSoilGrids(lat: number, lon: number): Promise<Record<string, unknown>> {
    const url = process.env.SOILGRIDS_URL || 'https://rest.isric.org/soilgrids/v2.0/properties/query';
    const { data } = await axios.get(url, {
      timeout: TIMEOUT,
      params: {
        lat,
        lon,
        property: ['phh2o', 'soc', 'nitrogen', 'clay', 'sand', 'silt', 'cec'],
        depth: '0-5cm',
        value: 'mean',
      },
      paramsSerializer: { indexes: null }, // repeat `property=` per entry
    });
    return data as Record<string, unknown>;
  }

  private normaliseSoil(raw: Record<string, any>, lat: number, lon: number): SoilSnapshot {
    const layers: any[] = raw?.properties?.layers ?? [];
    const read = (name: string, divisor: number): number => {
      const layer = layers.find((l) => l.name === name);
      const mean = layer?.depths?.[0]?.values?.mean;
      return typeof mean === 'number' ? mean / divisor : 0;
    };

    // SoilGrids ships integer-scaled values; divisors restore physical units.
    const clay = read('clay', 10);
    const sand = read('sand', 10);
    const silt = read('silt', 10);

    return {
      latitude: lat,
      longitude: lon,
      phH2O: Number(read('phh2o', 10).toFixed(2)) || 6.8,
      organicCarbonGkg: Number(read('soc', 10).toFixed(2)) || 6.0,
      nitrogenGkg: Number(read('nitrogen', 100).toFixed(3)) || 0.6,
      clayPct: Number(clay.toFixed(1)) || 22,
      sandPct: Number(sand.toFixed(1)) || 45,
      siltPct: Number(silt.toFixed(1)) || 33,
      cecCmolKg: Number(read('cec', 10).toFixed(1)) || 14,
      texture: this.classifyTexture(sand || 45, clay || 22),
      source: 'soilgrids',
    };
  }

  private regionalDefault(lat: number, lon: number): SoilSnapshot {
    return {
      latitude: lat,
      longitude: lon,
      phH2O: 7.4,
      organicCarbonGkg: 5.2,
      nitrogenGkg: 0.55,
      clayPct: 24,
      sandPct: 43,
      siltPct: 33,
      cecCmolKg: 15.5,
      texture: this.classifyTexture(43, 24),
      source: 'regional-default',
    };
  }

  private classifyTexture(sand: number, clay: number): string {
    if (clay >= 40) return 'soil.clay';
    if (sand >= 70) return 'soil.sandy';
    if (clay >= 27) return 'soil.clayLoam';
    if (sand >= 52) return 'soil.sandyLoam';
    return 'soil.loam';
  }

  // ─────────────────────────── Satellite NDVI ───────────────────────────
  /**
   * Delegated to Sentinel Hub. Kept on this facade so every external data
   * source is reached through one object — when Swytchcode access arrives,
   * only the body of this method changes.
   */
  async getNdvi(centre: LatLon, boundary?: LatLon[]): Promise<NdviAnalysis> {
    return sentinelHub.getNdviAnalysis(centre, boundary);
  }

  // ─────────────────────────── Mandi prices ───────────────────────────
  async getMandiPrices(state: string, commodity: string, district?: string): Promise<MandiTicker[]> {
    const ttl = Number(process.env.CACHE_TTL_MANDI || 3600);
    const key = `mandi:${state}:${district ?? 'all'}:${commodity}`.toLowerCase();
    const { data } = await withCache<MandiTicker[]>(key, ttl, async () => {
      if (!process.env.DATA_GOV_IN_API_KEY) {
        return this.seedTickers(state, commodity, district);
      }
      try {
        const raw = await this.fetchAgmarknet(state, commodity, district);
        const live = this.normaliseTickers(raw);
        return live.length > 0 ? live : this.seedTickers(state, commodity, district);
      } catch (err) {
        console.warn('[mandi] AGMARKNET unavailable, using seed data:', (err as Error).message);
        return this.seedTickers(state, commodity, district);
      }
    });
    return data;
  }

  private async fetchAgmarknet(
    state: string,
    commodity: string,
    district?: string,
  ): Promise<Record<string, unknown>> {
    const resource = process.env.DATA_GOV_MANDI_RESOURCE || '9ef84268-d588-465a-a308-a864a43d0070';
    const params: Record<string, string | number> = {
      'api-key': process.env.DATA_GOV_IN_API_KEY as string,
      format: 'json',
      limit: 60,
      'filters[state.keyword]': state,
      'filters[commodity]': commodity,
    };
    if (district) params['filters[district]'] = district;

    const { data } = await axios.get(`https://api.data.gov.in/resource/${resource}`, {
      timeout: TIMEOUT,
      params,
    });
    return data as Record<string, unknown>;
  }

  private normaliseTickers(raw: Record<string, any>): MandiTicker[] {
    const records: any[] = raw?.records ?? raw?.data ?? [];
    return records
      .map((r) => ({
        market: String(r.market ?? r.mandi ?? '').trim(),
        district: String(r.district ?? '').trim(),
        state: String(r.state ?? '').trim(),
        commodity: String(r.commodity ?? '').trim(),
        variety: String(r.variety ?? 'Other').trim(),
        minPrice: Number(r.min_price ?? r.minPrice ?? 0),
        maxPrice: Number(r.max_price ?? r.maxPrice ?? 0),
        modalPrice: Number(r.modal_price ?? r.modalPrice ?? 0),
        arrivalDate: String(r.arrival_date ?? r.arrivalDate ?? ''),
        source: 'agmarknet' as const,
      }))
      .filter((t) => t.market.length > 0 && t.modalPrice > 0);
  }

  private seedTickers(state: string, commodity: string, district?: string): MandiTicker[] {
    const key = commodity.toLowerCase().trim();
    const rows = SEED_TICKERS[key] ?? SEED_TICKERS.wheat;
    const today = new Date().toISOString().slice(0, 10);

    return rows
      .filter((r) => !district || r.district.toLowerCase().includes(district.toLowerCase()))
      .map((r) => ({
        market: r.market,
        district: r.district,
        state: state || 'Uttar Pradesh',
        commodity,
        variety: 'Other',
        minPrice: Math.round(r.modal * 0.94),
        maxPrice: Math.round(r.modal * 1.07),
        modalPrice: r.modal,
        arrivalDate: today,
        source: 'demo-seed' as const,
      }));
  }
}

export const swytchcode = new DataExecutionService();