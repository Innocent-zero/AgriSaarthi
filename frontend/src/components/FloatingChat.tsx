import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageCircle, X, Send, Mic, MicOff, Minus, Maximize2, Volume2, Languages,
  Sparkles, Bot, User, Loader2, WifiOff, ExternalLink, BookOpen,
} from 'lucide-react';
import type { TFunc, Locale } from '@/lib/i18n';
import type { Farm } from '@/App';
import type { ViewKey } from '@/components/NavDrawer';
import { api, type AgentAction, type SchemeAnswer, friendlyError } from '@/lib/api';
import { appendChat, recentChat, clearChat } from '@/lib/idb';
import WeatherPanel from '@/components/WeatherPanel';
import NpkCalculatorWidget from '@/components/NpkCalculatorWidget';
import LeafDiagnosticModal from '@/components/LeafDiagnosticModal';
import MandiProfitWidget from '@/components/MandiProfitWidget';
import PmfbyReportDownload from '@/components/PmfbyReportDownload';
import FarmRiskWidget from '@/components/FarmRiskWidget';

interface Props {
  t: TFunc;
  farm: Farm;
  currentView: ViewKey;
  language: Locale;
  onLanguageChange: (l: Locale) => void;
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions?: AgentAction[];
  offline?: boolean;
}

/**
 * Quick prompts keyed to the page the farmer is on, so they never have to
 * compose a question from nothing. Mirrors the old frontend's context map.
 */
const CONTEXT_PROMPTS: Record<ViewKey, string[]> = {
  home: ['chat.q.today', 'chat.q.spray', 'chat.q.rate'],
  weather: ['chat.q.spray', 'chat.q.rainTomorrow', 'chat.q.doNow'],
  disease: ['chat.q.whatIsThis', 'chat.q.howSerious', 'chat.q.whatDo'],
  mandi: ['chat.q.bestMandi', 'chat.q.worthDistance', 'chat.q.rate'],
  npk: ['chat.q.whyDose', 'chat.q.whenApply'],
  risk: ['chat.q.whyRisk', 'chat.q.firstAction'],
  pmfby: ['chat.q.claimHow', 'chat.q.claimTime'],
  schemes: ['chat.q.whichScheme', 'chat.q.eligible'],
};

/** Rendered for a scheme_results action — a grounded live-search summary. */
function SchemeCard({ query, state, language, t }: { query: string; state?: string; language: Locale; t: TFunc }) {
  const [data, setData] = useState<SchemeAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
        <Loader2 size={14} className="animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="animate-slideUp rounded-2xl border border-soil-100 bg-white p-4 shadow-card">
      {data.grounded && (
        <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-leaf-50 px-2 py-0.5 text-[10px] font-semibold text-leaf-700">
          <BookOpen size={10} /> {t('rag.grounded')}
        </p>
      )}
      <p className="mb-2 whitespace-pre-line text-sm leading-relaxed text-soil-900">{data.summary}</p>
      <div className="space-y-2">
        {data.results.slice(0, 4).map((r) => (
          <a key={`${r.title}-${r.url}`} href={r.url || undefined} target="_blank" rel="noreferrer"
             className="block rounded-lg border border-soil-50 p-2.5 transition hover:bg-leaf-50">
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
    </div>
  );
}

export default function FloatingChat({ t, farm, currentView, language, onLanguageChange }: Props) {
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [lastReply, setLastReply] = useState('');
  const [unseen, setUnseen] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── load persisted history on first mount ──
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

  // ── voice recognition (kept from Bolt's shell) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const rec: SpeechRecognitionLike = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setText(transcript);
      const isFinal = event.results[event.results.length - 1]?.isFinal;
      if (isFinal && transcript.trim()) {
        setListening(false);
        void send(transcript.trim());
        setText('');
      }
    };
    rec.onerror = (e: any) => {
      setListening(false);
      const map: Record<string, string> = {
        'no-speech': t('voice.noSpeech'),
        'not-allowed': t('voice.notAllowed'),
        network: t('voice.network'),
      };
      setVoiceError(map[e?.error] ?? t('voice.generic'));
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    return () => { try { rec.abort(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, busy, open]);

  useEffect(() => {
    if (lastReply && !open) setUnseen(true);
  }, [lastReply, open]);

  const toggleMic = useCallback(() => {
    setVoiceError(null);
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) { rec.stop(); setListening(false); return; }
    rec.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    try { rec.start(); setListening(true); }
    catch { setVoiceError(t('voice.generic')); }
  }, [language, listening, t]);

  const speak = useCallback(() => {
    if (!lastReply || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(lastReply);
    u.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
    u.rate = 0.92;
    window.speechSynthesis.speak(u);
  }, [lastReply, language]);

  // ── real agent call, with IndexedDB persistence ──
  async function send(message: string) {
    if (!message.trim() || busy) return;
    if (!open) setOpen(true);
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
      setLastReply(res.reply);
    } catch (e) {
      const msg = friendlyError(e);
      setTurns((s) => [...s, { id: `e${Date.now()}`, role: 'assistant', text: msg, offline: true }]);
    } finally {
      setBusy(false);
    }
  }

  function submit(value: string) {
    const v = value.trim();
    if (!v || busy) return;
    void send(v);
    setText('');
  }

  async function newChat() {
    await clearChat();
    setTurns([]);
    setSessionId(undefined);
  }

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
        return <SchemeCard key={key} query={String(p.query ?? '')} state={farm.state} language={farm.language} t={t} />;
      default:
        return null;
    }
  }

  const prompts = CONTEXT_PROMPTS[currentView] ?? CONTEXT_PROMPTS.home;

  // ── collapsed ──
  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setUnseen(false); }}
        data-chat-trigger
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-leaf-600 text-white shadow-lift transition hover:bg-leaf-700 active:scale-95"
        aria-label={t('chat.open')}
      >
        <MessageCircle size={24} />
        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-harvest-500 text-[10px] font-bold">
          {unseen ? <span className="h-2 w-2 rounded-full bg-white" /> : <Sparkles size={11} />}
        </span>
      </button>
    );
  }

  const widthClass = maximized ? 'sm:w-[420px]' : 'sm:w-[360px]';
  const heightClass = maximized ? 'h-[560px]' : 'h-[440px]';

  // ── expanded ──
  return (
    <div
      className={`fixed bottom-5 right-5 z-40 flex w-[calc(100vw-2.5rem)] ${widthClass} ${heightClass} flex-col overflow-hidden rounded-2xl border border-soil-100 bg-white shadow-lift animate-scaleIn`}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 bg-leaf-600 px-4 py-3 text-white">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
          <Sparkles size={16} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold leading-tight">{t('chat.title')}</p>
          <p className="text-[10px] opacity-80">{t('chat.empty.sub')}</p>
        </div>
        {turns.length > 0 && (
          <button
            onClick={newChat}
            className="rounded-lg px-2 py-1 text-[10px] font-semibold transition hover:bg-white/20"
          >
            {t('chat.new')}
          </button>
        )}
        <button
          onClick={() => onLanguageChange(language === 'hi' ? 'en' : 'hi')}
          className="rounded-lg p-1.5 transition hover:bg-white/20"
          aria-label="Switch language"
        >
          <Languages size={15} />
        </button>
        <button
          onClick={() => setMaximized(!maximized)}
          className="rounded-lg p-1.5 transition hover:bg-white/20"
          aria-label={maximized ? t('chat.restore') : t('chat.maximise')}
        >
          {maximized ? <Minus size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 transition hover:bg-white/20"
          aria-label={t('chat.close')}
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-soil-50/50 p-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-leaf-100 text-leaf-600">
              <Sparkles size={22} />
            </div>
            <p className="mt-3 text-sm font-semibold text-soil-900">{t('chat.empty.title')}</p>
            <p className="mt-1 text-xs text-soil-500">{t('chat.empty.sub')}</p>
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="space-y-3">
              <div className={`flex gap-2 ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {turn.role === 'assistant' && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-leaf-600 text-white">
                    <Bot size={14} />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    turn.role === 'user'
                      ? 'bg-leaf-600 text-white rounded-br-md'
                      : turn.offline
                        ? 'bg-harvest-400/12 text-soil-900 rounded-bl-md'
                        : 'bg-white text-soil-900 border border-soil-100 rounded-bl-md'
                  }`}
                >
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
          ))
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-white border border-soil-100 px-3.5 py-2.5">
              <span className="h-2 w-2 animate-bounce rounded-full bg-leaf-400" style={{ animationDelay: '0ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-leaf-400" style={{ animationDelay: '150ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-leaf-400" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* Contextual quick prompts */}
      {turns.length === 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {prompts.map((k) => (
            <button
              key={k}
              onClick={() => submit(t(k))}
              disabled={busy}
              className="chip border border-soil-200 bg-white text-leaf-700 hover:bg-leaf-50 disabled:opacity-40"
            >
              {t(k)}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-soil-100 p-3">
        {voiceError && <p className="mb-1.5 text-center text-[11px] text-alert-600">{voiceError}</p>}
        {listening && (
          <p className="mb-1.5 text-center text-[11px] font-medium text-alert-600">{t('chat.listening')}</p>
        )}
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit(text)}
            placeholder={t('chat.ph')}
            className="min-w-0 flex-1 bg-transparent text-sm text-soil-900 outline-none placeholder:text-soil-400"
            disabled={busy}
          />
          {lastReply && (
            <button
              onClick={speak}
              className="shrink-0 rounded-lg p-2 text-leaf-600 transition hover:bg-leaf-50"
              aria-label="Read aloud"
            >
              <Volume2 size={17} />
            </button>
          )}
          <button
            onClick={toggleMic}
            disabled={!supported || busy}
            className={`shrink-0 rounded-lg p-2.5 transition ${
              listening ? 'bg-alert-600 text-white' : 'bg-leaf-600 text-white hover:bg-leaf-700'
            } disabled:opacity-40`}
            aria-label={listening ? 'Stop listening' : 'Start voice input'}
          >
            {supported ? (listening ? <MicOff size={17} /> : <Mic size={17} />) : <MicOff size={17} />}
          </button>
          <button
            onClick={() => submit(text)}
            disabled={!text.trim() || busy}
            className="shrink-0 rounded-lg bg-soil-900 p-2.5 text-white transition hover:bg-soil-800 disabled:opacity-30"
            aria-label="Send"
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
