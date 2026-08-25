'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, X, Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { api, Diagnosis, friendlyError } from '@/lib/api';
import { makeT, Locale } from '@/lib/i18n';

interface Props {
  crop: string;
  language: Locale;
  onClose?: () => void;
}

const SEVERITY_STYLE: Record<string, string> = {
  none: 'bg-leaf-50 text-leaf-700 border-leaf-100',
  medium: 'bg-harvest-400/15 text-harvest-600 border-harvest-400/30',
  high: 'bg-alert-400/10 text-alert-600 border-alert-400/30',
};

// New camera-related strings live here directly — no i18n.ts change needed.
const CAMERA_STRINGS: Record<Locale, { capture: string; cancel: string; cameraDenied: string }> = {
  en: {
    capture: 'Capture photo',
    cancel: 'Cancel',
    cameraDenied: "Couldn't access the camera. Check your browser's camera permission, or use Gallery instead.",
  },
  hi: {
    capture: 'फ़ोटो लें',
    cancel: 'रद्द करें',
    cameraDenied: 'कैमरा एक्सेस नहीं हो पाया। ब्राउज़र की कैमरा अनुमति जाँचें, या गैलरी का उपयोग करें।',
  },
};

export default function LeafDiagnosticModal({ crop, language, onClose }: Props) {
  const t = makeT(language);
  const cs = CAMERA_STRINGS[language] ?? CAMERA_STRINGS.en;

  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── live camera state ──
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null); // last-resort fallback only
  const fileRef = useRef<HTMLInputElement>(null);

  // Attach the stream to the <video> once it's mounted (it only mounts when cameraOpen is true).
  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {
        /* autoplay can reject on some browsers until user gesture settles; harmless */
      });
    }
  }, [cameraOpen]);

  // Always release the camera if the component unmounts while the stream is open.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function openCamera() {
    setCameraError(null);
    setError(null);
    setResult(null);
    setNote(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // Very old / unsupported browser — fall back to the OS file picker as a last resort.
      cameraInputRef.current?.click();
      return;
    }

    try {
      // Prefer the rear camera on phones.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (err) {
      // Some devices reject a facingMode constraint outright — retry with any camera.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        setCameraOpen(true);
      } catch (err2) {
        console.error(err2);
        setCameraError(cs.cameraDenied);
      }
    }
  }

  function closeCamera() {
    stopStream();
    setCameraOpen(false);
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `leaf-${Date.now()}.jpg`, { type: 'image/jpeg' });
        closeCamera();
        handleFile(file);
      },
      'image/jpeg',
      0.9,
    );
  }

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
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.82));
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

  function handleModalClose() {
    stopStream();
    onClose?.();
  }

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center justify-between bg-soil-900 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera size={18} />
          <h3 className="text-sm font-semibold">{t('dz.title')}</h3>
        </div>
        {onClose && (
          <button onClick={handleModalClose} aria-label="Close" className="rounded-lg p-1 hover:bg-white/10">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="p-4">
        {!preview && !cameraOpen && (
          <div className="space-y-3">
            <p className="text-sm text-soil-700">{t('dz.instruction')}</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={openCamera}
                      className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-leaf-300 bg-leaf-50 p-6 text-leaf-700 transition hover:bg-leaf-100">
                <Camera size={26} />
                <span className="text-sm font-semibold">{t('dz.camera')}</span>
              </button>
              <button onClick={() => fileRef.current?.click()}
                      className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-soil-100 bg-soil-50 p-6 text-soil-700 transition hover:bg-soil-100">
                <Upload size={26} />
                <span className="text-sm font-semibold">{t('dz.gallery')}</span>
              </button>
            </div>
            {cameraError && (
              <p className="rounded-xl bg-alert-400/10 p-3 text-sm text-alert-600">{cameraError}</p>
            )}
          </div>
        )}

        {cameraOpen && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="max-h-72 w-full object-cover"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={closeCamera}
                      className="rounded-xl border border-soil-100 py-2.5 text-sm font-semibold text-soil-700 transition hover:bg-soil-50">
                {cs.cancel}
              </button>
              <button onClick={capturePhoto}
                      className="flex items-center justify-center gap-2 rounded-xl bg-leaf-600 py-2.5 text-sm font-semibold text-white transition hover:bg-leaf-700">
                <Camera size={16} />
                {cs.capture}
              </button>
            </div>
          </div>
        )}

        {/* Hidden canvas used only to grab a frame from the live video */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Fallback input — only used if getUserMedia isn't supported at all */}
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
               onChange={(e) => handleFile(e.target.files?.[0])} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
               onChange={(e) => handleFile(e.target.files?.[0])} />

        {preview && (
          <div className="space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Leaf sample" className="max-h-56 w-full rounded-xl object-cover" />

            {busy && (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-leaf-50 py-4 text-sm text-leaf-700">
                <Loader2 size={16} className="animate-spin" /> {t('dz.analysing')}
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
                    <p className="text-[10px] uppercase text-soil-700/70">{t('dz.affected')}</p>
                    <p className="text-sm font-bold text-soil-900">{result.lesion_coverage_pct.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg bg-soil-50 p-2">
                    <p className="text-[10px] uppercase text-soil-700/70">{t('dz.cost')}</p>
                    <p className="text-sm font-bold text-soil-900">₹{result.est_cost_inr_per_acre}/{t('common.acre')}</p>
                  </div>
                </div>

                {result.treatment.length > 0 && (
                  <div className="rounded-xl bg-leaf-50 p-3">
                    <p className="mb-1.5 text-xs font-semibold text-leaf-700">{t('dz.whatToDo')}</p>
                    <ul className="space-y-1">
                      {result.treatment.map((tr) => (
                        <li key={tr} className="flex gap-2 text-xs text-soil-900">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-leaf-600" />
                          {tr}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button onClick={() => { setPreview(null); setResult(null); setNote(null); }}
                        className="w-full rounded-xl border border-leaf-100 py-2.5 text-sm font-semibold text-leaf-700 transition hover:bg-leaf-50">
                  {t('dz.another')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}