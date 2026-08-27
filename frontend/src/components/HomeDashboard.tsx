'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Leaf, Camera, TrendingUp, CloudSun, Sprout, ShieldAlert, FileText, Landmark,
  Settings2, Languages, Wifi, WifiOff, ChevronRight, CheckCircle2, AlertTriangle, Menu,
} from 'lucide-react';
import { api, WeatherSnapshot, RiskAssessment, describeError } from '@/lib/api';
import { makeT, Locale, renderLocalised } from '@/lib/i18n';
import { cacheAdvisory, readAdvisory } from '@/lib/idb';
import Disclosure from './ui/Disclosure';

export type ViewKey =
  | 'weather' | 'npk' | 'mandi' | 'disease' | 'pmfby' | 'risk' | 'schemes';

interface Props {
  name: string;
  crop: string;
  areaHa: number;
  lat: number;
  lon: number;
  state?: string;
  district?: string;
  village?: string;
  language: Locale;
  online: boolean;
  onLanguageChange: (l: Locale) => void;
  onOpen: (v: ViewKey) => void;
  onEditFarm: () => void;
  onOpenMenu: () => void;
}

interface Attention {
  severity: 'urgent' | 'watch' | 'ok';
  text: string;
  view?: ViewKey;
  ctaKey?: string;
}

const SECONDARY: Array<{ key: ViewKey; icon: typeof CloudSun }> = [
  { key: 'weather', icon: CloudSun },
  { key: 'npk',     icon: Sprout },
  { key: 'risk',    icon: ShieldAlert },
  { key: 'pmfby',   icon: FileText },
  { key: 'schemes', icon: Landmark },
];

export default function HomeDashboard({
  name, crop, areaHa, lat, lon, state, district, village,
  language, online, onLanguageChange, onOpen, onEditFarm, onOpenMenu,
}: Props) {
  const t = makeT(language);

  const [wx, setWx] = useState<WeatherSnapshot | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);

    // Show cached values immediately so the farmer never faces a blank screen
    // on a slow connection; live values replace them when they arrive.
    const wxKey = `wx:${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const riskKey = `risk:${lat.toFixed(3)}:${lon.toFixed(3)}:${crop}`;
    const [cw, cr] = await Promise.all([
      readAdvisory<WeatherSnapshot>(wxKey),
      readAdvisory<RiskAssessment>(riskKey),
    ]);
    if (cw) { setWx(cw); setStale(true); }
    if (cr) { setRisk(cr); setStale(true); }

    const [w, r] = await Promise.allSettled([
      api.weather(lat, lon),
      api.risk({ lat, lon, crop, state }),
    ]);

    if (w.status === 'fulfilled') {
      setWx(w.value);
      void cacheAdvisory(wxKey, w.value);
    }
    if (r.status === 'fulfilled') {
      setRisk(r.value);
      void cacheAdvisory(riskKey, r.value);
    }

    if (w.status === 'fulfilled' || r.status === 'fulfilled') setStale(false);
    if (w.status === 'rejected' && r.status === 'rejected' && !cw && !cr) setFailed(true);

    setLoading(false);
  }, [lat, lon, crop, state]);

  useEffect(() => { void load(); }, [load]);

  /**
   * The single most important thing on the screen. Risk band decides urgency;
   * the highest-scoring risk factor supplies the action. Falls back to the
   * weather advisory when risk is unavailable, and says so plainly when
   * neither is.
   */
  const attention: Attention = (() => {
    if (risk) {
      const top = risk.factors[0];
      const action = risk.actions[0];
      if (risk.overallBand === 'severe' || risk.overallBand === 'high') {
        return {
          severity: 'urgent',
          text: action ? renderLocalised(language, action) : t(top.key),
          view: 'risk',
          ctaKey: 'home.seeRisk',
        };
      }
      if (risk.overallBand === 'moderate' && top && top.score >= 40) {
        return {
          severity: 'watch',
          text: action ? renderLocalised(language, action) : t(top.key),
          view: 'risk',
          ctaKey: 'home.seeRisk',
        };
      }
    }
    if (wx && wx.advisories.length) {
      const a = wx.advisories[0];
      const urgent = a.code === 'wx.delayUrea' || a.code === 'wx.windNoSpray';
      if (a.code !== 'wx.stable') {
        return {
          severity: urgent ? 'urgent' : 'watch',
          text: renderLocalised(language, a),
          view: 'weather',
          ctaKey: 'home.seeWeather',
        };
      }
    }
    return { severity: 'ok', text: t('home.allClear.body') };
  })();

  const place = [village, district].filter(Boolean).join(', ') || state;

  const TONE = {
    urgent: { box: 'bg-alert-600 text-white', chip: 'bg-white/20', icon: AlertTriangle },
    watch:  { box: 'bg-harvest-500 text-white', chip: 'bg-white/20', icon: AlertTriangle },
    ok:     { box: 'bg-leaf-600 text-white', chip: 'bg-white/20', icon: CheckCircle2 },
  }[attention.severity];
  const AttnIcon = TONE.icon;

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-soil-50 pb-28">
      {/* ── A. Farm context ── */}
      <header className="px-5 pb-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={onOpenMenu}
              aria-label={t('nav.menu')}
              className="group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-leaf-600 text-white transition active:scale-95"
            >
              <Leaf size={22} className="group-active:opacity-0" />
              <Menu size={20} className="absolute opacity-0 group-active:opacity-100" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight text-soil-900">
                {t('home.greeting', { name })}
              </h1>
              <p className="truncate text-xs text-soil-700">
                {crop} · {areaHa.toFixed(2)} {t('common.ha')}{place ? ` · ${place}` : ''}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${
              online ? 'bg-leaf-50 text-leaf-700' : 'bg-harvest-400/15 text-harvest-600'}`}>
              {online ? <Wifi size={11} /> : <WifiOff size={11} />}
              {online ? t('common.online') : t('common.offline')}
            </span>
            <button
              onClick={() => onLanguageChange(language === 'hi' ? 'en' : 'hi')}
              className="rounded-lg bg-white p-2 text-leaf-700 shadow-card"
              aria-label={t('home.language')}
            >
              <Languages size={16} />
            </button>
            <button
              onClick={onEditFarm}
              className="rounded-lg bg-white p-2 text-soil-700 shadow-card"
              aria-label={t('hub.edit')}
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>

        <p className="mt-3 text-sm text-soil-700">
          {t('home.subtitle', { crop: crop.toLowerCase() })}
        </p>
      </header>

      {/* ── C. What needs attention (dominates the viewport) ── */}
      <section className="px-5">
        {loading && !wx && !risk ? (
          <div className="rounded-2xl bg-white p-5 shadow-card">
            <div className="h-3 w-2/5 animate-pulse rounded-full bg-leaf-50" />
            <div className="mt-3 h-5 w-4/5 animate-pulse rounded-full bg-leaf-50" />
            <div className="mt-2 h-5 w-3/5 animate-pulse rounded-full bg-leaf-50" />
            <p className="mt-4 text-xs text-soil-700/70">{t('home.checking')}</p>
          </div>
        ) : failed ? (
          <div className="rounded-2xl border border-harvest-400/40 bg-harvest-400/8 p-5">
            <p className="text-sm text-soil-900">{t('home.noData')}</p>
            <button
              onClick={() => void load()}
              className="mt-3 rounded-xl bg-soil-900 px-4 py-2.5 text-sm font-semibold text-white"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <button
            onClick={() => attention.view && onOpen(attention.view)}
            disabled={!attention.view}
            className={`w-full rounded-2xl p-5 text-left shadow-card transition active:scale-[0.99] ${TONE.box}`}
          >
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${TONE.chip}`}>
              <AttnIcon size={11} />
              {attention.severity === 'ok' ? t('home.allClear.title') : t('home.attention')}
            </span>

            <p className="mt-3 text-xl font-bold leading-snug">{attention.text}</p>

            {attention.ctaKey && (
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold opacity-90">
                {t(attention.ctaKey)}<ChevronRight size={15} />
              </span>
            )}
          </button>
        )}
      </section>

      {/* ── B. Today on your farm ── */}
      {(wx || risk) && (
        <section className="mt-3 px-5">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-leaf-50 shadow-card">
            <button
              onClick={() => onOpen('weather')}
              className="bg-white px-2 py-3 text-center transition active:bg-leaf-50"
            >
              <p className="text-[10px] text-soil-700/70">{t('home.now')}</p>
              <p className="text-lg font-bold text-soil-900">
                {wx ? `${wx.current.temperatureC.toFixed(0)}°` : '—'}
              </p>
            </button>

            <button
              onClick={() => onOpen('weather')}
              className="bg-white px-2 py-3 text-center transition active:bg-leaf-50"
            >
              <p className="text-[10px] text-soil-700/70">{t('home.rain48')}</p>
              <p className="text-lg font-bold text-soil-900">
                {wx ? `${wx.daily.slice(0, 2).reduce((s, d) => s + d.rainMm, 0).toFixed(0)}mm` : '—'}
              </p>
            </button>

            <button
              onClick={() => onOpen('risk')}
              className="bg-white px-2 py-3 text-center transition active:bg-leaf-50"
            >
              <p className="text-[10px] text-soil-700/70">{t('home.cropStatus')}</p>
              <p className={`text-sm font-bold ${
                risk?.overallBand === 'severe' || risk?.overallBand === 'high'
                  ? 'text-alert-600'
                  : risk?.overallBand === 'moderate' ? 'text-harvest-600' : 'text-leaf-700'}`}>
                {risk ? t(`risk.band.${risk.overallBand}`) : '—'}
              </p>
            </button>
          </div>

          {stale && (
            <p className="mt-1.5 text-center text-[10px] text-soil-700/70">{t('common.stale')}</p>
          )}
        </section>
      )}

      {/* ── D. Primary actions ── */}
      <section className="mt-5 space-y-3 px-5">
        <button
          onClick={() => onOpen('disease')}
          className="flex w-full items-center gap-4 rounded-2xl bg-white p-5 text-left shadow-card transition active:scale-[0.99]"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-leaf-600 text-white">
            <Camera size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-soil-900">{t('home.primary.crop')}</span>
            <span className="block text-xs text-soil-700">{t('home.primary.crop.sub')}</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-soil-700/50" />
        </button>

        <button
          onClick={() => onOpen('mandi')}
          className="flex w-full items-center gap-4 rounded-2xl bg-white p-5 text-left shadow-card transition active:scale-[0.99]"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-harvest-500 text-white">
            <TrendingUp size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-soil-900">{t('home.primary.sell')}</span>
            <span className="block text-xs text-soil-700">{t('home.primary.sell.sub')}</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-soil-700/50" />
        </button>
      </section>

      {/* ── E. Secondary tools ── */}
      <section className="mt-4 px-5">
        <Disclosure label={t('home.moreTools')} hint={String(SECONDARY.length)}>
          <div className="grid grid-cols-2 gap-2">
            {SECONDARY.map(({ key, icon: Icon }) => (
              <button
                key={key}
                onClick={() => onOpen(key)}
                className="flex items-center gap-2.5 rounded-xl border border-leaf-50 p-3 text-left transition active:bg-leaf-50"
              >
                <Icon size={17} className="shrink-0 text-leaf-600" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-soil-900">{t(`tile.${key}`)}</span>
                </span>
              </button>
            ))}
          </div>
        </Disclosure>
      </section>
    </div>
  );
}