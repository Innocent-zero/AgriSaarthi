'use client';

import { useEffect, useRef, useState } from 'react';
import { Leaf, X, Minus, Maximize2, Minimize2 } from 'lucide-react';
import HybridCopilotChat from './HybridCopilotChat';
import VoiceSearchBar from './VoiceSearchBar';
import { makeT, Locale } from '@/lib/i18n';

type Screen = string;

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

interface Props {
  farm: Farm;
  currentView: Screen;
  onLanguageChange: (l: Locale) => void;
}

/**
 * Quick prompts keyed to the page the farmer is on, so they never have to
 * compose a question from nothing. These are i18n keys, sent as the resolved
 * string in the farmer's language.
 */
const CONTEXT_PROMPTS: Record<string, string[]> = {
  home:    ['chat.q.today', 'chat.q.spray', 'chat.q.rate'],
  weather: ['chat.q.spray', 'chat.q.rainTomorrow', 'chat.q.doNow'],
  disease: ['chat.q.whatIsThis', 'chat.q.howSerious', 'chat.q.whatDo'],
  mandi:   ['chat.q.bestMandi', 'chat.q.worthDistance', 'chat.q.rate'],
  npk:     ['chat.q.whyDose', 'chat.q.whenApply'],
  risk:    ['chat.q.whyRisk', 'chat.q.firstAction'],
  pmfby:   ['chat.q.claimHow', 'chat.q.claimTime'],
  schemes: ['chat.q.whichScheme', 'chat.q.eligible'],
};

export default function FloatingChat({ farm, currentView, onLanguageChange }: Props) {
  const t = makeT(farm.language);
  const [open, setOpen] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [pending, setPending] = useState<{ text: string; nonce: number } | null>(null);
  const [lastReply, setLastReply] = useState('');
  const [unseen, setUnseen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape — expected behaviour for any floating panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // A reply arriving while collapsed gets a dot rather than forcing the panel open.
  useEffect(() => {
    if (lastReply && !open) setUnseen(true);
  }, [lastReply, open]);

  const send = (text: string) => {
    setPending({ text, nonce: Date.now() });
    if (!open) setOpen(true);
  };

  const prompts = CONTEXT_PROMPTS[currentView] ?? CONTEXT_PROMPTS.home;

  // ── Collapsed ──
  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setUnseen(false); }}
        aria-label={t('chat.open')}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-leaf-600 py-3 pl-3.5 pr-4 text-white shadow-lg transition active:scale-95"
      >
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
          <Leaf size={16} />
          {unseen && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-leaf-600 bg-harvest-400" />
          )}
        </span>
        <span className="text-sm font-semibold">{t('chat.ask')}</span>
      </button>
    );
  }

  // ── Expanded ──
  return (
    <>
      {/* Scrim on mobile only; on desktop the page stays usable behind the panel. */}
      <div
        className="fixed inset-0 z-40 bg-black/30 sm:hidden"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('chat.title')}
        className={`fixed z-50 flex flex-col overflow-hidden bg-soil-50 shadow-2xl transition-all
          inset-x-0 bottom-0 rounded-t-2xl
          sm:inset-x-auto sm:bottom-5 sm:right-5 sm:rounded-2xl
          ${maximised
            ? 'top-0 sm:top-5 sm:w-[440px]'
            : 'top-16 sm:top-auto sm:h-[560px] sm:w-[380px]'}`}
      >
        {/* header */}
        <div className="flex items-center gap-2 bg-leaf-700 px-4 py-3 text-white">
          <Leaf size={17} />
          <p className="flex-1 text-sm font-semibold">{t('chat.title')}</p>

          <button
            onClick={() => setMaximised(!maximised)}
            className="hidden rounded-lg p-1.5 hover:bg-white/15 sm:block"
            aria-label={maximised ? t('chat.restore') : t('chat.maximise')}
          >
            {maximised ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 hover:bg-white/15"
            aria-label={t('chat.minimise')}
          >
            <Minus size={15} />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 hover:bg-white/15"
            aria-label={t('chat.close')}
          >
            <X size={15} />
          </button>
        </div>

        {/* conversation */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <HybridCopilotChat
            farm={farm}
            pendingMessage={pending}
            onReply={setLastReply}
          />
        </div>

        {/* contextual quick prompts */}
        <div className="flex gap-1.5 overflow-x-auto border-t border-leaf-100 bg-white px-3 py-2">
          {prompts.map((k) => (
            <button
              key={k}
              onClick={() => send(t(k))}
              className="shrink-0 rounded-full border border-leaf-100 px-3 py-1.5 text-[11px] font-medium text-leaf-700 transition active:bg-leaf-50"
            >
              {t(k)}
            </button>
          ))}
        </div>

        {/* input */}
        <div className="border-t border-leaf-100 bg-white px-3 py-2.5">
          <VoiceSearchBar
            language={farm.language}
            onLanguageChange={onLanguageChange}
            onSubmit={send}
            lastReply={lastReply}
            compact
          />
        </div>
      </div>
    </>
  );
}