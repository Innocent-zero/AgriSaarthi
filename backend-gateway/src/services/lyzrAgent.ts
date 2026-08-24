/**
 * Hybrid Orchestrator — LOCAL MODE.
 *
 * In production this delegates to a Lyzr agent. Here a deterministic intent
 * engine produces the identical dual output: conversational guidance in the
 * farmer's language, plus a structured widget-mount action envelope for the
 * Next.js renderer.
 *
 * Advantages while developing: zero latency, zero cost, fully reproducible.
 * Trade-off: keyword-driven rather than semantically flexible — an unusual
 * phrasing falls through to the default weather intent rather than being
 * genuinely understood. Swap this file back once your Lyzr key lands.
 */
import { swytchcode } from './swytchcodeService';

export type WidgetName =
  | 'weather_card'
  | 'npk_calculator'
  | 'leaf_diagnostic'
  | 'mandi_profit'
  | 'pmfby_report'
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
  source: 'local-planner';
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

interface IntentRule {
  widget: WidgetName;
  reason: string;
  /** weight 2 = strong signal, 1 = supporting signal */
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
    strong: ['disease', 'blight', 'rust', 'mildew', 'fungus', 'pest', 'insect', 'infection',
             'बीमारी', 'रोग', 'कीट', 'फफूंद', 'झुलसा', 'रतुआ'],
    weak: ['leaf', 'leaves', 'spot', 'yellow', 'yellowing', 'wilting', 'drying', 'photo',
           'पत्ती', 'पत्ते', 'धब्बा', 'पीला', 'पीली', 'सूख', 'मुरझा'],
  },
  {
    widget: 'mandi_profit',
    reason: 'Selling and market decision',
    strong: ['mandi', 'market', 'sell', 'selling', 'price', 'rate', 'apmc', 'trader', 'buyer',
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
    widget: 'scheme_results',
    reason: 'Government scheme enquiry',
    strong: ['scheme', 'subsidy', 'yojana', 'pm-kisan', 'pm kisan', 'kisan samman', 'loan', 'kcc',
             'योजना', 'सब्सिडी', 'अनुदान', 'सम्मान निधि', 'ऋण', 'कर्ज'],
    weak: ['government', 'sarkar', 'apply', 'eligible', 'benefit', 'registration', 'installment',
           'सरकार', 'सरकारी', 'आवेदन', 'पात्र', 'लाभ', 'किस्त', 'पंजीकरण'],
  },
];

/** Bounded in-process session memory — replaces Lyzr's server-side sessions. */
interface SessionState {
  turns: number;
  lastWidgets: WidgetName[];
  lastSeen: number;
}
const SESSIONS = new Map<string, SessionState>();
const SESSION_CAP = 500;

function touchSession(sessionId: string, widgets: WidgetName[]): SessionState {
  if (SESSIONS.size >= SESSION_CAP) {
    // Evict the coldest third rather than one entry at a time.
    const sorted = [...SESSIONS.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    sorted.slice(0, Math.floor(SESSION_CAP / 3)).forEach(([k]) => SESSIONS.delete(k));
  }
  const prev = SESSIONS.get(sessionId) ?? { turns: 0, lastWidgets: [], lastSeen: 0 };
  const next: SessionState = {
    turns: prev.turns + 1,
    lastWidgets: widgets,
    lastSeen: Date.now(),
  };
  SESSIONS.set(sessionId, next);
  return next;
}

class LocalAgentService {
  readonly mode = 'local-planner' as const;

  async ask(message: string, ctx: AgentContext, sessionId: string): Promise<AgentTurn> {
    const hi = ctx.language === 'hi';
    const scored = this.scoreIntents(message);

    // Nothing matched — default to the weather advisory, the highest-value
    // answer when we cannot tell what was asked.
    const matched = scored.length > 0
      ? scored
      : [{ rule: INTENTS[0], score: 1 }];

    const lines: string[] = [];
    const actions: AgentAction[] = [];
    const session = SESSIONS.get(sessionId);

    if (!session && ctx.farmerName) {
      lines.push(hi ? `नमस्ते ${ctx.farmerName} जी।` : `Namaste ${ctx.farmerName}.`);
    }

    for (const { rule } of matched.slice(0, 3)) {
      const built = await this.buildFor(rule.widget, message, ctx);
      lines.push(...built.lines);
      actions.push({ widget: rule.widget, reason: rule.reason, params: built.params });
    }

    touchSession(sessionId, actions.map((a) => a.widget));

    return {
      reply: lines.filter(Boolean).join(' '),
      actions: this.enrich(actions, ctx),
      language: ctx.language,
      sessionId,
      source: 'local-planner',
    };
  }

  /** Weighted keyword scoring; returns matched rules sorted by confidence. */
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
    // Keep only intents within striking distance of the top match, so a passing
    // mention of "rain" doesn't drag the weather card into a pure mandi question.
    const top = hits[0]?.score ?? 0;
    return hits.filter((h) => h.score >= Math.max(2, top - 1));
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
          const lines = [
            hi
              ? `अभी ${wx.current.temperatureC.toFixed(0)}°C, नमी ${wx.current.humidityPct.toFixed(0)}%.`
              : `Right now it is ${wx.current.temperatureC.toFixed(0)}°C with ${wx.current.humidityPct.toFixed(0)}% humidity.`,
            wx.advisories[0],
          ];
          if (wx.advisories[1]) lines.push(wx.advisories[1]);
          return { lines, params: {} };
        } catch {
          return {
            lines: [
              hi
                ? 'मौसम डेटा अभी नहीं मिल पाया — कार्ड खोलकर सेव किया हुआ पूर्वानुमान देखें।'
                : 'Live weather is unavailable — open the card to view your last saved forecast.',
            ],
            params: {},
          };
        }
      }

      case 'npk_calculator': {
        let texture = '';
        try {
          const soil = await swytchcode.getSoil(ctx.lat, ctx.lon);
          texture = soil.texture;
        } catch { /* calculator fetches soil itself */ }
        return {
          lines: [
            texture
              ? hi
                ? `आपकी ${texture} के हिसाब से खाद की सही मात्रा नीचे तय करें।`
                : `Your soil is ${texture.toLowerCase()} — set the right dose below.`
              : hi
                ? 'खाद की सही मात्रा नीचे कैलकुलेटर में तय करें।'
                : 'Set the correct dose in the calculator below.',
            hi
              ? 'ज़रूरत से ज़्यादा यूरिया पैसा और उपज दोनों घटाता है।'
              : 'Over-applying urea costs money and lowers yield.',
          ],
          params: { crop: ctx.crop, areaHa: ctx.areaHa },
        };
      }

      case 'leaf_diagnostic':
        return {
          lines: [
            hi
              ? 'पत्ती की साफ़ फोटो खींचिए — हल्का मॉडल कमज़ोर नेटवर्क पर भी तुरंत बीमारी पहचान लेगा।'
              : 'Take a clear photo of the leaf — the lightweight model identifies the disease instantly, even on a weak network.',
            hi
              ? 'दवा खरीदने से पहले जाँच ज़रूर करें, वरना गलत दवा पर पैसा बर्बाद होगा।'
              : 'Diagnose before buying chemicals, or the money goes on the wrong treatment.',
          ],
          params: {},
        };

      case 'mandi_profit':
        return {
          lines: [
            hi
              ? 'सिर्फ़ भाव मत देखिए — डीज़ल, हम्माली और आढ़त घटाने के बाद असली कमाई नीचे तुलना में देखिए।'
              : 'Do not judge by the ticker alone — compare true earnings after diesel, handling and commission below.',
          ],
          params: { crop: ctx.crop ?? 'Wheat', volumeQuintals: 0 },
        };

      case 'pmfby_report':
        return {
          lines: [
            hi
              ? 'नुकसान का सैटेलाइट-आधारित PMFBY दावा पासबुक एक क्लिक में बन जाएगा।'
              : 'Your satellite-backed PMFBY claim passbook can be generated in one click.',
            hi
              ? 'याद रखें — नुकसान की सूचना 72 घंटे के भीतर देना ज़रूरी है।'
              : 'Remember, loss intimation must be filed within 72 hours.',
          ],
          params: { cause: this.guessCause(message, ctx.language) },
        };

      case 'scheme_results':
        return {
          lines: [
            hi
              ? 'सरकारी योजनाओं की जानकारी नीचे दिख रही है।'
              : 'Government scheme information is shown below.',
          ],
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

  /** Backfills farm context into every widget's params. */
  private enrich(actions: AgentAction[], ctx: AgentContext): AgentAction[] {
    return actions.map((a) => ({
      ...a,
      params: {
        lat: ctx.lat,
        lon: ctx.lon,
        crop: ctx.crop,
        areaHa: ctx.areaHa,
        state: ctx.state,
        district: ctx.district,
        ...a.params,
      },
    }));
  }
}

export const lyzrAgent = new LocalAgentService();