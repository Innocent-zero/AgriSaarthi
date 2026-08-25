'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, Loader2, TrendingUp } from 'lucide-react';
import { api, friendlyError, RiskAssessment } from '@/lib/api';
import { makeT, Locale, renderLocalised } from '@/lib/i18n';
import { cacheAdvisory, readAdvisory } from '@/lib/idb';

interface Props {
  lat: number;
  lon: number;
  crop: string;
  state?: string;
  language: Locale;
}

const BAND_STYLE: Record<string, { bar: string; chip: string }> = {
  low:      { bar: 'bg-leaf-500',     chip: 'bg-leaf-50 text-leaf-700' },
  moderate: { bar: 'bg-harvest-400',  chip: 'bg-harvest-400/15 text-harvest-600' },
  high:     { bar: 'bg-harvest-600',  chip: 'bg-harvest-400/25 text-harvest-600' },
  severe:   { bar: 'bg-alert-600',    chip: 'bg-alert-400/15 text-alert-600' },
};

export default function FarmRiskWidget({ lat, lon, crop, state, language }: Props) {
  const t = makeT(language);
  const [data, setData] = useState<RiskAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const key = `risk:${lat.toFixed(3)}:${lon.toFixed(3)}:${crop}`;
      const cached = await readAdvisory<RiskAssessment>(key);
      if (cached && alive) { setData(cached); setStale(true); }
      try {
        const fresh = await api.risk(lat, lon, crop, state);
        if (!alive) return;
        setData(fresh);
        setStale(false);
        setError(null);
        await cacheAdvisory(key, fresh);
      } catch (e) {
        if (alive && !cached) setError(friendlyError(e));
      }
    })();
    return () => { alive = false; };
  }, [lat, lon, crop, state]);

  if (error) return <p className="rounded-2xl bg-alert-400/10 p-4 text-sm text-alert-600">{error}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-leaf-50 p-6 text-sm text-leaf-700">
        <Loader2 size={16} className="animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  const overallStyle = BAND_STYLE[data.overallBand] ?? BAND_STYLE.moderate;

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center gap-2 bg-soil-900 px-4 py-3 text-white">
        <ShieldAlert size={18} />
        <h3 className="text-sm font-semibold">{t('risk.title')}</h3>
        <span className="ml-auto text-[11px] opacity-70">{t('risk.window')}</span>
      </div>

      {/* overall gauge */}
      <div className="border-b border-leaf-50 p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-soil-700/70">{t('risk.overall')}</p>
            <p className="text-3xl font-bold text-soil-900">{data.overall}<span className="text-base text-soil-700">/100</span></p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${overallStyle.chip}`}>
            {t(`risk.band.${data.overallBand}`)}
          </span>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-leaf-50">
          <div className={`h-full rounded-full transition-all duration-700 ${overallStyle.bar}`}
               style={{ width: `${data.overall}%` }} />
        </div>
      </div>

      {/* factors */}
      <div className="space-y-3 p-4">
        {data.factors.map((f) => {
          const s = BAND_STYLE[f.band] ?? BAND_STYLE.low;
          return (
            <div key={f.key}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-soil-900">{t(f.key)}</span>
                <span className="text-xs font-bold text-soil-700">{f.score}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-soil-50">
                <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${Math.max(f.score, 2)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* actions */}
      <div className="space-y-1.5 border-t border-leaf-50 p-4">
        <p className="mb-1 text-xs font-semibold text-leaf-700">{t('risk.actions')}</p>
        {data.actions.map((a, i) => (
          <div key={`${a.code}-${i}`} className="flex gap-2 rounded-lg bg-harvest-400/12 p-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-harvest-500" />
            <p className="text-xs leading-relaxed text-soil-900">{renderLocalised(language, a)}</p>
          </div>
        ))}
      </div>

      {/* context strip */}
      <div className="grid grid-cols-4 gap-px bg-leaf-50">
        {[
          { l: t('wx.rain'), v: `${data.context.rain7Mm} mm` },
          { l: '↑°C', v: `${data.context.maxTempC}°` },
          { l: t('wx.wind'), v: `${data.context.maxWindKmh}` },
          { l: t('wx.humidity'), v: `${data.context.humidityPct}%` },
        ].map((c) => (
          <div key={c.l} className="bg-white px-2 py-2 text-center">
            <p className="text-[9px] text-soil-700/70">{c.l}</p>
            <p className="text-xs font-semibold text-soil-900">{c.v}</p>
          </div>
        ))}
      </div>

      {stale && <p className="bg-soil-50 px-3 py-1.5 text-[10px] text-soil-700">{t('common.stale')}</p>}
    </div>
  );
}