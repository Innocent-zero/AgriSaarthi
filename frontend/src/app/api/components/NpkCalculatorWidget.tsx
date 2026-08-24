'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sprout, Droplets, IndianRupee, RefreshCw } from 'lucide-react';
import { api, SoilSnapshot, friendlyError } from '@/lib/api';
import { cacheAdvisory, readAdvisory } from '@/lib/idb';

interface Props {
  lat: number;
  lon: number;
  crop: string;
  areaHa: number;
  language: 'hi' | 'en';
}

// Standard ICAR/state-recommended NPK doses (kg/ha) for common Indian crops.
const CROP_NPK: Record<string, { n: number; p: number; k: number; waterMmPerCycle: number }> = {
  wheat:     { n: 120, p: 60, k: 40, waterMmPerCycle: 55 },
  rice:      { n: 100, p: 50, k: 50, waterMmPerCycle: 75 },
  maize:     { n: 150, p: 75, k: 60, waterMmPerCycle: 60 },
  cotton:    { n: 100, p: 50, k: 50, waterMmPerCycle: 65 },
  sugarcane: { n: 250, p: 85, k: 85, waterMmPerCycle: 90 },
  mustard:   { n: 80,  p: 40, k: 30, waterMmPerCycle: 45 },
  potato:    { n: 180, p: 80, k: 100, waterMmPerCycle: 50 },
  soybean:   { n: 30,  p: 75, k: 40, waterMmPerCycle: 55 },
};

const PRICE_PER_KG = { urea: 5.6, dap: 27.0, mop: 17.5 }; // subsidised retail, INR/kg

export default function NpkCalculatorWidget({ lat, lon, crop, areaHa, language }: Props) {
  const [soil, setSoil] = useState<SoilSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState(areaHa || 1);
  const [targetYieldPct, setTargetYieldPct] = useState(100);

  const hi = language === 'hi';
  const cropKey = (crop || 'wheat').toLowerCase().trim();
  const base = CROP_NPK[cropKey] ?? CROP_NPK.wheat;

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const key = `soil:${lat.toFixed(3)}:${lon.toFixed(3)}`;
      const cached = await readAdvisory<SoilSnapshot>(key, 30 * 24 * 3600 * 1000);
      if (cached && alive) { setSoil(cached); setLoading(false); }
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
    return () => { alive = false; };
  }, [lat, lon]);

  const plan = useMemo(() => {
    if (!soil) return null;
    const yieldFactor = targetYieldPct / 100;

    // Soil-organic-carbon supplies part of the nitrogen requirement.
    const socCredit = Math.min(0.30, Math.max(0, (soil.organicCarbonGkg - 4) * 0.045));
    // High CEC retains potassium, so the applied K can be trimmed.
    const cecCredit = Math.min(0.22, Math.max(0, (soil.cecCmolKg - 10) * 0.018));
    // Alkaline soil locks phosphorus, so P must be raised.
    const pPenalty = soil.phH2O > 7.8 ? 0.16 : soil.phH2O < 5.8 ? 0.10 : 0;

    const nHa = base.n * yieldFactor * (1 - socCredit);
    const pHa = base.p * yieldFactor * (1 + pPenalty);
    const kHa = base.k * yieldFactor * (1 - cecCredit);

    // DAP carries 18% N and 46% P₂O₅; urea 46% N; MOP 60% K₂O.
    const dapKg = (pHa / 0.46) * area;
    const nFromDap = dapKg * 0.18;
    const ureaKg = Math.max(0, (nHa * area - nFromDap) / 0.46);
    const mopKg = (kHa / 0.60) * area;

    const cost = ureaKg * PRICE_PER_KG.urea + dapKg * PRICE_PER_KG.dap + mopKg * PRICE_PER_KG.mop;

    // Sandy soils drain fast → shorter, more frequent irrigation cycles.
    const interval = soil.sandPct > 60 ? 5 : soil.clayPct > 38 ? 10 : 7;
    const waterMm = base.waterMmPerCycle * (soil.sandPct > 60 ? 0.8 : 1);

    return {
      nHa: Math.round(nHa), pHa: Math.round(pHa), kHa: Math.round(kHa),
      ureaKg: Math.round(ureaKg), dapKg: Math.round(dapKg), mopKg: Math.round(mopKg),
      cost: Math.round(cost), interval, waterMm: Math.round(waterMm),
      splits: [
        { when: hi ? 'बुवाई के समय (बेसल)' : 'At sowing (basal)', urea: Math.round(ureaKg * 0.35), dap: Math.round(dapKg), mop: Math.round(mopKg) },
        { when: hi ? 'पहली सिंचाई (21–25 दिन)' : 'First irrigation (21–25 days)', urea: Math.round(ureaKg * 0.40), dap: 0, mop: 0 },
        { when: hi ? 'दूसरी सिंचाई (45–50 दिन)' : 'Second irrigation (45–50 days)', urea: Math.round(ureaKg * 0.25), dap: 0, mop: 0 },
      ],
    };
  }, [soil, base, area, targetYieldPct, hi]);

  if (loading && !soil) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-leaf-100 bg-white p-6 text-sm text-soil-700">
        <RefreshCw size={16} className="animate-spin" />
        {hi ? 'मिट्टी की जानकारी ली जा रही है…' : 'Fetching soil parameters…'}
      </div>
    );
  }
  if (error && !soil) {
    return <div className="rounded-2xl border border-alert-400/40 bg-alert-400/5 p-4 text-sm text-alert-600">{error}</div>;
  }
  if (!soil || !plan) return null;

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center gap-2 bg-leaf-600 px-4 py-3 text-white">
        <Sprout size={18} />
        <h3 className="text-sm font-semibold">
          {hi ? 'खाद व सिंचाई योजना' : 'Fertiliser & Irrigation Plan'} · {crop}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-px bg-leaf-50 sm:grid-cols-4">
        {[
          { l: hi ? 'मिट्टी' : 'Texture', v: soil.texture },
          { l: 'pH', v: soil.phH2O.toFixed(1) },
          { l: hi ? 'कार्बन' : 'Org. carbon', v: `${soil.organicCarbonGkg.toFixed(1)} g/kg` },
          { l: 'CEC', v: `${soil.cecCmolKg.toFixed(1)}` },
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
            <span>{hi ? 'खेत का रकबा' : 'Field area'}</span>
            <span className="font-semibold text-leaf-700">{area.toFixed(2)} ha</span>
          </label>
          <input type="range" min={0.1} max={20} step={0.1} value={area}
                 onChange={(e) => setArea(Number(e.target.value))}
                 className="h-2 w-full cursor-pointer appearance-none rounded-full bg-leaf-100 accent-leaf-600" />
        </div>

        <div>
          <label className="mb-1 flex justify-between text-xs font-medium text-soil-700">
            <span>{hi ? 'लक्ष्य उपज' : 'Target yield'}</span>
            <span className="font-semibold text-leaf-700">{targetYieldPct}%</span>
          </label>
          <input type="range" min={60} max={130} step={5} value={targetYieldPct}
                 onChange={(e) => setTargetYieldPct(Number(e.target.value))}
                 className="h-2 w-full cursor-pointer appearance-none rounded-full bg-leaf-100 accent-leaf-600" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { k: 'N', v: plan.nHa, c: 'bg-leaf-600' },
            { k: 'P₂O₅', v: plan.pHa, c: 'bg-harvest-500' },
            { k: 'K₂O', v: plan.kHa, c: 'bg-soil-700' },
          ].map((n) => (
            <div key={n.k} className={`${n.c} rounded-xl p-3 text-center text-white`}>
              <p className="text-[11px] opacity-80">{n.k}</p>
              <p className="text-lg font-bold">{n.v}</p>
              <p className="text-[10px] opacity-80">kg/ha</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-soil-50 p-3">
          <p className="mb-2 text-xs font-semibold text-soil-900">
            {hi ? `कुल ${area.toFixed(2)} हेक्टेयर के लिए बोरी` : `Bags required for ${area.toFixed(2)} ha`}
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {[
              { n: hi ? 'यूरिया' : 'Urea', kg: plan.ureaKg },
              { n: 'DAP', kg: plan.dapKg },
              { n: hi ? 'म्यूरेट (MOP)' : 'MOP', kg: plan.mopKg },
            ].map((f) => (
              <div key={f.n} className="rounded-lg bg-white p-2">
                <p className="text-[11px] text-soil-700">{f.n}</p>
                <p className="font-bold text-soil-900">{f.kg} kg</p>
                <p className="text-[10px] text-soil-700/70">≈ {Math.ceil(f.kg / 45)} {hi ? 'बोरी' : 'bags'}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-harvest-400/15 px-3 py-2">
            <span className="flex items-center gap-1 text-xs font-medium text-soil-900">
              <IndianRupee size={13} /> {hi ? 'अनुमानित लागत' : 'Estimated cost'}
            </span>
            <span className="text-base font-bold text-soil-900">₹{plan.cost.toLocaleString('en-IN')}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-soil-900">{hi ? 'कब कितना डालें' : 'Split application schedule'}</p>
          <div className="space-y-1.5">
            {plan.splits.map((s) => (
              <div key={s.when} className="flex items-center justify-between rounded-lg border border-leaf-50 px-3 py-2 text-xs">
                <span className="text-soil-700">{s.when}</span>
                <span className="font-semibold text-soil-900">
                  {s.urea > 0 && `${s.urea} kg ${hi ? 'यूरिया' : 'urea'}`}
                  {s.dap > 0 && ` + ${s.dap} kg DAP`}
                  {s.mop > 0 && ` + ${s.mop} kg MOP`}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-leaf-50 p-3">
          <Droplets size={16} className="mt-0.5 shrink-0 text-leaf-600" />
          <p className="text-xs leading-relaxed text-soil-900">
            {hi
              ? `आपकी ${soil.texture} में हर ${plan.interval} दिन पर लगभग ${plan.waterMm} मिमी पानी दें। बारिश की चेतावनी हो तो सिंचाई टाल दें।`
              : `On your ${soil.texture.toLowerCase()}, apply about ${plan.waterMm} mm every ${plan.interval} days. Skip the cycle when rain is forecast.`}
          </p>
        </div>
      </div>
    </div>
  );
}