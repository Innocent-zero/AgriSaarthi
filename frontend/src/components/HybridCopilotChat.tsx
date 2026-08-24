'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, User, Loader2, WifiOff, CloudSun, Droplets, Wind, ExternalLink } from 'lucide-react';
import { api, AgentAction, WeatherSnapshot, SchemeAnswer, friendlyError } from '@/lib/api';
import { appendChat, recentChat, clearChat, cacheAdvisory, readAdvisory } from '@/lib/idb';
import NpkCalculatorWidget from './NpkCalculatorWidget';
import LeafDiagnosticModal from './LeafDiagnosticModal';
import MandiProfitWidget from './MandiProfitWidget';
import PmfbyReportDownload from './PmfbyReportDownload';

interface Farm {
  lat: number;
  lon: number;
  crop: string;
  areaHa: number;
  state?: string;
  district?: string;
  farmerName: string;
  language: 'hi' | 'en';
  boundary?: Array<{ lat: number; lon: number }>;
}

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions?: AgentAction[];
  offline?: boolean;
}

export interface CopilotHandle {
  send: (message: string) => void;
}

interface Props {
  farm: Farm;
  pendingMessage?: { text: string; nonce: number } | null;
  onReply?: (text: string) => void;
}

// ── Inline weather card (mounted by the weather_card action) ──
function WeatherCard({ lat, lon, language }: { lat: number; lon: number; language: 'hi' | 'en' }) {
  const [wx, setWx] = useState<WeatherSnapshot | null>(null);
  const [stale, setStale] = useState(false);
  const hi = language === 'hi';

  useEffect(() => {
    let alive = true;
    (async () => {
      const key = `wx:${lat.toFixed(3)}:${lon.toFixed(3)}`;
      const cached = await readAdvisory<WeatherSnapshot>(key);
      if (cached && alive) { setWx(cached); setStale(true); }
      try {
        const fresh = await api.weather(lat, lon);
        if (!alive) return;
        setWx(fresh);
        setStale(false);
        await cacheAdvisory(key, fresh);
      } catch { /* cached copy stands */ }
    })();
    return () => { alive = false; };
  }, [lat, lon]);

  if (!wx) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-leaf-50 p-4 text-xs text-leaf-700">
        <Loader2 size={14} className="animate-spin" /> {hi ? 'मौसम आ रहा है…' : 'Loading weather…'}
      </div>
    );
  }

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center justify-between bg-gradient-to-r from-leaf-600 to-leaf-500 px-4 py-3 text-white">
        <div>
          <p className="text-2xl font-bold">{wx.current.temperatureC.toFixed(0)}°C</p>
          <p className="text-[11px] opacity-85">{hi ? 'अभी का मौसम' : 'Current conditions'}</p>
        </div>
        <CloudSun size={30} className="opacity-85" />
      </div>

      <div className="grid grid-cols-3 gap-px bg-leaf-50">
        {[
          { i: <Droplets size={13} />, l: hi ? 'नमी' : 'Humidity', v: `${wx.current.humidityPct.toFixed(0)}%` },
          { i: <Wind size={13} />, l: hi ? 'हवा' : 'Wind', v: `${wx.current.windSpeedKmh.toFixed(0)} km/h` },
          { i: <CloudSun size={13} />, l: hi ? 'बारिश' : 'Rain', v: `${wx.current.precipitationMm.toFixed(1)} mm` },
        ].map((s) => (
          <div key={s.l} className="bg-white px-2 py-2.5 text-center">
            <div className="flex justify-center text-leaf-600">{s.i}</div>
            <p className="mt-0.5 text-[10px] text-soil-700/70">{s.l}</p>
            <p className="text-sm font-semibold text-soil-900">{s.v}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1.5 p-3">
        {wx.advisories.map((a) => (
          <div key={a} className="flex gap-2 rounded-lg bg-harvest-400/12 p-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-harvest-500" />
            <p className="text-xs leading-relaxed text-soil-900">{a}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">
        {wx.daily.slice(0, 5).map((d) => (
          <div key={d.date} className="min-w-[62px] shrink-0 rounded-lg bg-soil-50 p-2 text-center">
            <p className="text-[9px] text-soil-700/70">
              {new Date(d.date).toLocaleDateString(hi ? 'hi-IN' : 'en-IN', { weekday: 'short' })}
            </p>
            <p className="text-xs font-bold text-soil-900">{d.tMaxC.toFixed(0)}°</p>
            <p className="text-[9px] text-leaf-600">{d.rainMm.toFixed(0)}mm</p>
          </div>
        ))}
      </div>

      {stale && (
        <p className="flex items-center gap-1 bg-soil-50 px-3 py-1.5 text-[10px] text-soil-700">
          <WifiOff size={10} /> {hi ? 'सेव किया हुआ पूर्वानुमान' : 'Showing saved forecast'}
        </p>
      )}
    </div>
  );
}

// ── Inline scheme results (mounted by the scheme_results action) ──
function SchemeCard({ query, state, language }: { query: string; state?: string; language: 'hi' | 'en' }) {
  const [data, setData] = useState<SchemeAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const hi = language === 'hi';

  useEffect(() => {
    let alive = true;
    api.schemes(query, state, language)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(friendlyError(e)));
    return () => { alive = false; };
  }, [query, state, language]);

  if (err) return <p className="rounded-xl bg-alert-400/10 p-3 text-xs text-alert-600">{err}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-leaf-50 p-4 text-xs text-leaf-700">
        <Loader2 size={14} className="animate-spin" /> {hi ? 'योजनाएँ खोजी जा रही हैं…' : 'Searching schemes…'}
      </div>
    );
  }

  return (
    <div className="animate-slideUp rounded-2xl border border-leaf-100 bg-white p-4 shadow-card">
      <p className="mb-2 text-sm leading-relaxed text-soil-900">{data.summary}</p>
      <div className="space-y-2">
        {data.results.slice(0, 4).map((r) => (
          <a key={r.url} href={r.url} target="_blank" rel="noreferrer"
             className="block rounded-lg border border-leaf-50 p-2.5 transition hover:bg-leaf-50">
            <p className="flex items-start gap-1 text-xs font-semibold text-leaf-700">
              {r.title}
              <ExternalLink size={11} className="mt-0.5 shrink-0" />
            </p>
            <p className="mt-1 line-clamp-2 text-[11px] text-soil-700">{r.snippet}</p>
            <p className="mt-1 text-[10px] text-soil-700/60">
              {r.domain}{r.official && ` · ${hi ? 'सरकारी स्रोत' : 'Official source'}`}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Main chat ──
export default function HybridCopilotChat({ farm, pendingMessage, onReply }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastNonce = useRef<number>(-1);
  const hi = farm.language === 'hi';

  useEffect(() => {
    recentChat(12).then((history) => {
      if (history.length) {
        setTurns(
          history.map((h, i) => ({
            id: `h${i}`,
            role: h.role,
            text: h.text,
            actions: (h.actions as AgentAction[] | undefined) ?? undefined,
          })),
        );
      }
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    const userTurn: Turn = { id: `u${Date.now()}`, role: 'user', text: message };
    setTurns((t) => [...t, userTurn]);
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
      const reply: Turn = { id: `a${Date.now()}`, role: 'assistant', text: res.reply, actions: res.actions };
      setTurns((t) => [...t, reply]);
            void appendChat({ role: 'assistant', text: res.reply, at: Date.now(), actions: res.actions });
      onReply?.(res.reply);
    } catch (e) {
      setTurns((t) => [...t, {
        id: `e${Date.now()}`,
        role: 'assistant',
        text: friendlyError(e),
        offline: true,
      }]);
    } finally {
      setBusy(false);
    }
  }

  // Parent (voice bar) pushes messages in via a nonce-guarded prop.
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
        return <WeatherCard key={key} lat={farm.lat} lon={farm.lon} language={farm.language} />;
      case 'npk_calculator':
        return (
          <NpkCalculatorWidget key={key} lat={farm.lat} lon={farm.lon}
                               crop={String(p.crop ?? farm.crop)}
                               areaHa={Number(p.areaHa ?? farm.areaHa)}
                               language={farm.language} />
        );
      case 'leaf_diagnostic':
        return <LeafDiagnosticModal key={key} crop={farm.crop} language={farm.language} />;
      case 'mandi_profit':
        return <MandiProfitWidget key={key} lat={farm.lat} lon={farm.lon} crop={String(p.crop ?? farm.crop)} language={farm.language} />;
      case 'pmfby_report':
        return (
          <PmfbyReportDownload key={key} lat={farm.lat} lon={farm.lon} crop={farm.crop}
                               areaHa={farm.areaHa} farmerName={farm.farmerName}
                               boundary={farm.boundary} language={farm.language}
                               defaultCause={p.cause ? String(p.cause) : undefined} />
        );
      case 'scheme_results':
        return <SchemeCard key={key} query={String(p.query ?? '')} state={farm.state} language={farm.language} />;
      default:
        return null;
    }
  }

  return (
    <div className="flex h-full flex-col">
      {turns.length > 0 && (
        <div className="mb-2 flex justify-end">
          <button
            onClick={async () => { await clearChat(); setTurns([]); setSessionId(undefined); }}
            className="rounded-full border border-leaf-100 px-3 py-1 text-[11px] font-semibold text-soil-700 transition hover:bg-leaf-50"
          >
            {hi ? 'नई बातचीत' : 'New conversation'}
          </button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-2">
        {turns.length === 0 && (
          <div className="rounded-2xl border border-dashed border-leaf-100 p-6 text-center">
            <Bot size={28} className="mx-auto text-leaf-500" />
            <p className="mt-2 text-sm font-semibold text-soil-900">
              {hi ? 'नमस्ते! मैं आपका खेती सहायक हूँ।' : 'Namaste! I am your farming copilot.'}
            </p>
            <p className="mt-1 text-xs text-soil-700">
              {hi ? 'माइक दबाकर अपनी भाषा में सवाल पूछिए।' : 'Tap the mic and ask in your own language.'}
            </p>
          </div>
        )}

        {turns.map((t) => (
          <div key={t.id} className="space-y-3">
            <div className={`flex gap-2 ${t.role === 'user' ? 'justify-end' : ''}`}>
              {t.role === 'assistant' && (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-leaf-600 text-white">
                  <Bot size={14} />
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                t.role === 'user'
                  ? 'bg-soil-900 text-white'
                  : t.offline
                    ? 'bg-harvest-400/12 text-soil-900'
                    : 'bg-leaf-50 text-soil-900'
              }`}>
                {t.offline && <WifiOff size={12} className="mb-1 inline text-harvest-600" />} {t.text}
              </div>
              {t.role === 'user' && (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-soil-100 text-soil-700">
                  <User size={14} />
                </div>
              )}
            </div>

            {t.actions?.map((a, i) => renderAction(a, `${t.id}-${a.widget}-${i}`))}
          </div>
        ))}

        {busy && (
          <div className="flex gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-leaf-600 text-white">
              <Bot size={14} />
            </div>
            <div className="flex items-center gap-2 rounded-2xl bg-leaf-50 px-3.5 py-2.5 text-sm text-leaf-700">
              <Loader2 size={14} className="animate-spin" />
              {hi ? 'सोच रहा हूँ…' : 'Thinking…'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}