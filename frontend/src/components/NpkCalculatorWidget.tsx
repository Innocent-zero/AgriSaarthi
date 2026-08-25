'use client';

import { useEffect, useMemo, useState } from 'react';
import { Droplets, IndianRupee, Info, MapPinned, RefreshCw, Sprout } from 'lucide-react';
import { api, friendlyError, SoilSnapshot } from '@/lib/api';
import { polygonAreaHectares } from '@/lib/geo';
import { cacheAdvisory, readAdvisory } from '@/lib/idb';

interface Props {
  lat: number;
  lon: number;
  crop: string;
  areaHa: number;
  boundary?: Array<{ lat: number; lon: number }>;
  language: 'hi' | 'en';
}

const CROP_NPK: Record<string, { n: number; p: number; k: number; waterMmPerCycle: number }> = {
  wheat: { n: 120, p: 60, k: 40, waterMmPerCycle: 55 },
  rice: { n: 100, p: 50, k: 50, waterMmPerCycle: 75 },
  maize: { n: 150, p: 75, k: 60, waterMmPerCycle: 60 },
  cotton: { n: 100, p: 50, k: 50, waterMmPerCycle: 65 },
  sugarcane: { n: 250, p: 85, k: 85, waterMmPerCycle: 90 },
  mustard: { n: 80, p: 40, k: 30, waterMmPerCycle: 45 },
  potato: { n: 180, p: 80, k: 100, waterMmPerCycle: 50 },
  soybean: { n: 30, p: 75, k: 40, waterMmPerCycle: 55 },
};

const PRICE_PER_KG = { urea: 5.6, dap: 27.0, mop: 17.5 };
const PRICE_AS_OF = '2026-01';

type Level = 'low' | 'medium' | 'high';
type PhClass = 'acidic' | 'neutral' | 'alkaline';

const N_ADJUST: Record<Level, number> = { low: 0, medium: -0.1, high: -0.2 };
const K_ADJUST: Record<Level, number> = { low: 0, medium: -0.1, high: -0.2 };
const P_ADJUST: Record<PhClass, number> = { acidic: 0.15, neutral: 0, alkaline: 0.2 };

const SPLIT_SCHEDULE: Record<string, Array<{ en: string; hi: string; share: number }>> = {
  default: [
    { en: 'At sowing (basal)', hi: 'Buwai ke samay (basal)', share: 0.35 },
    { en: 'First irrigation (21-25 days)', hi: 'Pehli sinchai (21-25 din)', share: 0.4 },
    { en: 'Second irrigation (45-50 days)', hi: 'Dusri sinchai (45-50 din)', share: 0.25 },
  ],
  rice: [
    { en: 'At transplanting (basal)', hi: 'Ropai ke samay (basal)', share: 0.33 },
    { en: 'Tillering (20-25 days)', hi: 'Tillering (20-25 din)', share: 0.34 },
    { en: 'Panicle initiation (40-45 days)', hi: 'Bali nikalne par (40-45 din)', share: 0.33 },
  ],
  sugarcane: [
    { en: 'At planting (basal)', hi: 'Ropai ke samay (basal)', share: 0.2 },
    { en: 'Tillering (about 60 days)', hi: 'Kalle footte samay (lagbhag 60 din)', share: 0.4 },
    { en: 'Earthing up (about 120 days)', hi: 'Mitti chadhate samay (lagbhag 120 din)', share: 0.4 },
  ],
  potato: [
    { en: 'At planting (basal)', hi: 'Buwai ke samay (basal)', share: 0.5 },
    { en: 'Earthing up (25-30 days)', hi: 'Mitti chadhate samay (25-30 din)', share: 0.5 },
  ],
};

interface ShcOverride {
  availableN?: number;
  availableP?: number;
  availableK?: number;
}

function organicCarbonLevel(gPerKg: number): Level {
  const pct = gPerKg / 10;
  if (pct < 0.5) return 'low';
  if (pct <= 0.75) return 'medium';
  return 'high';
}

function cecLevel(cmolKg: number): Level {
  if (cmolKg < 10) return 'low';
  if (cmolKg <= 20) return 'medium';
  return 'high';
}

function phClassOf(ph: number): PhClass {
  if (ph < 5.8) return 'acidic';
  if (ph <= 7.8) return 'neutral';
  return 'alkaline';
}

function hasShcOverride(shc: ShcOverride): boolean {
  return shc.availableN != null || shc.availableP != null || shc.availableK != null;
}

export default function NpkCalculatorWidget({ lat, lon, crop, areaHa, boundary, language }: Props) {
  const [soil, setSoil] = useState<SoilSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualArea, setManualArea] = useState(areaHa || 1);
  const [targetYieldPct, setTargetYieldPct] = useState(100);
  const [useBoundaryArea, setUseBoundaryArea] = useState(false);
  const [showShc, setShowShc] = useState(false);
  const [shc, setShc] = useState<ShcOverride>({});

  const hi = language === 'hi';
  const cropKey = (crop || 'wheat').toLowerCase().trim();
  const base = CROP_NPK[cropKey] ?? CROP_NPK.wheat;
  const boundaryAreaHa = useMemo(() => polygonAreaHectares(boundary ?? []), [boundary]);
  const hasBoundary = boundaryAreaHa > 0.001;
  const area = useBoundaryArea && hasBoundary ? boundaryAreaHa : manualArea;

  useEffect(() => setManualArea(areaHa || 1), [areaHa]);

  useEffect(() => {
    if (hasBoundary) setUseBoundaryArea(true);
  }, [hasBoundary]);

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
      basis = 'shc';
      nHa = Math.max(0, targetN - (shc.availableN ?? 0) * 0.5);
      pHa = Math.max(0, targetP - (shc.availableP ?? 0) * 0.6);
      kHa = Math.max(0, targetK - (shc.availableK ?? 0) * 0.5);
    } else {
      const ocLevel = organicCarbonLevel(soil.organicCarbonGkg);
      const cLevel = cecLevel(soil.cecCmolKg);
      const pClass = phClassOf(soil.phH2O);
      nHa = targetN * (1 + N_ADJUST[ocLevel]);
      pHa = targetP * (1 + P_ADJUST[pClass]);
      kHa = targetK * (1 + K_ADJUST[cLevel]);
    }

    const dapKg = (pHa / 0.46) * area;
    const nFromDap = dapKg * 0.18;
    const ureaKg = Math.max(0, (nHa * area - nFromDap) / 0.46);
    const mopKg = (kHa / 0.6) * area;
    const cost = ureaKg * PRICE_PER_KG.urea + dapKg * PRICE_PER_KG.dap + mopKg * PRICE_PER_KG.mop;
    const interval = soil.sandPct > 60 ? 5 : soil.clayPct > 38 ? 10 : 7;
    const waterMm = base.waterMmPerCycle * (soil.sandPct > 60 ? 0.8 : 1);
    const schedule = SPLIT_SCHEDULE[cropKey] ?? SPLIT_SCHEDULE.default;

    return {
      basis,
      nHa: Math.round(nHa),
      pHa: Math.round(pHa),
      kHa: Math.round(kHa),
      ureaKg: Math.round(ureaKg),
      dapKg: Math.round(dapKg),
      mopKg: Math.round(mopKg),
      cost: Math.round(cost),
      interval,
      waterMm: Math.round(waterMm),
      splits: schedule.map((split, index) => ({
        when: hi ? split.hi : split.en,
        urea: Math.round(ureaKg * split.share),
        dap: index === 0 ? Math.round(dapKg) : 0,
        mop: index === 0 ? Math.round(mopKg) : 0,
      })),
    };
  }, [soil, targetYieldPct, base, shc, area, cropKey, hi]);

  if (loading && !soil) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-leaf-100 bg-white p-6 text-sm text-soil-700">
        <RefreshCw size={16} className="animate-spin" />
        {hi ? 'Mitti ki jaankari li ja rahi hai...' : 'Fetching soil parameters...'}
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
          {hi ? 'Khad aur Sinchai Yojana' : 'Fertiliser & Irrigation Plan'} - {crop}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-px bg-leaf-50 sm:grid-cols-4">
        {[
          { l: hi ? 'Mitti' : 'Texture', v: soil.texture },
          { l: 'pH', v: soil.phH2O.toFixed(1) },
          { l: hi ? 'Carbon' : 'Org. carbon', v: `${soil.organicCarbonGkg.toFixed(1)} g/kg` },
          { l: 'CEC', v: soil.cecCmolKg.toFixed(1) },
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
              {hi ? 'Khet ka area' : 'Field area'}
            </span>
            <span className="font-semibold text-leaf-700">{area.toFixed(2)} ha</span>
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
                {hi ? `Map se (${boundaryAreaHa.toFixed(2)} ha)` : `From map (${boundaryAreaHa.toFixed(2)} ha)`}
              </button>
              <button
                type="button"
                onClick={() => setUseBoundaryArea(false)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  !useBoundaryArea ? 'bg-leaf-600 text-white' : 'bg-leaf-50 text-leaf-700'
                }`}
              >
                {hi ? 'Khud bharen' : 'Enter manually'}
              </button>
            </div>
          ) : (
            <p className="mb-1 text-[11px] text-soil-700/70">
              {hi ? 'Map par boundary banane se area apne aap niklega.' : 'Draw the field boundary on the map to auto-fill this.'}
            </p>
          )}

          {!useBoundaryArea && (
            <input
              type="range"
              min={0.1}
              max={20}
              step={0.1}
              value={manualArea}
              onChange={(e) => setManualArea(Number(e.target.value))}
              className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-leaf-100 accent-leaf-600"
            />
          )}
        </div>

        <div>
          <label className="mb-1 flex justify-between text-xs font-medium text-soil-700">
            <span className="flex items-center gap-1">
              Target yield
              <Info size={11} className="text-soil-700/50" />
            </span>
            <span className="font-semibold text-leaf-700">{targetYieldPct}%</span>
          </label>
          <input
            type="range"
            min={60}
            max={130}
            step={5}
            value={targetYieldPct}
            onChange={(e) => setTargetYieldPct(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-leaf-100 accent-leaf-600"
          />
          <p className="mt-1 text-[10px] text-soil-700/60">
            {hi
              ? '100% fasal ki standard recommended dose hai; slider dose ko target ke hisab se scale karta hai.'
              : "100% is the crop's standard recommended dose; the slider scales dose to the chosen target."}
          </p>
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
          {plan.basis === 'shc'
            ? hi
              ? 'Dose Soil Health Card ke available N/P/K par based hai.'
              : 'Dose is calculated from the Soil Health Card N/P/K values you entered.'
            : hi
              ? 'Estimate satellite soil data (pH, carbon, CEC) ke general soil-test classes par based hai. Actual Soil Health Card values hon to neeche add karein.'
              : 'This estimate uses general soil-test classes from satellite soil data (pH, carbon, CEC). Add Soil Health Card values below for a field-specific dose.'}
        </p>

        <div className="rounded-xl border border-dashed border-leaf-200 p-3">
          <button type="button" onClick={() => setShowShc((value) => !value)} className="text-xs font-semibold text-leaf-700">
            {showShc
              ? hi ? '- Soil Health Card chhupayen' : '- Hide Soil Health Card'
              : hi ? '+ Mere paas Soil Health Card hai' : '+ I have a Soil Health Card'}
          </button>
          {showShc && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { label: 'Available N (kg/ha)', key: 'availableN' as const },
                { label: 'Available P (kg/ha)', key: 'availableP' as const },
                { label: 'Available K (kg/ha)', key: 'availableK' as const },
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
            {hi ? `${area.toFixed(2)} ha ke liye total fertiliser` : `Fertiliser required for ${area.toFixed(2)} ha`}
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {[
              { n: 'Urea', kg: plan.ureaKg },
              { n: 'DAP', kg: plan.dapKg },
              { n: 'MOP', kg: plan.mopKg },
            ].map((f) => (
              <div key={f.n} className="rounded-lg bg-white p-2">
                <p className="text-[11px] text-soil-700">{f.n}</p>
                <p className="font-bold text-soil-900">{f.kg} kg</p>
                <p className="text-[10px] text-soil-700/70">
                  about {Math.ceil(f.kg / 45)} {hi ? 'bori' : 'bags'}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-harvest-400/15 px-3 py-2">
            <span className="flex items-center gap-1 text-xs font-medium text-soil-900">
              <IndianRupee size={13} /> Estimated cost
            </span>
            <span className="text-base font-bold text-soil-900">INR {plan.cost.toLocaleString('en-IN')}</span>
          </div>
          <p className="mt-1 text-right text-[9px] text-soil-700/50">Prices as of {PRICE_AS_OF}</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-soil-900">Split application schedule</p>
          <div className="space-y-1.5">
            {plan.splits.map((split) => (
              <div key={split.when} className="flex items-center justify-between gap-3 rounded-lg border border-leaf-50 px-3 py-2 text-xs">
                <span className="text-soil-700">{split.when}</span>
                <span className="text-right font-semibold text-soil-900">
                  {split.urea > 0 && `${split.urea} kg urea`}
                  {split.dap > 0 && ` + ${split.dap} kg DAP`}
                  {split.mop > 0 && ` + ${split.mop} kg MOP`}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-leaf-50 p-3">
          <Droplets size={16} className="mt-0.5 shrink-0 text-leaf-600" />
          <p className="text-xs leading-relaxed text-soil-900">
            {hi
              ? `${soil.texture} soil me lagbhag ${plan.waterMm} mm paani har ${plan.interval} din dein. Barish forecast ho to cycle skip karein.`
              : `On your ${soil.texture.toLowerCase()}, apply about ${plan.waterMm} mm every ${plan.interval} days. Skip the cycle when rain is forecast.`}
          </p>
        </div>
      </div>
    </div>
  );
}
