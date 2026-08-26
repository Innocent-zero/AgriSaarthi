/**
 * Data Execution Service.
 *
 * Fetches weather (Open-Meteo), soil (SoilGrids), satellite NDVI (Sentinel Hub)
 * and mandi prices (data.gov.in AGMARKNET) directly. All are public APIs with
 * no connector in any middleware catalogue, so a proxy layer would add latency
 * and a failure mode without adding anything.
 *
 * The export is still named `swytchcode` so every caller stays unchanged.
 */
import { withCache } from '../config/redis';
import { sentinelHub, NdviAnalysis, LatLon } from './sentinelHubServices';
import axios from 'axios';

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
  texture: string;          // translation code, e.g. 'soil.sandyLoam'
  source: 'soilgrids' | 'regional-default';
}

export interface MandiTicker {
  market: string;
  district: string;
  state: string;
  commodity: string;
  variety: string;
  grade?: string;
  minPrice: number;
  maxPrice: number;
  modalPrice: number;
  arrivalDate: string;      // ISO yyyy-mm-dd
  lat?: number;
  lon?: number;
  source?: 'agmarknet' | 'demo-seed';
}

const TIMEOUT = 12000;

/**
 * Demo seed markets, used only when the live feed returns nothing.
 * Coordinates are bundled so no geocoding round-trip is needed — this avoids
 * the nonsense of matching a UP market name against a Delhi district centroid,
 * and keeps the demo path fast.
 * Prices are representative 2026 modal ranges, NOT live quotes; every response
 * carries source:'demo-seed' so the UI can say so plainly.
 */
interface SeedMarket {
  market: string;
  district: string;
  state: string;
  lat: number;
  lon: number;
  modal: number;
}

const SEED_MARKETS: Record<string, SeedMarket[]> = {
  wheat: [
    { market: 'Sitapur APMC',         district: 'Sitapur',          state: 'Uttar Pradesh', lat: 27.5679, lon: 80.6828, modal: 2385 },
    { market: 'Lucknow Grain Mandi',  district: 'Lucknow',          state: 'Uttar Pradesh', lat: 26.8467, lon: 80.9462, modal: 2310 },
    { market: 'Kanpur Anaj Mandi',    district: 'Kanpur Nagar',     state: 'Uttar Pradesh', lat: 26.4499, lon: 80.3319, modal: 2440 },
    { market: 'Hardoi Mandi Samiti',  district: 'Hardoi',           state: 'Uttar Pradesh', lat: 27.4166, lon: 80.1300, modal: 2290 },
    { market: 'Barabanki APMC',       district: 'Barabanki',        state: 'Uttar Pradesh', lat: 26.9256, lon: 81.1900, modal: 2355 },
    { market: 'Ghaziabad Mandi',      district: 'Ghaziabad',        state: 'Uttar Pradesh', lat: 28.6692, lon: 77.4538, modal: 2430 },
    { market: 'Najafgarh Mandi',      district: 'South West Delhi', state: 'Delhi',         lat: 28.6090, lon: 76.9855, modal: 2470 },
    { market: 'Narela Grain Market',  district: 'North Delhi',      state: 'Delhi',         lat: 28.8530, lon: 77.0910, modal: 2510 },
    { market: 'Sonipat Anaj Mandi',   district: 'Sonipat',          state: 'Haryana',       lat: 28.9931, lon: 77.0151, modal: 2495 },
    { market: 'Panipat Grain Mandi',  district: 'Panipat',          state: 'Haryana',       lat: 29.3909, lon: 76.9635, modal: 2460 },
  ],
  rice: [
    { market: 'Lucknow Grain Mandi',  district: 'Lucknow',     state: 'Uttar Pradesh', lat: 26.8467, lon: 80.9462, modal: 3120 },
    { market: 'Raebareli APMC',       district: 'Raebareli',   state: 'Uttar Pradesh', lat: 26.2300, lon: 81.2300, modal: 3040 },
    { market: 'Gonda Mandi Samiti',   district: 'Gonda',       state: 'Uttar Pradesh', lat: 27.1333, lon: 81.9600, modal: 3210 },
    { market: 'Narela Grain Market',  district: 'North Delhi', state: 'Delhi',         lat: 28.8530, lon: 77.0910, modal: 3340 },
    { market: 'Karnal Mandi',         district: 'Karnal',      state: 'Haryana',       lat: 29.6857, lon: 76.9905, modal: 3410 },
  ],
  paddy: [
    { market: 'Gonda Mandi Samiti',   district: 'Gonda',     state: 'Uttar Pradesh', lat: 27.1333, lon: 81.9600, modal: 2180 },
    { market: 'Sitapur APMC',         district: 'Sitapur',   state: 'Uttar Pradesh', lat: 27.5679, lon: 80.6828, modal: 2115 },
    { market: 'Barabanki APMC',       district: 'Barabanki', state: 'Uttar Pradesh', lat: 26.9256, lon: 81.1900, modal: 2240 },
    { market: 'Karnal Mandi',         district: 'Karnal',    state: 'Haryana',       lat: 29.6857, lon: 76.9905, modal: 2265 },
  ],
  maize: [
    { market: 'Kanpur Anaj Mandi',    district: 'Kanpur Nagar', state: 'Uttar Pradesh', lat: 26.4499, lon: 80.3319, modal: 2050 },
    { market: 'Unnao Mandi',          district: 'Unnao',        state: 'Uttar Pradesh', lat: 26.5470, lon: 80.4878, modal: 1975 },
    { market: 'Lucknow Grain Mandi',  district: 'Lucknow',      state: 'Uttar Pradesh', lat: 26.8467, lon: 80.9462, modal: 2120 },
    { market: 'Narela Grain Market',  district: 'North Delhi',  state: 'Delhi',         lat: 28.8530, lon: 77.0910, modal: 2180 },
  ],
  mustard: [
    { market: 'Hardoi Mandi Samiti',  district: 'Hardoi',  state: 'Uttar Pradesh', lat: 27.4166, lon: 80.1300, modal: 5680 },
    { market: 'Sitapur APMC',         district: 'Sitapur', state: 'Uttar Pradesh', lat: 27.5679, lon: 80.6828, modal: 5520 },
    { market: 'Lakhimpur Mandi',      district: 'Kheri',   state: 'Uttar Pradesh', lat: 27.9470, lon: 80.7790, modal: 5790 },
    { market: 'Alwar Mandi',          district: 'Alwar',   state: 'Rajasthan',     lat: 27.5530, lon: 76.6346, modal: 5910 },
  ],
  potato: [
    { market: 'Agra Potato Mandi',    district: 'Agra',         state: 'Uttar Pradesh', lat: 27.1767, lon: 78.0081, modal: 1180 },
    { market: 'Farrukhabad Mandi',    district: 'Farrukhabad',  state: 'Uttar Pradesh', lat: 27.3929, lon: 79.5800, modal: 1095 },
    { market: 'Kanpur Anaj Mandi',    district: 'Kanpur Nagar', state: 'Uttar Pradesh', lat: 26.4499, lon: 80.3319, modal: 1260 },
    { market: 'Azadpur Mandi',        district: 'North Delhi',  state: 'Delhi',         lat: 28.7136, lon: 77.1750, modal: 1390 },
  ],
  cotton: [
    { market: 'Kanpur Cotton Yard',   district: 'Kanpur Nagar', state: 'Uttar Pradesh', lat: 26.4499, lon: 80.3319, modal: 7420 },
    { market: 'Jhansi APMC',          district: 'Jhansi',       state: 'Uttar Pradesh', lat: 25.4484, lon: 78.5685, modal: 7180 },
    { market: 'Sirsa Cotton Yard',    district: 'Sirsa',        state: 'Haryana',       lat: 29.5349, lon: 75.0280, modal: 7460 },
  ],
  sugarcane: [
    { market: 'Lakhimpur Mandi',      district: 'Kheri',         state: 'Uttar Pradesh', lat: 27.9470, lon: 80.7790, modal: 370 },
    { market: 'Sitapur APMC',         district: 'Sitapur',       state: 'Uttar Pradesh', lat: 27.5679, lon: 80.6828, modal: 358 },
    { market: 'Muzaffarnagar Yard',   district: 'Muzaffarnagar', state: 'Uttar Pradesh', lat: 29.4727, lon: 77.7085, modal: 385 },
  ],
  soybean: [
    { market: 'Jhansi APMC',          district: 'Jhansi',   state: 'Uttar Pradesh', lat: 25.4484, lon: 78.5685, modal: 4630 },
    { market: 'Lalitpur Mandi',       district: 'Lalitpur', state: 'Uttar Pradesh', lat: 24.6900, lon: 78.4100, modal: 4510 },
  ],
};

class DataExecutionService {
  readonly mode = 'direct' as const;

  // ─────────────────────────── Weather ───────────────────────────
  async getWeather(lat: number, lon: number): Promise<WeatherSnapshot> {
    const ttl = Number(process.env.CACHE_TTL_WEATHER || 1800);
    const key = `wx:${lat.toFixed(3)}:${lon.toFixed(3)}`;
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
        // SoilGrids rate-limits aggressively and occasionally times out. A
        // typical Indo-Gangetic alluvial profile keeps the NPK calculator
        // usable meanwhile.
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
  /** Delegated to Sentinel Hub, kept on this facade so callers reach every
   *  external data source through one object. */
  async getNdvi(centre: LatLon, boundary?: LatLon[]): Promise<NdviAnalysis> {
    return sentinelHub.getNdviAnalysis(centre, boundary);
  }

  // ─────────────────────────── Mandi prices ───────────────────────────
  async getMandiPrices(state: string, commodity: string, district?: string): Promise<MandiTicker[]> {
    const ttl = Number(process.env.CACHE_TTL_MANDI || 3600);
    const key = `mandi:${state}:${district ?? 'all'}:${commodity}`.toLowerCase();

    const { data } = await withCache<MandiTicker[]>(key, ttl, async () => {
      if (process.env.DATA_GOV_IN_API_KEY && process.env.DATA_GOV_MANDI_RESOURCE) {
        try {
          const live = this.normaliseTickers(await this.fetchAgmarknet(state, commodity, district));
          if (live.length) return live;
        } catch (err) {
          console.warn('[mandi] AGMARKNET unavailable:', (err as Error).message);
        }
      }
      return this.seedTickers(state, commodity, district);
    });
    return data;
  }

  /** DD/MM/YYYY — the only date format this resource accepts. */
  private static toAgmarkDate(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  /**
   * The resource holds the full multi-year archive (80M+ rows) returned
   * oldest-first, so an unfiltered query yields 2023 data — every request must
   * pin a date. Markets report after trading closes and publication lags a day
   * or two, so walk back until a day with records is found.
   */
  private async fetchAgmarknet(
    state: string,
    commodity: string,
    district?: string,
  ): Promise<Record<string, unknown>> {
    const resource = process.env.DATA_GOV_MANDI_RESOURCE as string;
    const apiKey = process.env.DATA_GOV_IN_API_KEY as string;
    const maxLookback = Number(process.env.MANDI_LOOKBACK_DAYS || 7);

    for (let back = 0; back <= maxLookback; back += 1) {
      const day = new Date();
      day.setDate(day.getDate() - back);

      const params: Record<string, string | number> = {
        'api-key': apiKey,
        format: 'json',
        limit: 500,
        'filters[Arrival_Date]': DataExecutionService.toAgmarkDate(day),
        'filters[State]': state,
        'filters[Commodity]': commodity,
      };
      if (district) params['filters[District]'] = district;

      const { data } = await axios.get(`https://api.data.gov.in/resource/${resource}`, {
        timeout: TIMEOUT,
        params,
        // data.gov.in throttles rapid requests and returns HTML, not JSON.
        // Treat that as "no data for this day" and keep walking back.
        validateStatus: (s) => s < 500,
      });

      if (typeof data === 'object' && data !== null) {
        const records = (data as any)?.records ?? [];
        if (records.length > 0) {
          if (back > 0) {
            console.log(`[mandi] no ${commodity} prices for today; using data from ${back} day(s) ago`);
          }
          return data as Record<string, unknown>;
        }
      }

      await new Promise((r) => setTimeout(r, 800));
    }

    console.warn(`[mandi] no ${commodity} prices in ${state} within ${maxLookback} days`);
    return { records: [] };
  }

  /**
   * This resource uses Capitalized_Underscore keys and DD/MM/YYYY dates, and
   * price fields arrive as either strings or numbers depending on the response
   * — hence Number() on all three. Lowercase spellings are kept as fallbacks so
   * swapping the resource does not silently return zero rows.
   */
  private normaliseTickers(raw: Record<string, any>): MandiTicker[] {
    const records: any[] = raw?.records ?? raw?.data ?? [];

    const isoDate = (s: unknown): string => {
      const m = String(s ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s ?? '');
    };

    return records
      .map((r) => ({
        market: String(r.Market ?? r.market ?? '').trim(),
        district: String(r.District ?? r.district ?? '').trim(),
        state: String(r.State ?? r.state ?? '').trim(),
        commodity: String(r.Commodity ?? r.commodity ?? '').trim(),
        variety: String(r.Variety ?? r.variety ?? 'Other').trim(),
        grade: String(r.Grade ?? r.grade ?? '').trim(),
        minPrice: Number(r.Min_Price ?? r.min_price ?? 0),
        maxPrice: Number(r.Max_Price ?? r.max_price ?? 0),
        modalPrice: Number(r.Modal_Price ?? r.modal_price ?? 0),
        arrivalDate: isoDate(r.Arrival_Date ?? r.arrival_date),
        source: 'agmarknet' as const,
      }))
      .filter((t) => t.market.length > 0 && Number.isFinite(t.modalPrice) && t.modalPrice > 0);
  }

  private seedTickers(state: string, commodity: string, district?: string): MandiTicker[] {
    const rows = SEED_MARKETS[commodity.toLowerCase().trim()] ?? SEED_MARKETS.wheat;
    const today = new Date().toISOString().slice(0, 10);
    const wanted = state.trim().toLowerCase();

    // Prefer the farmer's own state, but never return an empty list — a
    // neighbouring state's mandi may still be the profitable choice, and the
    // distance filter downstream decides what is actually reachable.
    const inState = rows.filter((r) => r.state.toLowerCase() === wanted);
    const pool = inState.length >= 2 ? inState : rows;

    return pool.map((r) => ({
      market: r.market,
      district: r.district,
      state: r.state,
      commodity,
      variety: 'Other',
      minPrice: Math.round(r.modal * 0.94),
      maxPrice: Math.round(r.modal * 1.07),
      modalPrice: r.modal,
      arrivalDate: today,
      lat: r.lat,
      lon: r.lon,
      source: 'demo-seed' as const,
    }));
  }
}

export const swytchcode = new DataExecutionService();