/**
 * Lyzr AI — Hybrid Orchestration Client.
 *
 * Returns a conversational reply PLUS structured widget-mount actions.
 *
 * Routing is tiered to protect a small monthly credit allowance:
 *   Tier 0  confident keyword match  → local planner, 0 credits, ~50 ms
 *   Tier 1  ambiguous / unrecognised → Lyzr inference, 1 credit
 *   Tier 2  Lyzr unavailable or capped → local planner
 *
 * Parsing is defensive by design: Lyzr may return the structured payload as a
 * real object, as a JSON string, wrapped in a markdown fence, or with prose
 * around it. Every shape is handled, and a hard guard guarantees raw JSON can
 * never reach the farmer's screen.
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
  confidence: number;
  creditsRemaining: number;
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

const VALID_WIDGETS: readonly WidgetName[] = [
  'weather_card', 'npk_calculator', 'leaf_diagnostic',
  'mandi_profit', 'pmfby_report', 'farm_risk', 'scheme_results',
] as const;

/** Params the model is allowed to influence. Everything else is ours. */
const MODEL_OWNED_PARAMS = new Set(['cause', 'query', 'volumeQuintals']);

// ─────────────────────────── Credit budget ───────────────────────────
/**
 * Local spend guard. Lyzr's own quota is authoritative — this exists so a
 * retry loop or a chatty demo cannot silently drain a month of credits.
 */
class CreditBudget {
  private spent = 0;
  private windowStart = Date.now();
  private readonly perSession = new Map<string, number>();
  private readonly cap = Number(process.env.LYZR_MONTHLY_CAP || 20);
  private readonly sessionCap = Number(process.env.LYZR_SESSION_CAP || 3);

  private roll(): void {
    if (Date.now() - this.windowStart > 30 * 86_400_000) {
      this.spent = 0;
      this.windowStart = Date.now();
      this.perSession.clear();
    }
  }

  canSpend(sessionId?: string): boolean {
    this.roll();
    if (this.spent >= this.cap) return false;
    if (sessionId && (this.perSession.get(sessionId) ?? 0) >= this.sessionCap) return false;
    return true;
  }

  record(sessionId?: string): void {
    this.roll();
    this.spent += 1;
    if (sessionId) {
      this.perSession.set(sessionId, (this.perSession.get(sessionId) ?? 0) + 1);
    }
    if (this.spent >= this.cap) {
      console.warn(`[lyzr] monthly credit cap of ${this.cap} reached — local planner only`);
    }
  }

  get remaining(): number {
    this.roll();
    return Math.max(0, this.cap - this.spent);
  }
}

// ─────────────────────────── Fallback intent table ───────────────────────────
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
             'खाद', 'यूरिया', 'उर्वरक', 'पोषक', 'डीएपी'],
    weak: ['soil', 'nitrogen', 'phosphor', 'potash', 'dose', 'kitna', 'how much', 'bag',
           'मिट्टी', 'नाइट्रोजन', 'मात्रा', 'कितना', 'बोरी'],
  },
  {
    widget: 'leaf_diagnostic',
    reason: 'Suspected crop disease or pest',
    strong: ['disease', 'blight', 'rust', 'mildew', 'fungus', 'pest', 'insect', 'infection', 'keeda',
             'बीमारी', 'रोग', 'कीट', 'कीड़ा', 'फफूंद', 'झुलसा', 'रतुआ'],
    weak: ['leaf', 'leaves', 'spot', 'spots', 'yellow', 'yellowing', 'wilting', 'drying', 'photo',
           'eating', 'sick', 'damage',
           'पत्ती', 'पत्ते', 'धब्बा', 'धब्बे', 'पीला', 'पीली', 'सूख', 'मुरझा', 'ख़राब', 'खराब'],
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
    strong: ['risk', 'danger', 'threat', 'jokhim',
             'जोखिम', 'ख़तरा', 'खतरा'],
    weak: ['safe', 'worry', 'problem', 'chinta', 'overall', 'status', 'health',
           'सुरक्षित', 'समस्या', 'चिंता', 'हालत', 'स्थिति'],
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

const SYSTEM_DIRECTIVE = `You are AgriSaarthi, a farming copilot for Indian smallholder farmers.

Reply in the language given in FARM CONTEXT. Hindi means Devanagari, simple spoken
Hindi. Maximum 5 short sentences. No markdown, no bullets — this is read aloud.

Never state a raw metric alone; attach it to an action and its financial consequence.

You do NOT compute fertiliser doses, mandi prices, disease diagnoses or risk scores.
Dedicated engines do that. Open the right widget instead of inventing numbers.

Never invent a chemical dose, a scheme amount, or an eligibility rule.

Respond ONLY with a JSON object of this exact shape and nothing else:
{"reply":"<your answer>","actions":[{"widget":"<name>","reason":"<why>","params":{}}],"confidence":<0-1>}

Valid widget names: weather_card, npk_calculator, leaf_diagnostic, mandi_profit,
pmfby_report, farm_risk, scheme_results. Emit at most 2 actions, usually 1.

Leave params as {} — the app fills in coordinates, crop and area itself. Only set
params for: pmfby_report {"cause":"..."} or scheme_results {"query":"..."}.`;

// ─────────────────────────── Service ───────────────────────────
class LyzrAgentService {
  private readonly client: AxiosInstance | null;
  private readonly agentId: string;
  private readonly userId: string;
  private readonly budget = new CreditBudget();

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

  get creditsRemaining(): number {
    return this.budget.remaining;
  }

  async ask(message: string, ctx: AgentContext, sessionId: string): Promise<AgentTurn> {
    const scored = this.scoreIntents(message);
    const topScore = scored[0]?.score ?? 0;

    // Tier 0 — a confident keyword match needs no LLM. Free and instant.
    const CONFIDENT = Number(process.env.LOCAL_INTENT_THRESHOLD || 4);
    if (topScore >= CONFIDENT) {
      return this.localPlanner(message, ctx, sessionId, scored.map((s) => s.rule));
    }

    // Tier 1 — ambiguous or unrecognised. Worth a credit.
    if (this.client && this.budget.canSpend(sessionId)) {
      const remote = await this.callLyzr(message, ctx, sessionId);
      if (remote) {
        this.budget.record(sessionId);
        return remote;
      }
    }

    // Tier 2 — fallback.
    return this.localPlanner(message, ctx, sessionId, scored.map((s) => s.rule));
  }

  // ───────────────── Remote inference ─────────────────
  private async callLyzr(
    message: string,
    ctx: AgentContext,
    sessionId: string,
  ): Promise<AgentTurn | null> {
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

      const parsed = this.parseAgentPayload(data);
      if (!parsed) {
        console.warn('[lyzr] could not extract a usable reply → local planner');
        return null;
      }

      return {
        reply: parsed.reply,
        actions: this.enrich(parsed.actions, ctx),
        language: ctx.language,
        sessionId,
        source: 'lyzr',
        confidence: parsed.confidence,
        creditsRemaining: this.budget.remaining,
      };
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status ?? ''} ${err.message}`
        : String(err);
      console.warn(`[lyzr] inference failed → local planner. ${msg}`);
      return null;
    }
  }

  // ───────────────── Response parsing ─────────────────
  /**
   * Lyzr's payload arrives in one of several shapes depending on whether
   * Output Format is enabled and how the model behaved. Try each in turn.
   */
  private parseAgentPayload(
    data: unknown,
  ): { reply: string; actions: AgentAction[]; confidence: number } | null {
    const root = data as Record<string, any> | null;
    if (!root) return null;

    // Candidate containers, in order of likelihood.
    const candidates: unknown[] = [
      root.response,
      root.message,
      root.output,
      root.data?.response,
      root.result,
      root,
    ];

    for (const candidate of candidates) {
      if (candidate == null) continue;

      // Shape A — already a structured object.
      if (typeof candidate === 'object') {
        const built = this.fromStructured(candidate as Record<string, unknown>);
        if (built) return built;
        continue;
      }

      if (typeof candidate !== 'string') continue;
      const text = candidate.trim();
      if (!text) continue;

      // Shape B — a JSON string, possibly inside a markdown fence.
      const obj = this.extractJsonObject(text);
      if (obj) {
        const built = this.fromStructured(obj);
        if (built) return built;
      }

      // Shape C — plain prose plus a legacy fenced action block.
      const legacy = this.fromLegacyFence(text);
      if (legacy) return legacy;
    }

    return null;
  }

  private fromStructured(
    obj: Record<string, unknown>,
  ): { reply: string; actions: AgentAction[]; confidence: number } | null {
    const rawReply = obj.reply ?? obj.answer ?? obj.text;
    if (typeof rawReply !== 'string' || !rawReply.trim()) return null;

    const reply = this.sanitiseReply(rawReply);
    if (!reply) return null;

    const actions = this.coerceActions(obj.actions);
    const confidence =
      typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
        ? Math.max(0, Math.min(1, obj.confidence))
        : 0.8;

    return { reply, actions, confidence };
  }

  private fromLegacyFence(
    text: string,
  ): { reply: string; actions: AgentAction[]; confidence: number } | null {
    const fence = /```(?:agrisaarthi-actions|json)?\s*([\s\S]*?)```/i;
    const match = text.match(fence);

    const prose = this.sanitiseReply(match ? text.replace(fence, '') : text);
    if (!prose) return null;

    let actions: AgentAction[] = [];
    if (match) {
      try {
        actions = this.coerceActions(JSON.parse(match[1].trim()));
      } catch {
        /* prose alone is still a valid turn */
      }
    }
    return { reply: prose, actions, confidence: 0.7 };
  }

  /**
   * Pull the first balanced {...} out of a string, tolerating markdown fences
   * and any preamble the model added. Brace counting is quote-aware so a
   * closing brace inside a Hindi string does not terminate the scan early.
   */
  private extractJsonObject(text: string): Record<string, unknown> | null {
    let s = text.trim();

    const fence = s.match(/```(?:json|agrisaarthi-actions)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();

    const start = s.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < s.length; i += 1) {
      const ch = s[i];

      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const obj = JSON.parse(s.slice(start, i + 1));
            return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  private coerceActions(raw: unknown): AgentAction[] {
    let list: unknown = raw;
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch { return []; }
    }
    if (!Array.isArray(list)) return [];

    const seen = new Set<WidgetName>();
    const out: AgentAction[] = [];

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const a = item as Record<string, unknown>;
      const widget = String(a.widget ?? a.name ?? '') as WidgetName;
      if (!VALID_WIDGETS.includes(widget)) continue;
      if (seen.has(widget)) continue;       // never mount the same widget twice
      seen.add(widget);

      out.push({
        widget,
        reason: String(a.reason ?? ''),
        params: a.params && typeof a.params === 'object'
          ? (a.params as Record<string, unknown>)
          : {},
      });
      if (out.length >= 2) break;           // two widgets is the ceiling
    }
    return out;
  }

  /**
   * Last line of defence: a farmer must never see raw JSON, a fence, or an
   * empty bubble. Returns '' when the text is unusable, which makes the caller
   * fall through to the local planner.
   */
  private sanitiseReply(raw: string): string {
    let s = raw.trim();

    s = s.replace(/```[\s\S]*?```/g, '').trim();          // stray fences
    s = s.replace(/^\s*(json|agrisaarthi-actions)\s*/i, '').trim();

    // If what remains still looks like a serialised object, reject it.
    if (/^[{[]/.test(s)) return '';
    if (/"(reply|actions|widget|confidence)"\s*:/.test(s)) return '';

    s = s.replace(/\*\*(.*?)\*\*/g, '$1')                  // markdown bold
         .replace(/^#{1,6}\s*/gm, '')                      // headings
         .replace(/^\s*[-*]\s+/gm, '')                     // bullets
         .replace(/\n{3,}/g, '\n\n')
         .trim();

    return s.length >= 2 ? s : '';
  }

  // ───────────────── Deterministic fallback ─────────────────
  private scoreIntents(message: string): Array<{ rule: IntentRule; score: number }> {
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
    // Drop weak co-matches so a passing mention of "rain" does not drag the
    // weather card into a pure mandi question.
    return hits.filter((h) => h.score >= Math.max(2, top - 1));
  }

  private async localPlanner(
    message: string,
    ctx: AgentContext,
    sessionId: string,
    matched: IntentRule[],
  ): Promise<AgentTurn> {
    const rules = matched.length ? matched : [INTENTS[0]];
    const lines: string[] = [];
    const actions: AgentAction[] = [];

    for (const rule of rules.slice(0, 2)) {
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
      confidence: matched.length ? 0.75 : 0.35,
      creditsRemaining: this.budget.remaining,
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
                ? `अभी ${wx.current.temperatureC.toFixed(0)}°C और नमी ${wx.current.humidityPct.toFixed(0)}% है। पूरी सलाह नीचे देखें।`
                : `Right now it is ${wx.current.temperatureC.toFixed(0)}°C with ${wx.current.humidityPct.toFixed(0)}% humidity. Full advice below.`,
            ],
            params: {},
          };
        } catch {
          return {
            lines: [hi
              ? 'मौसम डेटा अभी नहीं मिला — सेव किया हुआ पूर्वानुमान नीचे है।'
              : 'Live weather is unavailable — your saved forecast is below.'],
            params: {},
          };
        }
      }

      case 'npk_calculator':
        return {
          lines: [hi
            ? 'खाद की सही मात्रा नीचे तय करें — ज़रूरत से ज़्यादा यूरिया पैसा और उपज दोनों घटाता है।'
            : 'Set the correct dose below — over-applying urea costs money and lowers yield.'],
          params: {},
        };

      case 'leaf_diagnostic':
        return {
          lines: [hi
            ? 'पत्ती की साफ़ फोटो खींचिए। दवा खरीदने से पहले जाँच ज़रूरी है, वरना गलत दवा पर पैसा बर्बाद होगा।'
            : 'Take a clear photo of the leaf. Diagnose before buying any chemical, or the money goes on the wrong treatment.'],
          params: {},
        };

      case 'mandi_profit':
        return {
          lines: [hi
            ? 'सिर्फ़ भाव मत देखिए — डीज़ल, हम्माली और आढ़त घटाकर असली कमाई नीचे देखिए।'
            : 'Do not judge by the ticker alone — compare true earnings after diesel, handling and commission below.'],
          params: { volumeQuintals: 0 },
        };

      case 'pmfby_report':
        return {
          lines: [hi
            ? 'सैटेलाइट-आधारित PMFBY दावा पासबुक एक क्लिक में बन जाएगी। सूचना 72 घंटे के भीतर देना ज़रूरी है।'
            : 'Your satellite-backed PMFBY passbook generates in one click. Intimation is due within 72 hours.'],
          params: { cause: this.guessCause(message, ctx.language) },
        };

      case 'farm_risk':
        return {
          lines: [hi
            ? 'आपके खेत पर अभी क्या ख़तरा है, नीचे पूरा विश्लेषण देखें।'
            : 'Here is what currently threatens your field.'],
          params: {},
        };

      case 'scheme_results':
        return {
          lines: [hi
            ? 'सरकारी योजनाओं की ताज़ा जानकारी नीचे दिख रही है।'
            : 'Current government scheme information is shown below.'],
          params: { query: message },
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

  /**
   * Real farm context ALWAYS wins over model-supplied params.
   *
   * The model has been observed inventing a location ("Nagpur") while emitting
   * coordinates from somewhere else entirely. Only a small whitelist of params
   * is genuinely the model's to set; the rest come from the verified profile.
   */
  private enrich(actions: AgentAction[], ctx: AgentContext): AgentAction[] {
    return actions.map((a) => {
      const modelParams: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a.params ?? {})) {
        if (MODEL_OWNED_PARAMS.has(k) && v !== null && v !== undefined && v !== '') {
          modelParams[k] = v;
        }
      }
      return {
        ...a,
        params: {
          ...modelParams,
          // Authoritative — overrides anything the model claimed.
          lat: ctx.lat,
          lon: ctx.lon,
          crop: ctx.crop,
          areaHa: ctx.areaHa,
          state: ctx.state,
          district: ctx.district,
        },
      };
    });
  }
}

export const lyzrAgent = new LyzrAgentService();