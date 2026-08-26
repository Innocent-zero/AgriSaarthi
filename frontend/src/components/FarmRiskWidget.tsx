'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShieldAlert, Loader2, Satellite, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { api, friendlyError, RiskAssessment } from '@/lib/api';
import { makeT, Locale, renderLocalised } from '@/lib/i18n';
import { cacheAdvisory, readAdvisory } from '@/lib/idb';

interface Props {
  lat: number;
  lon: number;
  crop: string;
  state?: string;
  boundary?: Array<{ lat: number; lon: number }>;
  language: Locale;
}

const BAND_STYLE: Record<string, { bar: string; chip: string; text: string }> = {
  low:      { bar: 'bg-leaf-500',    chip: 'bg-leaf-50 text-leaf-700',           text: 'text-leaf-700' },
  moderate: { bar: 'bg-harvest-400', chip: 'bg-harvest-400/15 text-harvest-600', text: 'text-harvest-600' },
  high:     { bar: 'bg-harvest-600', chip: 'bg-harvest-400/25 text-harvest-600', text: 'text-harvest-600' },
  severe:   { bar: 'bg-alert-600',   chip: 'bg-alert-400/15 text-alert-600',     text: 'text-alert-600' },
};

/** Inline NDVI sparkline. Plain SVG — no chart library, no extra bundle weight. */
function Sparkline({ points, baseline }: {
  points: Array<{ date: string; mean: number }>;
  baseline: number | null;
}) {
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const w = 300;
    const h = 64;
    const values = points.map((p) => p.mean);
    const lo = Math.min(...values, baseline ?? 1) - 0.05;
    const hi = Math.max(...values, baseline ?? 0) + 0.05;
    const span = Math.max(hi - lo, 0.1);

    const x = (i: number) => (i / (points.length - 1)) * w;
    const y = (v: number) => h - ((v - lo) / span) * h;

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.mean).toFixed(1)}`).join(' ');
    const area = `${line} L${w},${h} L0,${h} Z`;
    const baseY = baseline !== null ? y(baseline) : null;
    return { line, area, baseY, w, h, lastX: x(points.length - 1), lastY: y(values[values.length - 1]) };
  }, [points, baseline]);

  if (!path) return null;

  return (
    <svg viewBox={`0 0 ${path.w} ${path.h}`} className="h-16 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ndviFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2E9E5B" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2E9E5B" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {path.baseY !== null && (
        <line x1="0" y1={path.baseY} x2={path.w} y2={path.baseY}
              stroke="#B87A08" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
      )}
      <path d={path.area} fill="url(#ndviFill)" />
      <path d={path.line} fill="none" stroke="#1B7A43" strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={path.lastX} cy={path.lastY} r="3.5" fill="#1B7A43" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

export default function FarmRiskWidget({ lat, lon, crop, state, boundary, language }: Props) {
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
        const fresh = await api.risk({ lat, lon, crop, state, boundary });
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
  }, [lat, lon, crop, state, boundary]);

  if (error) return <p className="rounded-2xl bg-alert-400/10 p-4 text-sm text-alert-600">{error}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-leaf-50 p-6 text-sm text-leaf-700">
        <Loader2 size={16} className="animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  const overallStyle = BAND_STYLE[data.overallBand] ?? BAND_STYLE.moderate;
  const nd = data.ndvi;
  const trend = nd.trendPerInterval;
  const TrendIcon = trend === null ? Minus : trend < -0.005 ? TrendingDown : trend > 0.005 ? TrendingUp : Minus;

  return (
    <div className="animate-slideUp space-y-3">
      {/* ── composite gauge ── */}
      <div className="overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
        <div className="flex items-center gap-2 bg-soil-900 px-4 py-3 text-white">
          <ShieldAlert size={18} />
          <h3 className="text-sm font-semibold">{t('risk.title')}</h3>
          <span className="ml-auto text-[11px] opacity-70">{t('risk.window')}</span>
        </div>

        <div className="p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-soil-700/70">{t('risk.overall')}</p>
              <p className="text-3xl font-bold text-soil-900">
                {data.overall}<span className="text-base text-soil-700">/100</span>
              </p>
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
      </div>

      {/* ── satellite panel ── */}
      <div className="overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
        <div className="flex items-center gap-2 bg-leaf-600 px-4 py-2.5 text-white">
          <Satellite size={16} />
          <h4 className="text-xs font-semibold">{t('risk.ndvi.title')}</h4>
        </div>
        {nd.available && nd.current ? (
          <>
            <div className="grid grid-cols-3 gap-px bg-leaf-50">
              <div className="bg-white px-2 py-3 text-center">
                <p className="text-[10px] text-soil-700/70">{t('risk.ndvi.current')}</p>
                <p className="text-lg font-bold text-soil-900">{nd.current.mean.toFixed(2)}</p>
              </div>
              <div className="bg-white px-2 py-3 text-center">
                <p className="text-[10px] text-soil-700/70">{t('risk.ndvi.baseline')}</p>
                <p className="text-lg font-bold text-soil-700">
                  {nd.baselineMean !== null ? nd.baselineMean.toFixed(2) : '—'}
                </p>
              </div>
              <div className="bg-white px-2 py-3 text-center">
                <p className="text-[10px] text-soil-700/70">{t('risk.ndvi.anomaly')}</p>
                <p className={`flex items-center justify-center gap-1 text-lg font-bold ${
                  nd.anomaly === null ? 'text-soil-700'
                    : nd.anomaly < -0.05 ? 'text-alert-600'
                    : nd.anomaly > 0.05 ? 'text-leaf-700' : 'text-soil-900'}`}>
                  <TrendIcon size={15} />
                  {nd.anomaly !== null ? `${nd.anomaly > 0 ? '+' : ''}${nd.anomaly.toFixed(2)}` : '—'}
                </p>
              </div>
            </div>

            {nd.sparkline.length >= 2 && (
              <div className="px-3 pb-2 pt-3">
                <Sparkline points={nd.sparkline} baseline={nd.baselineMean} />
                <div className="mt-1 flex justify-between text-[9px] text-soil-700/60">
                  <span>{nd.sparkline[0].date}</span>
                  <span>{t('risk.ndvi.months')}</span>
                  <span>{nd.sparkline[nd.sparkline.length - 1].date}</span>
                </div>
              </div>
            )}
            {nd.current && (() => {
              const days = Math.round((Date.now() - new Date(nd.current.from).getTime()) / 86400000);
              return days > 20 ? (
                <p className="bg-harvest-400/12 px-3 py-1.5 text-[10px] text-harvest-600">
                  {t('risk.ndvi.stale', { days })}
                </p>
              ) : null;
            })()}
            {nd.current.validPixelPct < 70 && (
              <p className="bg-soil-50 px-3 py-1.5 text-[10px] text-soil-700">{t('risk.ndvi.cloudy')}</p>
            )}
          </>
        ) : (
          <p className="p-4 text-xs leading-relaxed text-soil-700">{t('risk.ndvi.unavailable')}</p>
        )}
      </div>

      {/* ── factors ── */}
      <div className="overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
        <div className="space-y-3 p-4">
          {data.factors.map((f) => {
            const s = BAND_STYLE[f.band] ?? BAND_STYLE.low;
            return (
              <div key={f.key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-soil-900">{t(f.key)}</span>
                  <span className={`text-xs font-bold ${s.text}`}>{f.score}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-soil-50">
                  <div className={`h-full rounded-full transition-all duration-500 ${s.bar}`}
                       style={{ width: `${Math.max(f.score, 2)}%` }} />
                </div>
                {f.evidence && f.score >= 25 && (
                  <p className="mt-1 text-[10px] text-soil-700/60">{t('risk.evidence')}: {f.evidence}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-1.5 border-t border-leaf-50 p-4">
          <p className="mb-1 text-xs font-semibold text-leaf-700">{t('risk.actions')}</p>
          {data.actions.map((a, i) => (
            <div key={`${a.code}-${i}`} className="flex gap-2 rounded-lg bg-harvest-400/12 p-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-harvest-500" />
              <p className="text-xs leading-relaxed text-soil-900">{renderLocalised(language, a)}</p>
            </div>
          ))}
        </div>

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
    </div>
  );
}