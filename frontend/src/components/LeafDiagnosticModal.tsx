'use client';

import { useRef, useState } from 'react';
import { Camera, Upload, X, Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { api, Diagnosis, friendlyError } from '@/lib/api';

interface Props {
  crop: string;
  language: 'hi' | 'en';
  onClose?: () => void;
}

const SEVERITY_STYLE: Record<string, string> = {
  none: 'bg-leaf-50 text-leaf-700 border-leaf-100',
  medium: 'bg-harvest-400/15 text-harvest-600 border-harvest-400/30',
  high: 'bg-alert-400/10 text-alert-600 border-alert-400/30',
};

export default function LeafDiagnosticModal({ crop, language, onClose }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hi = language === 'hi';

  /** Downscale on-device before upload — critical on 2G. */
  async function compress(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    const maxDim = 720;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.82),
    );
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setNote(null);
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const blob = await compress(file);
      const data = await api.diagnose(blob, crop, language);
      setResult(data.diagnosis);
      setNote(data.note ?? null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center justify-between bg-soil-900 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera size={18} />
          <h3 className="text-sm font-semibold">{hi ? 'पत्ती रोग जाँच' : 'Leaf Disease Diagnosis'}</h3>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-white/10">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="p-4">
        {!preview && (
          <div className="space-y-3">
            <p className="text-sm text-soil-700">
              {hi
                ? 'एक ही पत्ती की साफ़ फोटो लें — दिन की रोशनी में, पत्ती पूरी दिखे।'
                : 'Photograph a single leaf in daylight, filling most of the frame.'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => cameraRef.current?.click()}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-leaf-300 bg-leaf-50 p-6 text-leaf-700 transition hover:bg-leaf-100"
              >
                <Camera size={26} />
                <span className="text-sm font-semibold">{hi ? 'कैमरा' : 'Camera'}</span>
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-soil-100 bg-soil-50 p-6 text-soil-700 transition hover:bg-soil-100"
              >
                <Upload size={26} />
                <span className="text-sm font-semibold">{hi ? 'गैलरी' : 'Gallery'}</span>
              </button>
            </div>
          </div>
        )}

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
               onChange={(e) => handleFile(e.target.files?.[0])} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
               onChange={(e) => handleFile(e.target.files?.[0])} />

        {preview && (
          <div className="space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Leaf sample" className="max-h-56 w-full rounded-xl object-cover" />

            {busy && (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-leaf-50 py-4 text-sm text-leaf-700">
                <Loader2 size={16} className="animate-spin" />
                {hi ? 'जाँच हो रही है…' : 'Analysing…'}
              </div>
            )}

            {error && <p className="rounded-xl bg-alert-400/10 p-3 text-sm text-alert-600">{error}</p>}

            {result && (
              <div className="space-y-3">
                <div className={`rounded-xl border p-3 ${SEVERITY_STYLE[result.severity] ?? SEVERITY_STYLE.medium}`}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-base font-bold">
                      {result.severity === 'none' ? <CheckCircle2 size={17} /> : <ShieldAlert size={17} />}
                      {result.display_name}
                    </span>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold">
                      {(result.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed">{result.advice}</p>
                </div>

                {note && <p className="text-xs text-harvest-600">{note}</p>}

                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-soil-50 p-2">
                    <p className="text-[10px] uppercase text-soil-700/70">{hi ? 'प्रभावित क्षेत्र' : 'Affected area'}</p>
                    <p className="text-sm font-bold text-soil-900">{result.lesion_coverage_pct.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg bg-soil-50 p-2">
                    <p className="text-[10px] uppercase text-soil-700/70">{hi ? 'इलाज लागत' : 'Treatment cost'}</p>
                    <p className="text-sm font-bold text-soil-900">₹{result.est_cost_inr_per_acre}/{hi ? 'एकड़' : 'acre'}</p>
                  </div>
                </div>

                {result.treatment.length > 0 && (
                  <div className="rounded-xl bg-leaf-50 p-3">
                    <p className="mb-1.5 text-xs font-semibold text-leaf-700">{hi ? 'क्या करें' : 'What to do'}</p>
                    <ul className="space-y-1">
                      {result.treatment.map((t) => (
                        <li key={t} className="flex gap-2 text-xs text-soil-900">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-leaf-600" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => { setPreview(null); setResult(null); setNote(null); }}
                  className="w-full rounded-xl border border-leaf-100 py-2.5 text-sm font-semibold text-leaf-700 transition hover:bg-leaf-50"
                >
                  {hi ? 'दूसरी पत्ती जाँचें' : 'Check another leaf'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}