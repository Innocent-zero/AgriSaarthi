'use client';

import { useEffect, useState } from 'react';
import { CloudSun, Droplets, Wind, Loader2, WifiOff } from 'lucide-react';
import { api, WeatherSnapshot } from '@/lib/api';
import { makeT, Locale, renderLocalised } from '@/lib/i18n';
import { cacheAdvisory, readAdvisory } from '@/lib/idb';

interface Props {
  lat: number;
  lon: number;
  language: Locale;
}

export default function WeatherPanel({ lat, lon, language }: Props) {
  const t = makeT(language);
  const [wx, setWx] = useState<WeatherSnapshot | null>(null);
  const [stale, setStale] = useState(false);

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
      <div className="flex items-center gap-2 rounded-2xl bg-leaf-50 p-6 text-sm text-leaf-700">
        <Loader2 size={16} className="animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center justify-between bg-gradient-to-r from-leaf-600 to-leaf-500 px-5 py-5 text-white">
        <div>
          <p className="text-4xl font-bold">{wx.current.temperatureC.toFixed(0)}°C</p>
          <p className="mt-0.5 text-xs opacity-85">{t('wx.now')}</p>
        </div>
        <CloudSun size={44} className="opacity-85" />
      </div>

      <div className="grid grid-cols-3 gap-px bg-leaf-50">
        {[
          { i: <Droplets size={15} />, l: t('wx.humidity'), v: `${wx.current.humidityPct.toFixed(0)}%` },
          { i: <Wind size={15} />, l: t('wx.wind'), v: `${wx.current.windSpeedKmh.toFixed(0)} km/h` },
          { i: <CloudSun size={15} />, l: t('wx.rain'), v: `${wx.current.precipitationMm.toFixed(1)} mm` },
        ].map((s) => (
          <div key={s.l} className="bg-white px-2 py-3 text-center">
            <div className="flex justify-center text-leaf-600">{s.i}</div>
            <p className="mt-1 text-[10px] text-soil-700/70">{s.l}</p>
            <p className="text-sm font-semibold text-soil-900">{s.v}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 p-4">
        {wx.advisories.map((a, i) => (
          <div key={`${a.code}-${i}`} className="flex gap-2 rounded-xl bg-harvest-400/12 p-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-harvest-500" />
            <p className="text-xs leading-relaxed text-soil-900">{renderLocalised(language, a)}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-leaf-50 p-4">
        <p className="mb-2 text-xs font-semibold text-soil-900">{t('wx.forecast')}</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {wx.daily.map((d) => (
            <div key={d.date} className="min-w-[68px] shrink-0 rounded-xl bg-soil-50 p-2.5 text-center">
              <p className="text-[10px] text-soil-700/70">
                {new Date(d.date).toLocaleDateString(locale, { weekday: 'short' })}
              </p>
              <p className="mt-1 text-sm font-bold text-soil-900">{d.tMaxC.toFixed(0)}°</p>
              <p className="text-[10px] text-soil-700/60">{d.tMinC.toFixed(0)}°</p>
              <p className="mt-1 text-[10px] font-semibold text-leaf-600">{d.rainMm.toFixed(0)}mm</p>
              <p className="text-[9px] text-soil-700/60">{d.rainProbPct.toFixed(0)}%</p>
            </div>
          ))}
        </div>
      </div>

      {stale && (
        <p className="flex items-center gap-1 bg-soil-50 px-4 py-2 text-[10px] text-soil-700">
          <WifiOff size={10} /> {t('common.stale')}
        </p>
      )}
    </div>
  );
}