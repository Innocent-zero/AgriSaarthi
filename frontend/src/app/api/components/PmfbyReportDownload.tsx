'use client';

import { useState } from 'react';
import { FileText, Download, Loader2, Satellite } from 'lucide-react';
import { api, friendlyError } from '@/lib/api';

interface Props {
  lat: number;
  lon: number;
  crop: string;
  areaHa: number;
  farmerName: string;
  language: 'hi' | 'en';
  boundary?: Array<{ lat: number; lon: number }>;
  defaultCause?: string;
}

const CAUSES_HI = ['बाढ़ / जलभराव', 'सूखा', 'ओलावृष्टि', 'तेज़ हवा / तूफ़ान', 'कीट प्रकोप', 'बीमारी', 'बेमौसम बारिश'];
const CAUSES_EN = ['Flood / waterlogging', 'Drought', 'Hailstorm', 'High wind / cyclone', 'Pest attack', 'Disease outbreak', 'Unseasonal rain'];

export default function PmfbyReportDownload({
  lat, lon, crop, areaHa, farmerName, language, boundary = [], defaultCause,
}: Props) {
  const hi = language === 'hi';
  const causes = hi ? CAUSES_HI : CAUSES_EN;

  const [cause, setCause] = useState(defaultCause || causes[0]);
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [affected, setAffected] = useState(areaHa);
  const [preNdvi, setPreNdvi] = useState(0.68);
  const [postNdvi, setPostNdvi] = useState(0.34);
  const [description, setDescription] = useState('');
  const [policyNo, setPolicyNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const lossPct = preNdvi > 0 ? Math.max(0, ((preNdvi - postNdvi) / preNdvi) * 100) : 0;

  async function generate() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const today = new Date();
      const pre = new Date(today.getTime() - 20 * 86400000).toISOString().slice(0, 10);
      const blob = await api.pmfbyReport({
        farmer: {
          name: farmerName || (hi ? 'किसान' : 'Farmer'),
          policy_no: policyNo || undefined,
        },
        farm: {
          crop,
          area_ha: areaHa,
          lat,
          lon,
          boundary: boundary.map((p) => ({ lat: p.lat, lon: p.lon })),
        },
        ndvi: {
          pre_event_date: pre,
          pre_event_mean: preNdvi,
          post_event_date: eventDate,
          post_event_mean: postNdvi,
        },
        weather_anomalies: [],
        cause,
        event_date: eventDate,
        description: description || undefined,
        affected_area_ha: affected,
        estimated_loss_pct: Number(lossPct.toFixed(1)),
        reported_within_72h: true,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PMFBY_Claim_${eventDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center gap-2 bg-soil-700 px-4 py-3 text-white">
        <FileText size={18} />
        <h3 className="text-sm font-semibold">{hi ? 'PMFBY नुकसान दावा' : 'PMFBY Loss Claim'}</h3>
      </div>

      <div className="space-y-3 p-4">
        <label className="block text-xs font-medium text-soil-700">
          {hi ? 'नुकसान का कारण' : 'Cause of loss'}
          <select value={cause} onChange={(e) => setCause(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-leaf-100 px-2.5 py-2 text-sm outline-none focus:border-leaf-500">
            {causes.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-soil-700">
            {hi ? 'नुकसान की तारीख़' : 'Date of loss'}
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)}
                   className="mt-1 w-full rounded-lg border border-leaf-100 px-2.5 py-2 text-sm outline-none focus:border-leaf-500" />
          </label>
          <label className="text-xs font-medium text-soil-700">
            {hi ? 'प्रभावित रकबा (ha)' : 'Affected area (ha)'}
            <input type="number" step={0.1} min={0} value={affected} onChange={(e) => setAffected(Number(e.target.value))}
                   className="mt-1 w-full rounded-lg border border-leaf-100 px-2.5 py-2 text-sm outline-none focus:border-leaf-500" />
          </label>
        </div>

        <label className="block text-xs font-medium text-soil-700">
          {hi ? 'पॉलिसी / आवेदन नंबर (वैकल्पिक)' : 'Policy / application no. (optional)'}
          <input value={policyNo} onChange={(e) => setPolicyNo(e.target.value)}
                 className="mt-1 w-full rounded-lg border border-leaf-100 px-2.5 py-2 text-sm outline-none focus:border-leaf-500" />
        </label>

        <div className="rounded-xl bg-leaf-50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-leaf-700">
            <Satellite size={13} /> {hi ? 'सैटेलाइट NDVI प्रमाण' : 'Satellite NDVI evidence'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { l: hi ? 'घटना से पहले' : 'Pre-event', v: preNdvi, s: setPreNdvi },
              { l: hi ? 'घटना के बाद' : 'Post-event', v: postNdvi, s: setPostNdvi },
            ].map((f) => (
              <label key={f.l} className="text-[11px] text-soil-700">
                {f.l}
                <input type="number" step={0.01} min={0} max={1} value={f.v}
                       onChange={(e) => f.s(Number(e.target.value))}
                       className="mt-1 w-full rounded-lg border border-leaf-100 px-2 py-1.5 text-sm outline-none focus:border-leaf-500" />
              </label>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between rounded-lg bg-white px-3 py-2">
            <span className="text-xs text-soil-700">{hi ? 'अनुमानित नुकसान' : 'Estimated loss'}</span>
            <span className={`text-base font-bold ${lossPct >= 33 ? 'text-alert-600' : 'text-harvest-600'}`}>
              {lossPct.toFixed(1)}%
            </span>
          </div>
          {lossPct >= 33 && (
            <p className="mt-1.5 text-[11px] text-alert-600">
              {hi ? '33% से ऊपर — PMFBY क्षतिपूर्ति सीमा पार, तुरंत सर्वे माँगें।' : 'Above the 33% PMFBY threshold — request a survey immediately.'}
            </p>
          )}
        </div>

        <label className="block text-xs font-medium text-soil-700">
          {hi ? 'आपका विवरण' : 'Your description'}
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder={hi ? 'क्या हुआ, संक्षेप में लिखें…' : 'Briefly describe what happened…'}
                    className="mt-1 w-full resize-none rounded-lg border border-leaf-100 px-2.5 py-2 text-sm outline-none focus:border-leaf-500" />
        </label>

        <button onClick={generate} disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-soil-900 py-3 text-sm font-bold text-white transition hover:bg-black disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {hi ? 'दावा पासबुक डाउनलोड करें' : 'Download claim passbook'}
        </button>

        {done && (
          <p className="rounded-lg bg-leaf-50 p-3 text-xs text-leaf-700">
            {hi
              ? 'पासबुक बन गई। इसे बीमा कंपनी या कृषि अधिकारी को दें — 72 घंटे के भीतर सूचना देना ज़रूरी है।'
              : 'Passbook generated. Hand it to your insurer or agriculture officer — intimation within 72 hours is mandatory.'}
          </p>
        )}
        {error && <p className="rounded-lg bg-alert-400/10 p-3 text-xs text-alert-600">{error}</p>}
      </div>
    </div>
  );
}