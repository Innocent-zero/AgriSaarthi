import { useEffect, useState } from 'react';
import {
  CloudSun, Droplets, Wind, MapPin, Leaf, TrendingUp, ShieldAlert, Sprout,
  FileText, Landmark, ChevronRight, CheckCircle2, Sun, Tractor, Wheat,
  CircleHelp, Pencil, WifiOff,
} from 'lucide-react';
import type { TFunc } from '@/lib/i18n';
import { renderLocalised } from '@/lib/i18n';
import type { ViewKey } from '@/components/NavDrawer';
import type { Farm } from '@/App';
import { api, type WeatherSnapshot, type RiskAssessment } from '@/lib/api';
import { cacheAdvisory, readAdvisory } from '@/lib/idb';

interface Props {
  t: TFunc;
  farm: Farm;
  online: boolean;
  onNavigate: (v: ViewKey) => void;
  onEditFarm: () => void;
}

export default function HomeDashboard({ t, farm, online, onNavigate, onEditFarm }: Props) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
  const [wx, setWx] = useState<WeatherSnapshot | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const wxKey = `wx:${farm.lat.toFixed(3)}:${farm.lon.toFixed(3)}`;
      const cachedWx = await readAdvisory<WeatherSnapshot>(wxKey);
      if (cachedWx && alive) { setWx(cachedWx); setStale(true); }
      try {
        const freshWx = await api.weather(farm.lat, farm.lon);
        if (alive) { setWx(freshWx); setStale(false); }
        await cacheAdvisory(wxKey, freshWx);
      } catch { /* cached copy stands, or nothing yet */ }

      const riskKey = `risk:${farm.lat.toFixed(3)}:${farm.lon.toFixed(3)}:${farm.crop}`;
      const cachedRisk = await readAdvisory<RiskAssessment>(riskKey);
      if (cachedRisk && alive) setRisk(cachedRisk);
      try {
        const freshRisk = await api.risk({ lat: farm.lat, lon: farm.lon, crop: farm.crop, state: farm.state, boundary: farm.boundary });
        if (alive) setRisk(freshRisk);
        await cacheAdvisory(riskKey, freshRisk);
      } catch { /* cached copy stands, or nothing yet */ }
    })();
    return () => { alive = false; };
  }, [farm.lat, farm.lon, farm.crop, farm.state, farm.boundary]);

  const locationLabel = farm.district || farm.village || farm.state
    || `${farm.lat.toFixed(2)}, ${farm.lon.toFixed(2)}`;

  const topFactor = risk?.factors?.slice().sort((a, b) => b.score - a.score)[0];
  const riskIsCalm = risk?.overallBand === 'low';

  return (
    <div className="pb-24">
      <section className="relative mx-3 mt-3 overflow-hidden rounded-[28px] bg-gradient-to-b from-[#e5f3dd] via-[#eff8e9] to-[#dff1ec] px-5 pb-0 pt-8 sm:mx-5 sm:pt-12">
        <div className="relative z-10 mx-auto max-w-2xl text-center">
          <div className="mb-3 flex items-center justify-center gap-1.5 text-[11px] font-semibold tracking-[0.18em] text-leaf-700 uppercase">
            <Leaf size={13} /> {t('app.name')}
          </div>
          <h1 className="serif-heading text-[clamp(2.4rem,7vw,4.5rem)] leading-[.98] text-soil-800">
            Where your farm meets<br />
            <span className="text-leaf-600">better decisions.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-soil-600 sm:text-base">
            {t('home.subtitle').replace('{name}', farm.farmerName).replace('{crop}', farm.crop)}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button onClick={() => onNavigate('disease')} className="btn-primary rounded-full px-5 py-3 text-sm shadow-soft">
              <Leaf size={16} /> {t('home.primary.crop')}
            </button>
            <button onClick={() => onNavigate('mandi')} className="btn-outline rounded-full border-leaf-300 bg-white/60 px-5 py-3 text-sm">
              <TrendingUp size={16} /> {t('home.primary.sell')}
            </button>
          </div>
        </div>

        <div className="relative mx-auto mt-9 h-[185px] max-w-3xl overflow-hidden rounded-t-[48%] bg-gradient-to-b from-[#c8e8c1] via-[#91c17e] to-[#d8af63] sm:h-[225px]">
          <div className="absolute left-[8%] top-5 h-8 w-8 rounded-full bg-white/50 blur-[1px]" />
          <div className="absolute right-[18%] top-9 h-12 w-12 rounded-full bg-white/30 blur-[2px]" />
          <div className="absolute -bottom-16 left-[-8%] h-44 w-[120%] rotate-[-4deg] rounded-[50%] bg-[#76af67]" />
          <div className="absolute -bottom-24 left-[-12%] h-40 w-[125%] rotate-[7deg] rounded-[50%] bg-[#b9c96b]" />
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-[#d9a84f] [clip-path:polygon(0_55%,12%_42%,24%_60%,37%_35%,49%_58%,61%_30%,75%_55%,89%_34%,100%_48%,100%_100%,0_100%)]" />
          <div className="absolute bottom-4 left-[16%] text-[#5a7048]">
            <Wheat size={28} strokeWidth={1.4} />
          </div>
          <div className="absolute bottom-5 right-[19%] text-[#3e5d3b]">
            <Tractor size={42} strokeWidth={1.25} />
          </div>
          <div className="absolute bottom-0 left-[48%] h-10 w-1.5 rounded-t-full bg-[#567b45]" />
          <div className="absolute bottom-9 left-[46%] h-6 w-6 rounded-full bg-[#6f9d57]" />
        </div>
      </section>

      <section className="mx-3 bg-white px-5 py-8 sm:mx-5 sm:px-10">
        <div className="mx-auto grid max-w-2xl gap-5 sm:grid-cols-[1.4fr_1fr_1fr] sm:items-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-leaf-600">{today}</p>
            <h2 className="serif-heading mt-1 text-2xl text-soil-800">{t('home.greeting').replace('{name}', farm.farmerName)}</h2>
            <p className="mt-2 text-sm leading-relaxed text-soil-500">A calm, clear view of what your farm needs today.</p>
          </div>
          <div className="flex items-center gap-3 border-t border-soil-100 pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-leaf-50 text-leaf-700"><Leaf size={18} /></div>
            <div>
              <p className="text-sm font-bold text-soil-900">{farm.crop}</p>
              <p className="text-xs text-soil-500">{farm.areaHa.toFixed(2)} {t('common.ha')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-soil-100 pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-sky-600"><MapPin size={18} /></div>
            <div className="flex-1">
              <p className="truncate text-sm font-bold text-soil-900">{locationLabel}</p>
              <p className="text-xs text-soil-500">{online ? t('common.online') : t('common.offline')}</p>
            </div>
            <button onClick={onEditFarm} className="rounded-lg p-1.5 text-soil-400 transition hover:bg-soil-50 hover:text-leaf-600" aria-label="Edit farm details">
              <Pencil size={14} />
            </button>
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-b from-[#ddf4fa] to-[#c5effa] px-3 py-8 sm:px-5 sm:py-12">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex items-end justify-between">
            <div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">Your farm, at a glance</p><h2 className="serif-heading mt-1 text-3xl text-soil-800">What matters today</h2></div>
            <span className={`chip bg-white/70 ${online ? 'text-leaf-700' : 'text-alert-600'}`}>
              {online ? <CheckCircle2 size={11} /> : <WifiOff size={11} />} {online ? t('common.online') : t('common.offline')}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-white p-4 shadow-soft sm:col-span-2">
              {wx ? (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-soil-400">{t('weather.title')}</p>
                      <p className="mt-1 text-3xl font-bold text-soil-900">{wx.current.temperatureC.toFixed(0)}°C</p>
                      <p className="text-xs text-soil-500">
                        {wx.advisories[0] ? renderLocalised(farm.language, wx.advisories[0]) : t('weather.recoStable')}
                      </p>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600"><Sun size={26} /></div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-soil-100 pt-3">
                    {[
                      { i: <Droplets size={14} />, l: t('weather.humidity'), v: `${wx.current.humidityPct.toFixed(0)}%` },
                      { i: <Wind size={14} />, l: t('weather.wind'), v: `${wx.current.windSpeedKmh.toFixed(0)} km/h` },
                      { i: <CloudSun size={14} />, l: t('weather.rain'), v: `${wx.current.precipitationMm.toFixed(1)} mm` },
                    ].map((s) => (
                      <div key={s.l} className="text-center">
                        <div className="flex justify-center text-sky-600">{s.i}</div>
                        <p className="mt-1 text-[10px] text-soil-500">{s.l}</p>
                        <p className="text-xs font-bold text-soil-900">{s.v}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-24 animate-pulse rounded-xl bg-soil-50" />
              )}
              <button onClick={() => onNavigate('weather')} className="mt-3 flex items-center gap-1 text-xs font-bold text-leaf-700">{t('weather.viewFull')} <ChevronRight size={13} /></button>
            </div>

            <div className={`rounded-2xl border p-4 shadow-soft ${riskIsCalm ? 'border-leaf-200 bg-leaf-50' : 'border-harvest-300/40 bg-[#fffaf0]'}`}>
              <div className="flex items-center gap-2">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-white ${riskIsCalm ? 'bg-leaf-600' : 'bg-harvest-500'}`}>
                  <ShieldAlert size={18} />
                </div>
                <p className={`text-xs font-bold uppercase tracking-wide ${riskIsCalm ? 'text-leaf-700' : 'text-harvest-700'}`}>
                  {t('home.attention')}
                </p>
              </div>
              {risk ? (
                <>
                  <p className="mt-3 text-sm font-bold text-soil-900">
                    {riskIsCalm ? t('risk.band.low') : (topFactor ? renderLocalised(farm.language, topFactor.detail) : t('risk.band.' + risk.overallBand))}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-soil-600">
                    {riskIsCalm ? t('home.attention.calm') : t('risk.mainReasons')}
                  </p>
                </>
              ) : (
                <div className="mt-3 h-10 animate-pulse rounded-xl bg-soil-50" />
              )}
              <button onClick={() => onNavigate('risk')} className="mt-3 flex items-center gap-1 text-xs font-bold text-leaf-700">{t('home.seeRisk')} <ChevronRight size={13} /></button>
            </div>

            <div className="rounded-2xl bg-leaf-700 p-4 text-white shadow-soft">
              <div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15"><Leaf size={18} /></div><p className="text-xs font-bold uppercase tracking-wide opacity-80">Priority 01</p></div>
              <p className="mt-3 text-sm font-bold">{t('home.primary.crop')}</p><p className="mt-1 text-xs opacity-80">{t('home.primary.crop.sub')}</p>
              <button onClick={() => onNavigate('disease')} className="mt-3 flex items-center gap-1 text-xs font-bold text-white">Open tool <ChevronRight size={13} /></button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-3 bg-white px-5 py-8 sm:mx-5 sm:px-10 sm:py-12">
        <div className="mx-auto max-w-2xl">
          <div className="mb-5 text-center"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-leaf-600">Your toolkit</p><h2 className="serif-heading mt-1 text-3xl text-soil-800">More ways to grow well</h2></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { v: 'mandi' as ViewKey, icon: TrendingUp, label: t('tile.mandi'), sub: t('tile.mandi.sub'), color: 'bg-harvest-50 text-harvest-700' },
              { v: 'npk' as ViewKey, icon: Sprout, label: t('tile.npk'), sub: t('tile.npk.sub'), color: 'bg-leaf-50 text-leaf-700' },
              { v: 'risk' as ViewKey, icon: ShieldAlert, label: t('tile.risk'), sub: t('tile.risk.sub'), color: 'bg-harvest-50 text-harvest-700' },
              { v: 'pmfby' as ViewKey, icon: FileText, label: t('tile.pmfby'), sub: t('tile.pmfby.sub'), color: 'bg-soil-100 text-soil-600' },
              { v: 'schemes' as ViewKey, icon: Landmark, label: t('tile.schemes'), sub: t('tile.schemes.sub'), color: 'bg-sky-50 text-sky-700' },
              { v: 'weather' as ViewKey, icon: CloudSun, label: t('tile.weather'), sub: t('tile.weather.sub'), color: 'bg-sky-50 text-sky-700' },
            ].map((tool) => { const Icon = tool.icon; return <button key={tool.v} onClick={() => onNavigate(tool.v)} className="group rounded-2xl border border-soil-100 bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tool.color}`}><Icon size={19} /></span><p className="mt-3 text-xs font-bold text-soil-900">{tool.label}</p><p className="mt-1 text-[10px] leading-relaxed text-soil-500">{tool.sub}</p><ChevronRight size={14} className="mt-2 text-soil-300 transition group-hover:translate-x-0.5" /></button>; })}
          </div>
        </div>
      </section>

      <section className="mx-3 rounded-b-[28px] bg-[#edf7ed] px-5 py-8 sm:mx-5 sm:px-10">
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left"><div><p className="serif-heading text-2xl text-soil-800">Need a quick answer?</p><p className="mt-1 text-xs text-soil-500">Your farming copilot is always nearby.</p></div><button className="btn-outline rounded-full bg-white px-5 py-2.5 text-xs" onClick={() => document.querySelector<HTMLButtonElement>('[data-chat-trigger]')?.click()}><CircleHelp size={15} /> {t('chat.ask')}</button></div>
      </section>
    </div>
  );
}
