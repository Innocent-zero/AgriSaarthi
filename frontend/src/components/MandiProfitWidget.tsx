'use client';

import { useState } from 'react';
import { TrendingUp, Truck, Plus, Trash2, Loader2, IndianRupee } from 'lucide-react';
import { api, MandiResponse, friendlyError } from '@/lib/api';

interface Props {
  lat: number;
  lon: number;
  crop: string;
  language: 'hi' | 'en';
}

interface Row {
  name: string;
  distanceKm: number;
  pricePerQuintal: number;
  handlingFee: number;
  commissionPct: number;
}

const EMPTY: Row = { name: '', distanceKm: 0, pricePerQuintal: 0, handlingFee: 150, commissionPct: 1.5 };

export default function MandiProfitWidget({ lat, lon, crop, language }: Props) {
  const hi = language === 'hi';
  const [volume, setVolume] = useState(40);
  const [localPrice, setLocalPrice] = useState(0);
  const [kmpl, setKmpl] = useState(8);
  const [fuelPrice, setFuelPrice] = useState(94.5);
  const [capacity, setCapacity] = useState(40);
  const [rows, setRows] = useState<Row[]>([
    { ...EMPTY, name: hi ? 'मंडी 1' : 'Mandi 1' },
    { ...EMPTY, name: hi ? 'मंडी 2' : 'Mandi 2' },
  ]);
  const [result, setResult] = useState<MandiResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function calculate() {
    setError(null);
    const valid = rows.filter((r) => r.name.trim() && r.pricePerQuintal > 0);
    if (valid.length === 0) {
      setError(hi ? 'कम से कम एक मंडी का नाम और भाव भरें।' : 'Enter at least one mandi name and price.');
      return;
    }
    setBusy(true);
    try {
      const data = await api.optimizeMandi({
        origin: { lat, lon },
        volumeQuintals: volume,
        crop,
        localPricePerQuintal: localPrice > 0 ? localPrice : undefined,
        vehicle: { kmpl, fuelPricePerLitre: fuelPrice, capacityQuintals: capacity },
        mandis: valid.map((r, i) => ({
          id: `m${i + 1}`,
          name: r.name.trim(),
          distanceKm: r.distanceKm,
          pricePerQuintal: r.pricePerQuintal,
          handlingFee: r.handlingFee,
          commissionPct: r.commissionPct,
        })),
      });
      setResult(data);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center gap-2 bg-harvest-500 px-4 py-3 text-white">
        <TrendingUp size={18} />
        <h3 className="text-sm font-semibold">{hi ? 'असली कमाई की तुलना' : 'True Net-Profit Comparison'}</h3>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-soil-700">
            {hi ? 'कुल उपज (क्विंटल)' : 'Volume (quintals)'}
            <input type="number" min={1} value={volume} onChange={(e) => setVolume(Number(e.target.value))}
                   className="mt-1 w-full rounded-lg border border-leaf-100 px-2.5 py-2 text-sm text-soil-900 outline-none focus:border-leaf-500" />
          </label>
          <label className="text-xs font-medium text-soil-700">
            {hi ? 'गाँव का भाव (₹/क्विं.)' : 'Local offer (₹/qtl)'}
            <input type="number" min={0} value={localPrice} onChange={(e) => setLocalPrice(Number(e.target.value))}
                   className="mt-1 w-full rounded-lg border border-leaf-100 px-2.5 py-2 text-sm text-soil-900 outline-none focus:border-leaf-500" />
          </label>
        </div>

        <details className="rounded-xl bg-soil-50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-soil-900">
            <Truck size={13} className="mr-1 inline" />
            {hi ? 'गाड़ी की जानकारी' : 'Vehicle details'}
          </summary>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { l: hi ? 'माइलेज' : 'km/l', v: kmpl, s: setKmpl },
              { l: hi ? 'डीज़ल ₹/L' : 'Fuel ₹/L', v: fuelPrice, s: setFuelPrice },
              { l: hi ? 'क्षमता (क्विं.)' : 'Capacity', v: capacity, s: setCapacity },
            ].map((f) => (
              <label key={f.l} className="text-[11px] text-soil-700">
                {f.l}
                <input type="number" value={f.v} onChange={(e) => f.s(Number(e.target.value))}
                       className="mt-1 w-full rounded-lg border border-soil-100 px-2 py-1.5 text-sm outline-none focus:border-leaf-500" />
              </label>
            ))}
          </div>
        </details>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl border border-leaf-50 p-2.5">
              <div className="flex items-center gap-2">
                <input value={r.name} placeholder={hi ? 'मंडी का नाम' : 'Mandi name'}
                       onChange={(e) => update(i, { name: e.target.value })}
                       className="min-w-0 flex-1 rounded-lg border border-leaf-100 px-2.5 py-1.5 text-sm outline-none focus:border-leaf-500" />
                {rows.length > 1 && (
                  <button onClick={() => setRows(rows.filter((_, x) => x !== i))}
                          className="rounded-lg p-1.5 text-alert-600 hover:bg-alert-400/10" aria-label="Remove">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {[
                  { l: hi ? 'दूरी km' : 'Dist km', v: r.distanceKm, k: 'distanceKm' as const },
                  { l: hi ? 'भाव ₹' : 'Rate ₹', v: r.pricePerQuintal, k: 'pricePerQuintal' as const },
                  { l: hi ? 'हम्माली ₹' : 'Handling', v: r.handlingFee, k: 'handlingFee' as const },
                  { l: hi ? 'कमीशन %' : 'Comm. %', v: r.commissionPct, k: 'commissionPct' as const },
                ].map((f) => (
                  <label key={f.k} className="text-[10px] text-soil-700/80">
                    {f.l}
                    <input type="number" value={f.v} onChange={(e) => update(i, { [f.k]: Number(e.target.value) } as Partial<Row>)}
                           className="mt-0.5 w-full rounded-md border border-leaf-50 px-1.5 py-1 text-xs outline-none focus:border-leaf-500" />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button onClick={() => setRows([...rows, { ...EMPTY, name: '' }])}
                  className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-leaf-300 py-2 text-xs font-semibold text-leaf-700 hover:bg-leaf-50">
            <Plus size={14} /> {hi ? 'और मंडी जोड़ें' : 'Add another mandi'}
          </button>
        </div>

        <button onClick={calculate} disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-harvest-500 py-3 text-sm font-bold text-white transition hover:bg-harvest-600 disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <IndianRupee size={16} />}
          {hi ? 'असली कमाई निकालें' : 'Calculate net earnings'}
        </button>

        {error && <p className="rounded-lg bg-alert-400/10 p-3 text-sm text-alert-600">{error}</p>}

        {result && (
          <div className="space-y-3">
            <div className="rounded-xl bg-leaf-600 p-3 text-white">
              <p className="text-[11px] opacity-80">{hi ? 'सबसे ज़्यादा फ़ायदा' : 'Highest net realisation'}</p>
              <p className="text-lg font-bold">{result.best.name}</p>
              <p className="text-sm">
                {inr(result.best.netProfit)} · {inr(result.best.netPerQuintal)}/{hi ? 'क्विं.' : 'qtl'} · {result.best.distanceKm.toFixed(0)} km
              </p>
              {result.localBaseline && (
                <p className="mt-1.5 rounded-lg bg-white/15 px-2 py-1 text-xs">
                  {result.localBaseline.travelRecommended
                    ? hi
                      ? `गाँव में बेचने से ${inr(result.localBaseline.upliftIfTravel)} ज़्यादा मिलेगा — जाना फ़ायदेमंद है।`
                      : `You earn ${inr(result.localBaseline.upliftIfTravel)} more than the local offer — the trip is worth it.`
                    : hi
                      ? 'गाँव में ही बेचना बेहतर है — ढुलाई फ़ायदा खा जाएगी।'
                      : 'Selling locally is better — transport eats the gain.'}
                </p>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-soil-50 text-[10px] uppercase text-soil-700">
                  <tr>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">{hi ? 'मंडी' : 'Mandi'}</th>
                    <th className="px-2 py-2 text-right">{hi ? 'कुल आय' : 'Gross'}</th>
                    <th className="px-2 py-2 text-right">{hi ? 'खर्च' : 'Costs'}</th>
                    <th className="px-2 py-2 text-right">{hi ? 'असली कमाई' : 'Net'}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.id} className={`border-b border-soil-50 ${r.rank === 1 ? 'bg-leaf-50' : ''}`}>
                      <td className="px-2 py-2 font-semibold text-soil-700">{r.rank}</td>
                      <td className="px-2 py-2">
                        <p className="font-semibold text-soil-900">{r.name}</p>
                        <p className="text-[10px] text-soil-700/70">
                          {r.distanceKm.toFixed(0)} km · ₹{r.pricePerQuintal}/{hi ? 'क्विं.' : 'qtl'}
                          {r.trips > 1 && ` · ${r.trips} ${hi ? 'फेरे' : 'trips'}`}
                        </p>
                      </td>
                      <td className="px-2 py-2 text-right text-soil-700">{inr(r.grossRevenue)}</td>
                      <td className="px-2 py-2 text-right text-alert-600">−{inr(r.totalDeductions)}</td>
                      <td className={`px-2 py-2 text-right font-bold ${r.viable ? 'text-leaf-700' : 'text-alert-600'}`}>
                        {inr(r.netProfit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] leading-relaxed text-soil-700">
              {hi
                ? `हिसाब में ${result.assumptions.kmpl} km/l माइलेज, ₹${result.assumptions.fuelPricePerLitre}/लीटर डीज़ल और आने-जाने दोनों तरफ़ की दूरी जोड़ी गई है।`
                : `Calculated at ${result.assumptions.kmpl} km/l and ₹${result.assumptions.fuelPricePerLitre}/litre, counting the return leg of every trip.`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}