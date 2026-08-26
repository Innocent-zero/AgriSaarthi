'use client';

import { useEffect, useState } from 'react';
import {
  Landmark, Loader2, ExternalLink, ChevronDown, Clock, CalendarDays,
  CheckCircle2, BookOpen, Settings2,
} from 'lucide-react';
import { api, SchemeRecommendation, RagAnswer, friendlyError } from '@/lib/api';
import { makeT, Locale, renderLocalised } from '@/lib/i18n';
import { cacheAdvisory, readAdvisory } from '@/lib/idb';

interface Props {
  lat: number;
  lon: number;
  crop: string;
  areaHa: number;
  state?: string;
  language: Locale;
}

const URGENCY_STYLE: Record<string, { chip: string; icon: typeof Clock }> = {
  act_now:     { chip: 'bg-alert-400/15 text-alert-600',     icon: Clock },
  this_season: { chip: 'bg-harvest-400/20 text-harvest-600', icon: CalendarDays },
  anytime:     { chip: 'bg-leaf-50 text-leaf-700',           icon: CheckCircle2 },
};

type Irrigation = 'diesel' | 'electric' | 'canal' | 'rainfed' | 'solar';

export default function SchemeAdvisorWidget({ lat, lon, crop, areaHa, state, language }: Props) {
  const t = makeT(language);

  const [recs, setRecs] = useState<SchemeRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, RagAnswer>>({});
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  // Self-reported context. Undefined means unknown, which is not the same as
  // "no" — an unknown answer must not suppress a scheme the farmer may need.
  const [hasKcc, setHasKcc] = useState<boolean | undefined>();
  const [hasInsurance, setHasInsurance] = useState<boolean | undefined>();
  const [hasSoilCard, setHasSoilCard] = useState<boolean | undefined>();
  const [irrigation, setIrrigation] = useState<Irrigation | undefined>();

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const d = await api.schemeRecommend({
        lat, lon, crop, areaHa, state, language,
        hasKcc, hasInsurance, hasSoilCard,
        irrigationSource: irrigation,
      });
      setRecs(d.recommendations);
      await cacheAdvisory(`schemes:${lat.toFixed(2)}:${crop}`, d.recommendations);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readAdvisory<SchemeRecommendation[]>(`schemes:${lat.toFixed(2)}:${crop}`);
      if (cached && alive) setRecs(cached);
      await load();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, crop, language]);

  async function toggle(schemeId: string) {
    if (expanded === schemeId) { setExpanded(null); return; }
    setExpanded(schemeId);
    if (details[schemeId]) return;

    setDetailBusy(schemeId);
    try {
      const d = await api.schemeDetail({ schemeId, language });
      setDetails((prev) => ({ ...prev, [schemeId]: d }));
    } catch { /* the card still shows the summary */ }
    finally { setDetailBusy(null); }
  }

  if (busy && !recs) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-leaf-50 p-6 text-sm text-leaf-700">
        <Loader2 size={16} className="animate-spin" /> {t('common.loading')}
      </div>
    );
  }
  if (error && !recs) {
    return <p className="rounded-2xl bg-alert-400/10 p-4 text-sm text-alert-600">{error}</p>;
  }
  if (!recs) return null;

  const top = recs.filter((r) => r.score >= 60);
  const rest = recs.filter((r) => r.score < 60);

  return (
    <div className="animate-slideUp space-y-3">
      <div className="overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
        <div className="flex items-center gap-2 bg-leaf-700 px-4 py-3 text-white">
          <Landmark size={18} />
          <h3 className="text-sm font-semibold">{t('scheme.title')}</h3>
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="ml-auto rounded-lg bg-white/20 p-1.5"
            aria-label={t('scheme.refine')}
          >
            <Settings2 size={14} />
          </button>
        </div>

        {/* Refinement: answering these sharpens the ranking. */}
        {showProfile && (
          <div className="space-y-3 border-b border-leaf-50 bg-soil-50 p-4">
            <p className="text-[11px] text-soil-700">{t('scheme.refineHint')}</p>

            {([
              { label: t('scheme.q.kcc'), value: hasKcc, set: setHasKcc },
              { label: t('scheme.q.insurance'), value: hasInsurance, set: setHasInsurance },
              { label: t('scheme.q.soilCard'), value: hasSoilCard, set: setHasSoilCard },
            ] as const).map((q) => (
              <div key={q.label} className="flex items-center justify-between gap-2">
                <span className="text-xs text-soil-900">{q.label}</span>
                <div className="flex gap-1">
                  {([true, false] as const).map((v) => (
                    <button
                      key={String(v)}
                      onClick={() => q.set(q.value === v ? undefined : v)}
                      className={`rounded-lg px-3 py-1 text-[11px] font-semibold transition ${
                        q.value === v ? 'bg-leaf-600 text-white' : 'bg-white text-soil-700 border border-leaf-100'
                      }`}
                    >
                      {v ? t('common.yes') : t('common.no')}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div>
              <p className="mb-1.5 text-xs text-soil-900">{t('scheme.q.irrigation')}</p>
              <div className="flex flex-wrap gap-1.5">
                {(['diesel', 'electric', 'canal', 'rainfed', 'solar'] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => setIrrigation(irrigation === src ? undefined : src)}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                      irrigation === src ? 'bg-leaf-600 text-white' : 'bg-white text-soil-700 border border-leaf-100'
                    }`}
                  >
                    {t(`scheme.irrigation.${src}`)}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => { setShowProfile(false); void load(); }}
              className="w-full rounded-xl bg-leaf-600 py-2.5 text-xs font-bold text-white"
            >
              {t('scheme.update')}
            </button>
          </div>
        )}

        <p className="px-4 pt-3 text-xs font-semibold text-soil-900">{t('scheme.forYou')}</p>

        <div className="space-y-2 p-3">
          {top.map((r) => {
            const u = URGENCY_STYLE[r.urgency] ?? URGENCY_STYLE.anytime;
            const UIcon = u.icon;
            const open = expanded === r.schemeId;
            const detail = details[r.schemeId];

            return (
              <div key={r.schemeId} className="overflow-hidden rounded-xl border border-leaf-100">
                <button
                  onClick={() => toggle(r.schemeId)}
                  className="flex w-full items-start gap-3 p-3 text-left transition hover:bg-leaf-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-soil-900">{t(r.titleCode)}</span>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${u.chip}`}>
                        <UIcon size={9} />{t(`scheme.urgency.${r.urgency}`)}
                      </span>
                    </div>

                    <p className="mt-1 text-[11px] leading-relaxed text-soil-700">{t(r.benefitCode)}</p>

                    {r.estValueCode && (
                      <p className="mt-1.5 inline-block rounded-md bg-harvest-400/15 px-2 py-0.5 text-[11px] font-bold text-harvest-600">
                        {t(r.estValueCode, r.estValueParams)}
                      </p>
                    )}

                    <div className="mt-2 space-y-1">
                      {r.reasonCodes.map((rc, i) => (
                        <p key={`${rc.code}-${i}`} className="flex gap-1.5 text-[10px] text-soil-700/80">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-leaf-500" />
                          {renderLocalised(language, rc)}
                        </p>
                      ))}
                    </div>
                  </div>

                  <ChevronDown
                    size={16}
                    className={`mt-1 shrink-0 text-soil-700 transition ${open ? 'rotate-180' : ''}`}
                  />
                </button>

                {open && (
                  <div className="border-t border-leaf-50 bg-soil-50 p-3">
                    <p className="mb-2 rounded-lg bg-leaf-600 px-3 py-2 text-[11px] font-semibold text-white">
                      {t(r.actionCode)}
                    </p>

                    {detailBusy === r.schemeId && (
                      <p className="flex items-center gap-1.5 text-[11px] text-soil-700">
                        <Loader2 size={11} className="animate-spin" />{t('common.loading')}
                      </p>
                    )}

                    {detail && (
                      <>
                        <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-leaf-50 px-2 py-0.5 text-[9px] font-semibold text-leaf-700">
                          <BookOpen size={9} />{t('rag.grounded')}
                        </p>
                        <p className="text-[11px] leading-relaxed text-soil-900">{detail.answer}</p>
                        {detail.citations.length > 0 && (
                          <p className="mt-2 text-[9px] text-soil-700/60">
                            {t('rag.sources')}: {detail.citations.map((c) => c.heading).join(' · ')}
                          </p>
                        )}
                      </>
                    )}

                    <a
                      href={r.portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-leaf-300 bg-white py-2 text-[11px] font-semibold text-leaf-700"
                    >
                      {t('scheme.openPortal')}<ExternalLink size={10} />
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {rest.length > 0 && (
          <details className="border-t border-leaf-50 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-soil-700">
              {t('scheme.lessRelevant', { n: rest.length })}
            </summary>
            <div className="mt-2 space-y-1.5">
              {rest.map((r) => (
                <div key={r.schemeId} className="rounded-lg bg-soil-50 p-2.5">
                  <p className="text-xs font-semibold text-soil-900">{t(r.titleCode)}</p>
                  <p className="mt-0.5 text-[10px] text-soil-700/80">
                    {renderLocalised(language, r.reasonCodes[r.reasonCodes.length - 1])}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}

        <p className="border-t border-leaf-50 bg-soil-50 px-4 py-2 text-[10px] leading-relaxed text-soil-700">
          {t('scheme.disclaimer')}
        </p>
      </div>
    </div>
  );
}