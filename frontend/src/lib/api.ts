import axios, { AxiosInstance, AxiosError } from 'axios';

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080/api/v1';

export interface AgentAction {
  widget: 'weather_card' | 'npk_calculator' | 'leaf_diagnostic' | 'mandi_profit' | 'pmfby_report' | 'scheme_results' | 'farm_risk';
  reason: string;
  params: Record<string, unknown>;
}

export interface AgentResponse {
  success: boolean;
  sessionId: string;
  reply: string;
  actions: AgentAction[];
  language: 'hi' | 'en';
  orchestrator: 'lyzr' | 'local-planner';
}

export interface WeatherSnapshot {
  latitude: number;
  longitude: number;
  current: { temperatureC: number; humidityPct: number; windSpeedKmh: number; precipitationMm: number; weatherCode: number };
  daily: Array<{ date: string; tMaxC: number; tMinC: number; rainMm: number; rainProbPct: number; windMaxKmh: number }>;
  advisories: Localised[];
  source: string;
}

export interface SoilSnapshot {
  phH2O: number;
  organicCarbonGkg: number;
  nitrogenGkg: number;
  clayPct: number;
  sandPct: number;
  siltPct: number;
  cecCmolKg: number;
  textureCode: string;
}

export interface NdviObservation {
  from: string;
  to: string;
  mean: number;
  min: number;
  max: number;
  stDev: number;
  validPixelPct: number;
}


export interface MandiRow {
  rank: number;
  id: string;
  name: string;
  district: string;
  pricePerQuintal: number;
  distanceKm: number;
  trips: number;
  grossRevenue: number;
  fuelCost: number;
  hireCost: number;
  commission: number;
  handlingCost: number;
  totalDeductions: number;
  netProfit: number;
  netPerQuintal: number;
  roundTripHours: number;
  viable: boolean;
  verdictCode: string;
}

export interface MandiResponse {
  success: boolean;
  results: MandiRow[];
  best: { id: string; name: string; netProfit: number; netPerQuintal: number; distanceKm: number };
  spreadVsWorst: number;
  localBaseline: { pricePerQuintal: number; netProfit: number; upliftIfTravel: number; travelRecommended: boolean } | null;
  assumptions: Record<string, number>;
}

export interface Localised {
  code: string;
  params?: Record<string, string | number>;
}

export interface RiskFactor {
  key: string;
  score: number;
  band: 'low' | 'moderate' | 'high' | 'severe';
  weight: number;
  detail: Localised;
  evidence?: string;
}

export interface RiskAssessment {
  overall: number;
  overallBand: 'low' | 'moderate' | 'high' | 'severe';
  factors: RiskFactor[];
  actions: Localised[];
  ndvi: {
    available: boolean;
    reason?: string;
    current: NdviObservation | null;
    baselineMean: number | null;
    anomaly: number | null;
    anomalyZ: number | null;
    trendPerInterval: number | null;
    dropFromPeakPct: number | null;
    seasonPeak: NdviObservation | null;
    sparkline: Array<{ date: string; mean: number; validPixelPct: number }>;
  };
  context: {
    rain7Mm: number;
    maxTempC: number;
    maxWindKmh: number;
    humidityPct: number;
    textureCode: string;
    priceSpreadPct: number;
  };
}

export interface Diagnosis {
  label: string;
  display_name: string;
  confidence: number;
  severity: string;
  advice: string;
  treatment: string[];
  est_cost_inr_per_acre: number;
  lesion_coverage_pct: number;
  probabilities: Record<string, number>;
}

export interface SchemeAnswer {
  query: string;
  summary: string;
  results: Array<{ title: string; url: string; snippet: string; domain: string; relevance: number; official: boolean }>;
  follow_up_questions: string[];
  source: string;
}

const TOKEN_KEY = 'agrisaarthi.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(TOKEN_KEY, token);
}

const client: AxiosInstance = axios.create({ baseURL: API_BASE, timeout: 45000 });

client.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

export interface FriendlyError {
  message: string;      // farmer-facing, plain language
  technical?: string;   // hidden behind "Technical details"
  offline: boolean;
  retryable: boolean;
}

/**
 * Maps every failure onto farmer-facing language. Developer instructions from
 * the gateway ("Start it with: make ml") must never reach the farmer, so
 * backend messages are matched by their error CODE and replaced, with the raw
 * text preserved under technical detail.
 */
export function describeError(err: unknown): FriendlyError {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ error?: string; detail?: string; code?: string }>;
    const raw = ax.response?.data?.error || ax.response?.data?.detail || ax.message;
    const code = ax.response?.data?.code;

    if (ax.code === 'ECONNABORTED') {
      return {
        message: 'This is taking longer than usual. Your connection may be slow.',
        technical: raw, offline: false, retryable: true,
      };
    }

    if (!ax.response) {
      return {
        message: online
          ? 'We could not reach AgriSaarthi just now. Please try again in a moment.'
          : 'You are offline. We are showing your saved farm information.',
        technical: raw, offline: !online, retryable: true,
      };
    }

    // Service-down codes carry operator instructions. Replace them entirely.
    if (code === 'ML_SERVICE_DOWN' || code === 'ENGINE_MISSING' || code === 'ENGINE_TIMEOUT') {
      return {
        message: 'This service is temporarily unavailable. Please try again shortly.',
        technical: raw, offline: false, retryable: true,
      };
    }

    if (ax.response.status === 429) {
      return {
        message: 'Too many requests just now. Please wait a moment and try again.',
        technical: raw, offline: false, retryable: true,
      };
    }

    if (ax.response.status >= 500) {
      return {
        message: 'Something went wrong on our side. Please try again.',
        technical: raw, offline: false, retryable: true,
      };
    }

    // 4xx is usually a validation problem the farmer can act on.
    return { message: raw || 'That request could not be completed.', technical: raw, offline: false, retryable: false };
  }

  return {
    message: 'Something went wrong. Please try again.',
    technical: err instanceof Error ? err.message : String(err),
    offline: false,
    retryable: true,
  };
}

/** Back-compat for components not yet migrated to describeError. */
export function friendlyError(err: unknown): string {
  return describeError(err).message;
}

export interface RagCitation {
  scheme_id: string;
  title: string;
  heading: string;
  source_url: string;
  score: number;
}

export interface SchemeAnswer {
  query: string;
  summary: string;
  results: Array<{
    title: string; url: string; snippet: string;
    domain: string; relevance: number; official: boolean;
  }>;
  citations: RagCitation[];
  follow_up_questions: string[];
  source: string;
  grounded: boolean;
  confidence: number;
}

export interface ClaimFinding {
  key: string;
  status: 'ok' | 'warning' | 'info';
  text: string;
}

export interface ClaimCheck {
  findings: ClaimFinding[];
  guidance: string;
  citations: RagCitation[];
  within_72h: boolean;
  hours_elapsed: number;
  localised_peril: boolean;
}

export interface SchemeRecommendation {
  schemeId: string;
  titleCode: string;
  benefitCode: string;
  urgency: 'act_now' | 'this_season' | 'anytime';
  score: number;
  reasonCodes: Localised[];
  actionCode: string;
  portalUrl: string;
  estValueCode?: string;
  estValueParams?: Record<string, string | number>;
}

export interface RagAnswer {
  query: string;
  answer: string;
  citations: RagCitation[];
  grounded: boolean;
  confidence: number;
}

export interface DiscoveredMandi {
  id: string;
  name: string;
  district: string;
  lat: number;
  lon: number;
  distanceKm: number;
  precision: 'market' | 'district' | 'none';
  pricePerQuintal: number;
  minPrice: number;
  maxPrice: number;
  arrivalDate: string;
  feedSource: string;
}

export interface MandiAutoResult {
  location: { state?: string; district?: string; village?: string };
  discovered: DiscoveredMandi[];
  skipped: number;
  radiusKm: number;
  feedSource: 'agmarknet' | 'demo-seed' | 'mixed';
  ranking: MandiResponse | null;
  warnings: string[];
}

export const api = {
  async requestToken(phone: string, name?: string, district?: string, lang: 'hi' | 'en' = 'hi') {
    const { data } = await client.post<{ success: boolean; token: string }>('/agent/auth/token', {
      phone, name, district, lang,
    });
    if (data.token) setToken(data.token);
    return data;
  },

  async askAgent(message: string, context: Record<string, unknown>, sessionId?: string) {
    const { data } = await client.post<AgentResponse>('/agent/query', { message, context, sessionId });
    return data;
  },

  async weather(lat: number, lon: number) {
    const { data } = await client.get<{ weather: WeatherSnapshot }>('/data/weather', { params: { lat, lon } });
    return data.weather;
  },

  async soil(lat: number, lon: number) {
    const { data } = await client.get<{ soil: SoilSnapshot }>('/data/soil', { params: { lat, lon } });
    return data.soil;
  },

  async optimizeMandi(payload: Record<string, unknown>) {
    const { data } = await client.post<MandiResponse>('/mandi/optimize', payload);
    return data;
  },

  async diagnose(file: Blob, crop: string, language: 'hi' | 'en') {
    const form = new FormData();
    form.append('image', file, 'leaf.jpg');
    form.append('crop', crop);
    form.append('language', language);
    const { data } = await client.post<{ diagnosis: Diagnosis; low_confidence: boolean; note?: string }>(
      '/data/diagnose', form, { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data;
  },

  async risk(payload: {
    lat: number; lon: number; crop?: string; state?: string;
    boundary?: Array<{ lat: number; lon: number }>;
  }) {
    const { data } = await client.post<{ success: boolean } & RiskAssessment>('/risk/assess', payload);
    return data as RiskAssessment;
  },

  async ndviEvent(payload: {
    lat: number; lon: number; eventDate: string;
    boundary?: Array<{ lat: number; lon: number }>;
  }) {
    const { data } = await client.post<{
      success: boolean;
      pre: NdviObservation | null;
      post: NdviObservation | null;
      lossPct: number | null;
      usable: boolean;
      reason?: string;
    }>('/data/ndvi/event', payload);
    return data;
  },

  async schemes(query: string, state?: string, language: 'hi' | 'en' = 'hi') {
    const { data } = await client.post<SchemeAnswer>('/data/schemes', { query, state, language });
    return data;
  },

  async schemeRecommend(payload: {
    lat: number; lon: number; crop?: string; areaHa?: number; state?: string;
    language: 'hi' | 'en';
    hasKcc?: boolean; hasInsurance?: boolean; hasSoilCard?: boolean;
    irrigationSource?: string;
  }) {
    const { data } = await client.post<{
      success: boolean;
      recommendations: SchemeRecommendation[];
      context: Record<string, unknown>;
    }>('/schemes/recommend', payload);
    return data;
  },

  async schemeDetail(payload: { schemeId: string; question?: string; language: 'hi' | 'en' }) {
    const { data } = await client.post<{ success: boolean } & RagAnswer>('/schemes/detail', payload);
    return data as RagAnswer;
  },

  async claimCheck(payload: {
    cause: string; eventDate: string; estimatedLossPct: number; language: 'hi' | 'en';
  }) {
    const { data } = await client.post<{ success: boolean } & ClaimCheck>(
      '/data/pmfby/claim-check', payload,
    );
    return data as ClaimCheck;
  },

  async pmfbyReport(payload: Record<string, unknown>): Promise<Blob> {
    const { data } = await client.post('/data/pmfby/report', payload, { responseType: 'blob' });
    return data as Blob;
  },

  async mandiAuto(payload: { /* …unchanged… */ }) {
    const { data } = await client.post<{ success: boolean } & MandiAutoResult>(
      '/mandi/auto', payload, { timeout: 90000 },
    );
    return data as MandiAutoResult;
  },
};

export default client;
