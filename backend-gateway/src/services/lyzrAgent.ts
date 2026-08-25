/**
 * Lyzr AI — Hybrid Orchestration Client.
 *
 * Primary path: the Lyzr agent returns conversational guidance PLUS a fenced
 * action block naming which widgets the client should mount.
 * Fallback path: a deterministic intent planner produces the same envelope,
 * used when Lyzr is unconfigured, erroring, or too slow for a 2G session.
 */
import axios, { AxiosInstance } from 'axios';
import { swytchcode } from './swytchcodeService';

export type WidgetName =
  | 'weather_card'
  | 'npk_calculator'
  | 'leaf_diagnostic'
  | 'mandi_profit'
  | 'pmfby_report'
  | 'farm_risk'
  | 'scheme_results';

export interface AgentAction {
  widget: WidgetName;
  reason: string;
  params: Record<string, unknown>;
}

export interface AgentTurn {
  reply: string;
  actions: AgentAction[];
  language: 'hi' | 'en';
  sessionId: string;
  source: 'lyzr' | 'local-planner';
}

export interface AgentContext {
  lat: number;
  lon: number;
  crop?: string;
  areaHa?: number;
  state?: string;
  district?: string;
  language: 'hi' | 'en';
  farmerName?: string;
}

const VALID_WIDGETS: WidgetName[] = [
  'weather_card', 'npk_calculator', 'leaf_diagnostic',
  'mandi_profit', 'pmfby_report', 'farm_risk', 'scheme_results',
];

const SYSTEM_DIRECTIVE = `You are AgriSaarthi, a precision-farming copilot for Indian smallholder farmers.

RULES:
1. Answer in the farmer's language (Hindi in Devanagari, or English) as indicated below.
   Use simple words a farmer with limited schooling understands. Never exceed 5 short sentences.
2. Never state a raw metric alone. Convert it into an action with a financial or agronomic
   consequence. Bad: "Humidity is 85%." Good: "Humidity is high, so blight can spread —
   scout your leaves today before it costs you yield."
3. After your reply, you MUST append a fenced code block tagged agrisaarthi-actions
   containing a JSON array of widget intents. Emit [] if no widget is needed.

WIDGETS (use the exact name):
- weather_card    → actionable forecast.            params: {}
- npk_calculator  → fertiliser & irrigation plan.   params: { crop, areaHa }
- leaf_diagnostic → camera disease diagnosis.       params: {}
- mandi_profit    → net-profit market comparison.   params: { crop, volumeQuintals }
- pmfby_report    → PMFBY claim PDF.                params: { cause }
- farm_risk       → composite farm risk analysis.   params: {}
- scheme_results  → live government scheme search.  params: { query }

EXAMPLE:
Rain is coming in two days, so hold back your urea or it will wash away.

\`\`\`agrisaarthi-actions
[{"widget":"weather_card","reason":"Spraying timing question","params":{}}]
\`\`\``;

// ───────────────────────── Fallback intent table ─────────────────────────
interface IntentRule {
  widget: WidgetName;
  reason: string;
  strong: string[];
  weak: string[];
}

const INTENTS: IntentRule[] = [
  {
    widget: 'weather_card',
    reason: 'Weather-linked field decision',
    strong: ['weather', 'rain', 'rainfall', 'forecast', 'spray', 'spraying', 'irrigate', 'irrigation',
             'मौसम', 'बारिश', 'बरसात', 'सिंचाई', 'छिड़क', 'छिडक', 'पानी'],
    weak: ['today', 'tomorrow', 'wind', 'humid', 'hot', 'cold', 'storm',
           'आज', 'कल', 'हवा', 'नमी', 'गर्मी', 'ठंड', 'तूफान'],
  },
  {
    widget: 'npk_calculator',
    reason: 'Fertiliser dosing request',
    strong: ['fertiliser', 'fertilizer', 'urea', 'dap', 'npk', 'nutrient', 'manure', 'compost',
             'खाद', 'यूरिया', 'उर्वरक', 'पोषक'],
    weak: ['soil', 'nitrogen', 'phosphor', 'potash', 'dose', 'kitna', 'how much', 'bag',
           'मिट्टी', 'नाइट्रोजन', 'मात्रा', 'कितना', 'बोरी'],
  },
  {
    widget: 'leaf_diagnostic',
    reason: 'Suspected crop disease or pest',
    strong: ['disease', 'blight', 'rust', 'mildew', 'fungus', 'pest', 'insect', 'infection', 'keeda',
             'बीमारी', 'रोग', 'कीट', 'कीड़ा', 'फफूंद', 'झुलसा', 'रतुआ'],
    weak: ['leaf', 'leaves', 'spot', 'yellow', 'yellowing', 'wilting', 'drying', 'photo', 'eating', 'sick',
           'पत्ती', 'पत्ते', 'धब्बा', 'पीला', 'पीली', 'सूख', 'मुरझा', 'ख़राब', 'खराब'],
  },
  {
    widget: 'mandi_profit',
    reason: 'Selling and market decision',
    strong: ['mandi', 'market', 'sell', 'selling', 'price', 'rate', 'apmc', 'trader', 'buyer', 'bhav',
             'मंडी', 'भाव', 'दाम', 'बेच', 'रेट', 'व्यापारी', 'आढ़त'],
    weak: ['profit', 'quintal', 'transport', 'diesel', 'fuel', 'earning', 'worth',
           'फायदा', 'मुनाफा', 'क्विंटल', 'ढुलाई', 'डीज़ल', 'डीजल', 'कमाई'],
  },
  {
    widget: 'pmfby_report',
    reason: 'Insurance claim initiation',
    strong: ['insurance', 'pmfby', 'claim', 'bima', 'compensation', 'indemnity',
             'बीमा', 'दावा', 'मुआवजा', 'क्षतिपूर्ति'],
    weak: ['damage', 'loss', 'flood', 'drought', 'hail', 'destroyed', 'ruined',
           'नुकसान', 'बर्बाद', 'बाढ़', 'सूखा', 'ओला', 'तबाह'],
  },
  {
    widget: 'farm_risk',
    reason: 'Overall farm risk enquiry',
    strong: ['risk', 'danger', 'threat', 'safe', 'worry', 'jokhim',
             'जोखिम', 'ख़तरा', 'खतरा', 'सुरक्षित'],
    weak: ['problem', 'chinta', 'overall', 'status', 'health',
           'समस्या', 'चिंता', 'हालत', 'स्थिति'],
  },
  {
    widget: 'scheme_results',
    reason: 'Government scheme enquiry',
    strong: ['scheme', 'subsidy', 'yojana', 'pm-kisan', 'pm kisan', 'kisan samman', 'loan', 'kcc',
             'योजना', 'सब्सिडी', 'अनुदान', 'सम्मान निधि', 'ऋण', 'कर्ज'],
    weak: ['government', 'sarkar', 'apply', 'eligible', 'benefit', 'registration', 'installment',
           'सरकार', 'सरकारी', 'आवेदन', 'पात्र', 'लाभ', 'किस्त', 'पंजीकरण'],
  },
];

class LyzrAgentService {
  private readonly client: AxiosInstance | null;
  private readonly agentId: string;
  private readonly userId: string;

  constructor() {
    const key = process.env.LYZR_API_KEY;
    this.agentId = process.env.LYZR_AGENT_ID || '';
    this.userId = process.env.LYZR_USER_ID || 'agrisaarthi-prod';
    this.client =
      key && this.agentId
        ? axios.create({
            baseURL: process.env.LYZR_BASE_URL || 'https://agent-prod.studio.lyzr.ai/v3/inference/chat/',
            timeout: Number(process.env.LYZR_TIMEOUT_MS || 25000),
            headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
          })
        : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async ask(message: string, ctx: AgentContext, sessionId: string): Promise<AgentTurn> {
    if (this.client) {
      const remote = await this.callLyzr(message, ctx, sessionId);
      if (remote) return remote;
    }
    return this.localPlanner(message, ctx, sessionId);
  }

  private async callLyzr(message: string, ctx: AgentContext, sessionId: string): Promise<AgentTurn | null> {
    try {
      const contextBlock = [
        'FARM CONTEXT:',
        `- coordinates: ${ctx.lat.toFixed(4)}, ${ctx.lon.toFixed(4)}`,
        ctx.crop ? `- crop: ${ctx.crop}` : '',
        ctx.areaHa ? `- area: ${ctx.areaHa} hectares` : '',
        ctx.district ? `- district: ${ctx.district}` : '',
        ctx.state ? `- state: ${ctx.state}` : '',
        ctx.farmerName ? `- farmer name: ${ctx.farmerName}` : '',
        `- reply language: ${ctx.language === 'hi' ? 'Hindi (Devanagari)' : 'English'}`,
      ].filter(Boolean).join('\n');

      const { data } = await this.client!.post('', {
        user_id: this.userId,
        agent_id: this.agentId,
        session_id: sessionId,
        message: `${SYSTEM_DIRECTIVE}\n\n${contextBlock}\n\nFARMER SAYS: ${message}`,
      });

      const rawText: string =
        data?.response ?? data?.message ?? data?.output ?? data?.data?.response ?? '';
      if (!rawText || typeof rawText !== 'string') {
        console.warn('[lyzr] empty response body → local planner');
        return null;
      }

      const { reply, actions } = this.splitResponse(rawText);
      return {
        reply: reply || rawText.trim(),
        actions: this.enrich(actions, ctx),
        language: ctx.language,
        sessionId,
        source: 'lyzr',
      };
    } catch (err) {
      const msg = axios.isAxiosError(err) ? `${err.response?.status ?? ''} ${err.message}` : String(err);
      console.warn(`[lyzr] inference failed → local planner. ${msg}`);
      return null;
    }
  }

  private splitResponse(raw: string): { reply: string; actions: AgentAction[] } {
    const fence = /```(?:agrisaarthi-actions|json)?\s*([\s\S]*?)```/i;
    const match = raw.match(fence);
    if (!match) return { reply: raw.trim(), actions: [] };

    const reply = raw.replace(fence, '').trim();
    let actions: AgentAction[] = [];
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        actions = parsed
          .filter((a) => a && VALID_WIDGETS.includes(a.widget))
          .map((a) => ({
            widget: a.widget as WidgetName,
            reason: String(a.reason ?? ''),
            params: (a.params && typeof a.params === 'object' ? a.params : {}) as Record<string, unknown>,
          }));
      }
    } catch (err) {
      console.warn('[lyzr] action block was not valid JSON:', (err as Error).message);
    }
    return { reply, actions };
  }

  // ───────────────── Deterministic fallback ─────────────────
  private scoreIntents(message: string): IntentRule[] {
    const q = ` ${message.toLowerCase().replace(/[?.,!।]/g, ' ')} `;
    const hits: Array<{ rule: IntentRule; score: number }> = [];
    for (const rule of INTENTS) {
      let score = 0;
      for (const k of rule.strong) if (q.includes(k)) score += 2;
      for (const k of rule.weak) if (q.includes(k)) score += 1;
      if (score > 0) hits.push({ rule, score });
    }
    hits.sort((a, b) => b.score - a.score);
    const top = hits[0]?.score ?? 0;
    return hits.filter((h) => h.score >= Math.max(2, top - 1)).map((h) => h.rule);
  }

  private async localPlanner(message: string, ctx: AgentContext, sessionId: string): Promise<AgentTurn> {
    const hi = ctx.language === 'hi';
    const matched = this.scoreIntents(message);
    const rules = matched.length ? matched : [INTENTS[0]];

    const lines: string[] = [];
    const actions: AgentAction[] = [];

    for (const rule of rules.slice(0, 3)) {
      const built = await this.buildFor(rule.widget, message, ctx);
      lines.push(...built.lines);
      actions.push({ widget: rule.widget, reason: rule.reason, params: built.params });
    }

    return {
      reply: lines.filter(Boolean).join(' '),
      actions: this.enrich(actions, ctx),
      language: ctx.language,
      sessionId,
      source: 'local-planner',
    };
  }

  private async buildFor(
    widget: WidgetName,
    message: string,
    ctx: AgentContext,
  ): Promise<{ lines: string[]; params: Record<string, unknown> }> {
    const hi = ctx.language === 'hi';

    switch (widget) {
      case 'weather_card': {
        try {
          const wx = await swytchcode.getWeather(ctx.lat, ctx.lon);
          return {
            lines: [
              hi
                ? `अभी ${wx.current.temperatureC.toFixed(0)}°C, नमी ${wx.current.humidityPct.toFixed(0)}%. नीचे पूरी सलाह देखें।`
                : `Right now it is ${wx.current.temperatureC.toFixed(0)}°C with ${wx.current.humidityPct.toFixed(0)}% humidity. Full advice below.`,
            ],
            params: {},
          };
        } catch {
          return {
            lines: [hi ? 'मौसम डेटा अभी नहीं मिला — सेव किया पूर्वानुमान नीचे है।'
                       : 'Live weather unavailable — your saved forecast is below.'],
            params: {},
          };
        }
      }
      case 'npk_calculator':
        return {
          lines: [hi ? 'खाद की सही मात्रा नीचे तय करें — ज़रूरत से ज़्यादा यूरिया पैसा और उपज दोनों घटाता है।'
                     : 'Set the correct dose below — over-applying urea costs money and lowers yield.'],
          params: { crop: ctx.crop, areaHa: ctx.areaHa },
        };
      case 'leaf_diagnostic':
        return {
          lines: [hi ? 'पत्ती की साफ़ फोटो खींचिए। दवा खरीदने से पहले जाँच ज़रूरी है।'
                     : 'Take a clear photo of the leaf. Diagnose before buying any chemical.'],
          params: {},
        };
      case 'mandi_profit':
        return {
          lines: [hi ? 'सिर्फ़ भाव मत देखिए — डीज़ल, हम्माली और आढ़त घटाकर असली कमाई नीचे देखिए।'
                     : 'Do not judge by the ticker — compare true earnings after diesel, handling and commission below.'],
          params: { crop: ctx.crop ?? 'Wheat', volumeQuintals: 0 },
        };
      case 'pmfby_report':
        return {
          lines: [hi ? 'सैटेलाइट-आधारित PMFBY दावा पासबुक एक क्लिक में बनेगी। सूचना 72 घंटे में देना ज़रूरी है।'
                     : 'Your satellite-backed PMFBY passbook generates in one click. Intimation is due within 72 hours.'],
          params: { cause: this.guessCause(message, ctx.language) },
        };
      case 'farm_risk':
        return {
          lines: [hi ? 'आपके खेत पर अभी क्या ख़तरा है, नीचे विश्लेषण देखें।'
                     : 'Here is what currently threatens your field.'],
          params: {},
        };
      case 'scheme_results':
        return {
          lines: [hi ? 'सरकारी योजनाओं की जानकारी नीचे दिख रही है।'
                     : 'Government scheme information is shown below.'],
          params: { query: message, state: ctx.state },
        };
      default:
        return { lines: [], params: {} };
    }
  }

  private guessCause(message: string, language: 'hi' | 'en'): string {
    const q = message.toLowerCase();
    const hi = language === 'hi';
    if (/(flood|water ?logg|बाढ़|जलभराव)/.test(q)) return hi ? 'बाढ़ / जलभराव' : 'Flood / waterlogging';
    if (/(drought|dry|सूखा)/.test(q)) return hi ? 'सूखा' : 'Drought';
    if (/(hail|ola|ओला)/.test(q)) return hi ? 'ओलावृष्टि' : 'Hailstorm';
    if (/(wind|storm|cyclone|तूफान|आंधी|आँधी)/.test(q)) return hi ? 'तेज़ हवा / तूफ़ान' : 'High wind / cyclone';
    if (/(pest|insect|कीट)/.test(q)) return hi ? 'कीट प्रकोप' : 'Pest attack';
    if (/(disease|fungus|बीमारी|रोग)/.test(q)) return hi ? 'बीमारी' : 'Disease outbreak';
    return hi ? 'बेमौसम बारिश' : 'Unseasonal rain';
  }

  private enrich(actions: AgentAction[], ctx: AgentContext): AgentAction[] {
    return actions.map((a) => ({
      ...a,
      params: {
        lat: ctx.lat, lon: ctx.lon, crop: ctx.crop, areaHa: ctx.areaHa,
        state: ctx.state, district: ctx.district, ...a.params,
      },
    }));
  }
}

export const lyzrAgent = new LyzrAgentService();