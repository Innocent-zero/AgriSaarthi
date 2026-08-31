'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, User, Loader2, WifiOff, ExternalLink, BookOpen} from 'lucide-react';
import { api, AgentAction, SchemeAnswer, friendlyError } from '@/lib/api';
import { appendChat, recentChat, clearChat } from '@/lib/idb';
import { makeT, Locale } from '@/lib/i18n';
import WeatherPanel from './WeatherPanel';
import NpkCalculatorWidget from './NpkCalculatorWidget';
import LeafDiagnosticModal from './LeafDiagnosticModal';
import MandiProfitWidget from './MandiProfitWidget';
import PmfbyReportDownload from './PmfbyReportDownload';
import FarmRiskWidget from './FarmRiskWidget';

interface Farm {
  lat: number;
  lon: number;
  crop: string;
  areaHa: number;
  state?: string;
  district?: string;
  farmerName: string;
  language: Locale;
  boundary?: Array<{ lat: number; lon: number }>;
}

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions?: AgentAction[];
  offline?: boolean;
}

interface Props {
  farm: Farm;
  pendingMessage?: { text: string; nonce: number } | null;
  onReply?: (text: string) => void;
}

function SchemeCard({ query, state, language }: { query: string; state?: string; language: Locale }) {
  const t = makeT(language);
  const [data, setData] = useState<SchemeAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // A missing/near-empty query means the agent didn't name a specific
    // scheme — the gateway now falls back to a broad search for this case,
    // but there's no reason to send a near-blank request in the first place.
    const q = query.trim().length >= 2
      ? query.trim()
      : (language === 'hi' ? 'किसानों के लिए सरकारी योजनाएं और लाभ' : 'government schemes and benefits for farmers');
    api.schemes(q, state, language)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(friendlyError(e)));
    return () => { alive = false; };
  }, [query, state, language]);

  if (err) return <p className="rounded-xl bg-alert-400/10 p-3 text-xs text-alert-600">{err}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-leaf-50 p-4 text-xs text-leaf-700">
        <Loader2 size={14} className="animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="animate-slideUp rounded-2xl border border-leaf-100 bg-white p-4 shadow-card">
      {data.grounded && (
        <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-leaf-50 px-2 py-0.5 text-[10px] font-semibold text-leaf-700">
          <BookOpen size={10} /> {t('rag.grounded')}
        </p>
      )}

      <p className="mb-2 whitespace-pre-line text-sm leading-relaxed text-soil-900">{data.summary}</p>

      <div className="space-y-2">
        {data.results.slice(0, 4).map((r) => (
          <a key={`${r.title}-${r.url}`} href={r.url || undefined} target="_blank" rel="noreferrer"
             className="block rounded-lg border border-leaf-50 p-2.5 transition hover:bg-leaf-50">
            <p className="flex items-start gap-1 text-xs font-semibold text-leaf-700">
              {r.title}
              {r.url && <ExternalLink size={11} className="mt-0.5 shrink-0" />}
            </p>
            <p className="mt-1 line-clamp-2 text-[11px] text-soil-700">{r.snippet}</p>
            <p className="mt-1 text-[10px] text-soil-700/60">
              {r.domain}{r.official && ` · ${t('rag.official')}`}
            </p>
          </a>
        ))}
      </div>

      {!data.grounded && data.source === 'live-search' && (
        <p className="mt-2 text-[10px] text-harvest-600">{t('rag.liveOnly')}</p>
      )}
    </div>
  );
}

export default function HybridCopilotChat({ farm, pendingMessage, onReply }: Props) {
  const t = makeT(farm.language);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastNonce = useRef<number>(-1);

  useEffect(() => {
    recentChat(12).then((history) => {
      if (history.length) {
        setTurns(history.map((h, i) => ({
          id: `h${i}`,
          role: h.role,
          text: h.text,
          actions: (h.actions as AgentAction[] | undefined) ?? undefined,
        })));
      }
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setTurns((s) => [...s, { id: `u${Date.now()}`, role: 'user', text: message }]);
    void appendChat({ role: 'user', text: message, at: Date.now() });
    setBusy(true);

    try {
      const res = await api.askAgent(
        message,
        {
          lat: farm.lat, lon: farm.lon, crop: farm.crop, areaHa: farm.areaHa,
          state: farm.state, district: farm.district,
          language: farm.language, farmerName: farm.farmerName,
        },
        sessionId,
      );
      setSessionId(res.sessionId);
      setTurns((s) => [...s, { id: `a${Date.now()}`, role: 'assistant', text: res.reply, actions: res.actions }]);
      void appendChat({ role: 'assistant', text: res.reply, at: Date.now(), actions: res.actions });
      onReply?.(res.reply);
    } catch (e) {
      setTurns((s) => [...s, { id: `e${Date.now()}`, role: 'assistant', text: friendlyError(e), offline: true }]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (pendingMessage && pendingMessage.nonce !== lastNonce.current) {
      lastNonce.current = pendingMessage.nonce;
      void send(pendingMessage.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage]);

  function renderAction(action: AgentAction, key: string) {
    const p = action.params as Record<string, any>;
    switch (action.widget) {
      case 'weather_card':
        return <WeatherPanel key={key} lat={farm.lat} lon={farm.lon} language={farm.language} />;
      case 'npk_calculator':
        return <NpkCalculatorWidget key={key} lat={farm.lat} lon={farm.lon}
                                    crop={String(p.crop ?? farm.crop)}
                                    areaHa={Number(p.areaHa ?? farm.areaHa)}
                                    boundary={farm.boundary}
                                    language={farm.language} />;
      case 'leaf_diagnostic':
        return <LeafDiagnosticModal key={key} crop={farm.crop} language={farm.language} />;
      case 'mandi_profit':
        return <MandiProfitWidget key={key} lat={farm.lat} lon={farm.lon}
                                  crop={String(p.crop ?? farm.crop)} language={farm.language} />;
      case 'pmfby_report':
        return <PmfbyReportDownload key={key} lat={farm.lat} lon={farm.lon} crop={farm.crop}
                                    areaHa={farm.areaHa} farmerName={farm.farmerName}
                                    boundary={farm.boundary} language={farm.language}
                                    defaultCause={p.cause ? String(p.cause) : undefined} />;
      case 'farm_risk':
        return <FarmRiskWidget key={key} lat={farm.lat} lon={farm.lon}
                               crop={farm.crop} state={farm.state} language={farm.language} />;
      case 'scheme_results':
        return <SchemeCard key={key} query={String(p.query ?? '')} state={farm.state} language={farm.language} />;
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col">
      {turns.length > 0 && (
        <div className="mb-2 flex justify-end">
          <button
            onClick={async () => { await clearChat(); setTurns([]); setSessionId(undefined); }}
            className="rounded-full border border-leaf-100 px-3 py-1 text-[11px] font-semibold text-soil-700 transition hover:bg-leaf-50"
          >
            {t('chat.new')}
          </button>
        </div>
      )}

      <div ref={scrollRef} className="space-y-4">
        {turns.length === 0 && (
          <div className="rounded-2xl border border-dashed border-leaf-100 p-6 text-center">
            <Bot size={28} className="mx-auto text-leaf-500" />
            <p className="mt-2 text-sm font-semibold text-soil-900">{t('chat.empty.title')}</p>
            <p className="mt-1 text-xs text-soil-700">{t('chat.empty.sub')}</p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="space-y-3">
            <div className={`flex gap-2 ${turn.role === 'user' ? 'justify-end' : ''}`}>
              {turn.role === 'assistant' && (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-leaf-600 text-white">
                  <Bot size={14} />
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                turn.role === 'user'
                  ? 'bg-soil-900 text-white'
                  : turn.offline ? 'bg-harvest-400/12 text-soil-900' : 'bg-leaf-50 text-soil-900'
              }`}>
                {turn.offline && <WifiOff size={12} className="mb-1 inline text-harvest-600" />} {turn.text}
              </div>
              {turn.role === 'user' && (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-soil-100 text-soil-700">
                  <User size={14} />
                </div>
              )}
            </div>
            {turn.actions?.map((a, i) => renderAction(a, `${turn.id}-${a.widget}-${i}`))}
          </div>
        ))}

        {busy && (
          <div className="flex gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-leaf-600 text-white">
              <Bot size={14} />
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-leaf-50 px-3.5 py-2.5 text-sm text-leaf-700">
              <Loader2 size={14} className="animate-spin" /> {t('chat.thinking')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}