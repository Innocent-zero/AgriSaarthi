
import { useEffect, useMemo, useState } from 'react';
import { Sprout, Droplets, IndianRupee, RefreshCw, Info, MapPinned } from 'lucide-react';
import { api, SoilSnapshot, friendlyError } from '@/lib/api';
import { makeT, Locale } from '@/lib/i18n';
import { cacheAdvisory, readAdvisory } from '@/lib/idb';
import { polygonAreaHectares } from '@/lib/geo';

interface Props {
  lat: number;
  lon: number;
  crop: string;
  areaHa: number;
  boundary?: Array<{ lat: number; lon: number }>;
  language: Locale;
}

// ICAR / state-recommended NPK doses (kg/ha).
const CROP_NPK: Record<string, { n: number; p: number; k: number; waterMmPerCycle: number }> = {
  wheat:     { n: 120, p: 60, k: 40,  waterMmPerCycle: 55 },
  rice:      { n: 100, p: 50, k: 50,  waterMmPerCycle: 75 },
  maize:     { n: 150, p: 75, k: 60,  waterMmPerCycle: 60 },
  cotton:    { n: 100, p: 50, k: 50,  waterMmPerCycle: 65 },
  sugarcane: { n: 250, p: 85, k: 85,  waterMmPerCycle: 90 },
  mustard:   { n: 80,  p: 40, k: 30,  waterMmPerCycle: 45 },
  potato:    { n: 180, p: 80, k: 100, waterMmPerCycle: 50 },
  soybean:   { n: 30,  p: 75, k: 40,  waterMmPerCycle: 55 },
};

// Crop-specific nitrogen splits. Sugarcane runs 12–18 months, so its schedule
// is nothing like a cereal's — applying a wheat schedule to cane is wrong.
const SPLIT_SCHEDULE: Record<string, Array<{ key: string; share: number }>> = {
  default: [
    { key: 'npk.split.basal',  share: 0.35 },
    { key: 'npk.split.first',  share: 0.40 },
    { key: 'npk.split.second', share: 0.25 },
  ],
  sugarcane: [
    { key: 'npk.split.canePlant',  share: 0.20 },
    { key: 'npk.split.caneTiller', share: 0.40 },
    { key: 'npk.split.caneEarth',  share: 0.40 },
  ],
  potato: [
    { key: 'npk.split.potatoPlant', share: 0.50 },
    { key: 'npk.split.potatoEarth', share: 0.50 },
  ],
  rice: [
    { key: 'npk.split.riceTransplant', share: 0.33 },
    { key: 'npk.split.riceTiller',     share: 0.34 },
    { key: 'npk.split.ricePanicle',    share: 0.33 },
  ],
};

const PRICE_PER_KG = { urea: 5.6, dap: 27.0, mop: 17.5 }; // subsidised retail, INR/kg
const PRICE_AS_OF = '2026-01'; // TODO: keep this current, or source from the pricing API

interface ShcOverride {
  availableN?: number;
  availableP?: number;
  availableK?: number;
}

function hasShcOverride(shc: ShcOverride): boolean {
  return shc.availableN != null || shc.availableP != null || shc.availableK != null;
}

export default function NpkCalculatorWidget({ lat, lon, crop, areaHa, boundary, language }: Props) {
  const t = makeT(language);
  const [soil, setSoil] = useState<SoilSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualArea, setManualArea] = useState(areaHa || 1);
  const [targetYieldPct, setTargetYieldPct] = useState(100);
  const [useBoundaryArea, setUseBoundaryArea] = useState(false);
  const [showShc, setShowShc] = useState(false);
  const [shc, setShc] = useState<ShcOverride>({});

  const cropKey = (crop || 'wheat').toLowerCase().trim();
  const base = CROP_NPK[cropKey] ?? CROP_NPK.wheat;

  const boundaryAreaHa = useMemo(() => polygonAreaHectares(boundary ?? []), [boundary]);
  const hasBoundary = boundaryAreaHa > 0.001;
  const area = useBoundaryArea && hasBoundary ? boundaryAreaHa : manualArea;

  useEffect(() => { setManualArea(areaHa || 1); }, [areaHa]);
  useEffect(() => { if (hasBoundary) setUseBoundaryArea(true); }, [hasBoundary]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const key = `soil:${lat.toFixed(3)}:${lon.toFixed(3)}`;
      const cached = await readAdvisory<SoilSnapshot>(key, 30 * 24 * 3600 * 1000);
      if (cached && alive) {
        setSoil(cached);
        setLoading(false);
      }
      try {
        const fresh = await api.soil(lat, lon);
        if (!alive) return;
        setSoil(fresh);
        setError(null);
        await cacheAdvisory(key, fresh);
      } catch (e) {
        if (alive && !cached) setError(friendlyError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [lat, lon]);

  const plan = useMemo(() => {
    if (!soil) return null;

    const yieldFactor = targetYieldPct / 100;
    const targetN = base.n * yieldFactor;
    const targetP = base.p * yieldFactor;
    const targetK = base.k * yieldFactor;

    let nHa: number;
    let pHa: number;
    let kHa: number;
    let basis: 'proxy' | 'shc' = 'proxy';

    if (hasShcOverride(shc)) {
      // Farmer-supplied Soil Health Card values take priority over the
      // satellite-derived proxy — direct credit against the available nutrient.
      basis = 'shc';
      nHa = Math.max(0, targetN - (shc.availableN ?? 0) * 0.5);
      pHa = Math.max(0, targetP - (shc.availableP ?? 0) * 0.6);
      kHa = Math.max(0, targetK - (shc.availableK ?? 0) * 0.5);
    } else {
      // Soil organic carbon supplies part of the nitrogen requirement.
      const socCredit = Math.min(0.30, Math.max(0, (soil.organicCarbonGkg - 4) * 0.045));
      // High CEC retains potassium, so applied K can be trimmed.
      const cecCredit = Math.min(0.22, Math.max(0, (soil.cecCmolKg - 10) * 0.018));
      // Alkaline soil locks phosphorus, so P must be raised.
      const pPenalty = soil.phH2O > 7.8 ? 0.16 : soil.phH2O < 5.8 ? 0.10 : 0;

      nHa = targetN * (1 - socCredit);
      pHa = targetP * (1 + pPenalty);
      kHa = targetK * (1 - cecCredit);
    }

    // DAP carries 18% N and 46% P₂O₅; urea 46% N; MOP 60% K₂O.
    const dapKg = (pHa / 0.46) * area;
    const nFromDap = dapKg * 0.18;
    const ureaKg = Math.max(0, (nHa * area - nFromDap) / 0.46);
    const mopKg = (kHa / 0.6) * area;
    const cost = ureaKg * PRICE_PER_KG.urea + dapKg * PRICE_PER_KG.dap + mopKg * PRICE_PER_KG.mop;

    // Sandy soils drain fast → shorter, more frequent cycles.
    const interval = soil.sandPct > 60 ? 5 : soil.clayPct > 38 ? 10 : 7;
    const waterMm = base.waterMmPerCycle * (soil.sandPct > 60 ? 0.8 : 1);

    const schedule = SPLIT_SCHEDULE[cropKey] ?? SPLIT_SCHEDULE.default;

    return {
      basis,
      nHa: Math.round(nHa), pHa: Math.round(pHa), kHa: Math.round(kHa),
      ureaKg: Math.round(ureaKg), dapKg: Math.round(dapKg), mopKg: Math.round(mopKg),
      cost: Math.round(cost), interval, waterMm: Math.round(waterMm),
      splits: schedule.map((s, i) => ({
        key: s.key,
        urea: Math.round(ureaKg * s.share),
        dap: i === 0 ? Math.round(dapKg) : 0,
        mop: i === 0 ? Math.round(mopKg) : 0,
      })),
    };
  }, [soil, base, area, targetYieldPct, cropKey, shc]);

  if (loading && !soil) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-leaf-100 bg-white p-6 text-sm text-soil-700">
        <RefreshCw size={16} className="animate-spin" /> {t('npk.fetchingSoil')}
      </div>
    );
  }

  if (error && !soil) {
    return <div className="rounded-2xl border border-alert-400/40 bg-alert-400/5 p-4 text-sm text-alert-600">{error}</div>;
  }

  if (!soil || !plan) return null;

  const textureLabel = t(soil.textureCode);

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center gap-2 bg-leaf-600 px-4 py-3 text-white">
        <Sprout size={18} />
        <h3 className="text-sm font-semibold">{t('npk.title')} · {crop}</h3>
      </div>

      <div className="grid grid-cols-2 gap-px bg-leaf-50 sm:grid-cols-4">
        {[
          { l: t('npk.texture'), v: textureLabel },
          { l: t('npk.ph'), v: soil.phH2O.toFixed(1) },
          { l: t('npk.oc'), v: `${soil.organicCarbonGkg.toFixed(1)} g/kg` },
          { l: t('npk.cec'), v: soil.cecCmolKg.toFixed(1) },
        ].map((s) => (
          <div key={s.l} className="bg-white px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-soil-700/70">{s.l}</p>
            <p className="text-sm font-semibold text-soil-900">{s.v}</p>
          </div>
        ))}
      </div>

      <div className="space-y-4 p-4">
        <div>
          <label className="mb-1 flex justify-between text-xs font-medium text-soil-700">
            <span className="flex items-center gap-1.5">
              {hasBoundary && <MapPinned size={13} className="text-leaf-600" />}
              {t('npk.fieldArea')}
            </span>
            <span className="font-semibold text-leaf-700">{area.toFixed(2)} {t('common.ha')}</span>
          </label>

          {hasBoundary ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setUseBoundaryArea(true)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  useBoundaryArea ? 'bg-leaf-600 text-white' : 'bg-leaf-50 text-leaf-700'
                }`}
              >
                {t('npk.areaFromMap', { area: boundaryAreaHa.toFixed(2) })}
              </button>
              <button
                type="button"
                onClick={() => setUseBoundaryArea(false)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  !useBoundaryArea ? 'bg-leaf-600 text-white' : 'bg-leaf-50 text-leaf-700'
                }`}
              >
                {t('npk.areaManual')}
              </button>
            </div>
          ) : (
            <p className="mb-1 text-[11px] text-soil-700/70">{t('npk.areaHint')}</p>
          )}

          {!useBoundaryArea && (
            <input type="range" min={0.1} max={20} step={0.1} value={manualArea}
                   onChange={(e) => setManualArea(Number(e.target.value))}
                   className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-leaf-100 accent-leaf-600" />
          )}
        </div>

        <div>
          <label className="mb-1 flex justify-between text-xs font-medium text-soil-700">
            <span className="flex items-center gap-1">
              {t('npk.targetYield')}
              <Info size={11} className="text-soil-700/50" />
            </span>
            <span className="font-semibold text-leaf-700">{targetYieldPct}%</span>
          </label>
          <input type="range" min={60} max={130} step={5} value={targetYieldPct}
                 onChange={(e) => setTargetYieldPct(Number(e.target.value))}
                 className="h-2 w-full cursor-pointer appearance-none rounded-full bg-leaf-100 accent-leaf-600" />
          <p className="mt-1 text-[10px] text-soil-700/60">{t('npk.targetYieldHint')}</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { k: 'N', v: plan.nHa, c: 'bg-leaf-600' },
            { k: 'P2O5', v: plan.pHa, c: 'bg-harvest-500' },
            { k: 'K2O', v: plan.kHa, c: 'bg-soil-700' },
          ].map((n) => (
            <div key={n.k} className={`${n.c} rounded-xl p-3 text-center text-white`}>
              <p className="text-[11px] opacity-80">{n.k}</p>
              <p className="text-lg font-bold">{n.v}</p>
              <p className="text-[10px] opacity-80">kg/ha</p>
            </div>
          ))}
        </div>

        <p className="rounded-lg bg-soil-50 px-3 py-2 text-[10px] leading-relaxed text-soil-700">
          {plan.basis === 'shc' ? t('npk.basisShc') : t('npk.basisProxy')}
        </p>

        <div className="rounded-xl border border-dashed border-leaf-200 p-3">
          <button type="button" onClick={() => setShowShc((v) => !v)} className="text-xs font-semibold text-leaf-700">
            {showShc ? t('npk.hideShc') : t('npk.showShc')}
          </button>
          {showShc && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { label: t('npk.availableN'), key: 'availableN' as const },
                { label: t('npk.availableP'), key: 'availableP' as const },
                { label: t('npk.availableK'), key: 'availableK' as const },
              ].map((field) => (
                <label key={field.key} className="text-[10px] text-soil-700">
                  {field.label}
                  <input
                    type="number"
                    min={0}
                    value={shc[field.key] ?? ''}
                    onChange={(e) => {
                      const next = e.target.value === '' ? undefined : Number(e.target.value);
                      setShc((current) => ({ ...current, [field.key]: next }));
                    }}
                    className="mt-1 w-full rounded-lg border border-leaf-100 px-2 py-1.5 text-xs outline-none focus:border-leaf-500"
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-soil-50 p-3">
          <p className="mb-2 text-xs font-semibold text-soil-900">
            {t('npk.bagsFor', { area: area.toFixed(2) })}
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {[
              { n: t('npk.urea'), kg: plan.ureaKg },
              { n: t('npk.dap'), kg: plan.dapKg },
              { n: t('npk.mop'), kg: plan.mopKg },
            ].map((f) => (
              <div key={f.n} className="rounded-lg bg-white p-2">
                <p className="text-[11px] text-soil-700">{f.n}</p>
                <p className="font-bold text-soil-900">{f.kg} kg</p>
                <p className="text-[10px] text-soil-700/70">≈ {Math.ceil(f.kg / 45)} {t('common.bags')}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-harvest-400/15 px-3 py-2">
            <span className="flex items-center gap-1 text-xs font-medium text-soil-900">
              <IndianRupee size={13} /> {t('npk.estCost')}
            </span>
            <span className="text-base font-bold text-soil-900">INR {plan.cost.toLocaleString('en-IN')}</span>
          </div>
          <p className="mt-1 text-right text-[9px] text-soil-700/50">{t('npk.pricesAsOf', { date: PRICE_AS_OF })}</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-soil-900">{t('npk.schedule')}</p>
          <div className="space-y-1.5">
            {plan.splits.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2 rounded-lg border border-leaf-50 px-3 py-2 text-xs">
                <span className="text-soil-700">{t(s.key)}</span>
                <span className="text-right font-semibold text-soil-900">
                  {s.urea > 0 && `${s.urea} kg ${t('npk.urea')}`}
                  {s.dap > 0 && ` + ${s.dap} kg ${t('npk.dap')}`}
                  {s.mop > 0 && ` + ${s.mop} kg ${t('npk.mop')}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-leaf-50 p-3">
          <Droplets size={16} className="mt-0.5 shrink-0 text-leaf-600" />
          <p className="text-xs leading-relaxed text-soil-900">
            {t('npk.irrigationTip', { texture: textureLabel, mm: plan.waterMm, days: plan.interval })}
          </p>
        </div>
      </div>
    </div>
  );
}
