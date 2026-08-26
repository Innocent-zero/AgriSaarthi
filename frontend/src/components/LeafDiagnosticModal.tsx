'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Upload, X, Loader2, ShieldAlert, CheckCircle2,
  SwitchCamera, Circle, RotateCcw,
} from 'lucide-react';
import { api, Diagnosis, friendlyError } from '@/lib/api';
import { makeT, Locale } from '@/lib/i18n';

interface Props {
  crop: string;
  language: Locale;
  onClose?: () => void;
}

type Mode = 'idle' | 'camera' | 'preview';

const SEVERITY_STYLE: Record<string, string> = {
  none: 'bg-leaf-50 text-leaf-700 border-leaf-100',
  medium: 'bg-harvest-400/15 text-harvest-600 border-harvest-400/30',
  high: 'bg-alert-400/10 text-alert-600 border-alert-400/30',
};

export default function LeafDiagnosticModal({ crop, language, onClose }: Props) {
  const t = makeT(language);

  const [mode, setMode] = useState<Mode>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Blob | null>(null);
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCams, setHasMultipleCams] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const cameraSupported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  // ── stream lifecycle ──
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async (which: 'environment' | 'user' = facing) => {
    setCamError(null);
    setStarting(true);
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: which },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setMode('camera');

      // The <video> element only exists after mode flips, so attach next tick.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => { /* autoplay guard */ });
        }
      });

      // Only offer the flip control when there really are two cameras.
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setHasMultipleCams(devices.filter((d) => d.kind === 'videoinput').length > 1);
      } catch { /* enumeration is optional */ }
    } catch (err) {
      const name = (err as Error).name;
      setCamError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? t('dz.cameraDenied')
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? t('dz.noCamera')
            : t('dz.cameraFailed'),
      );
      setMode('idle');
    } finally {
      setStarting(false);
    }
  }, [facing, stopCamera, t]);

  const flipCamera = useCallback(() => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    void startCamera(next);
  }, [facing, startCamera]);

  // Release the camera and any object URL on unmount — otherwise the phone's
  // camera LED stays on after the user navigates away.
  useEffect(() => {
    return () => {
      stopCamera();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [stopCamera]);

  // ── image helpers ──
  const setPreviewFromBlob = useCallback((blob: Blob) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    setPreview(url);
    setCaptured(blob);
  }, []);

  /** Centre-crop to a square and downscale — matches how the SVM was trained. */
  const normalise = useCallback(
    async (source: CanvasImageSource, w: number, h: number): Promise<Blob> => {
      const side = Math.min(w, h);
      const sx = (w - side) / 2;
      const sy = (h - side) / 2;
      const target = 720;

      const canvas = document.createElement('canvas');
      canvas.width = target;
      canvas.height = target;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(source, sx, sy, side, side, 0, 0, target, target);

      return new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Encode failed'))),
          'image/jpeg',
          0.85,
        ),
      );
    },
    [],
  );

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    try {
      const blob = await normalise(video, video.videoWidth, video.videoHeight);
      setPreviewFromBlob(blob);
      stopCamera();
      setMode('preview');
      setResult(null);
      setNote(null);
      setError(null);
    } catch (e) {
      setCamError(friendlyError(e));
    }
  }, [normalise, setPreviewFromBlob, stopCamera]);

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setNote(null);
    try {
      const bitmap = await createImageBitmap(file);
      const blob = await normalise(bitmap, bitmap.width, bitmap.height);
      bitmap.close?.();
      setPreviewFromBlob(blob);
    } catch {
      setPreviewFromBlob(file); // fall back to the raw file
    }
    setMode('preview');
  }, [normalise, setPreviewFromBlob]);

  const diagnose = useCallback(async () => {
    if (!captured) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.diagnose(captured, crop, language);
      setResult(data.diagnosis);
      setNote(data.note ?? null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, [captured, crop, language]);

  const reset = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview(null);
    setCaptured(null);
    setResult(null);
    setNote(null);
    setError(null);
    setMode('idle');
  }, []);

  return (
    <div className="animate-slideUp overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex items-center justify-between bg-soil-900 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera size={18} />
          <h3 className="text-sm font-semibold">{t('dz.title')}</h3>
        </div>
        {onClose && (
          <button
            onClick={() => { stopCamera(); onClose(); }}
            aria-label="Close"
            className="rounded-lg p-1 hover:bg-white/10"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="p-4">
        {/* ── idle ── */}
        {mode === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-soil-700">{t('dz.instruction')}</p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => (cameraSupported ? startCamera() : fileRef.current?.click())}
                disabled={starting}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-leaf-300 bg-leaf-50 p-6 text-leaf-700 transition hover:bg-leaf-100 disabled:opacity-50"
              >
                {starting
                  ? <Loader2 size={26} className="animate-spin" />
                  : <Camera size={26} />}
                <span className="text-sm font-semibold">
                  {starting ? t('dz.cameraStarting') : t('dz.openCamera')}
                </span>
              </button>

              <button
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-soil-100 bg-soil-50 p-6 text-soil-700 transition hover:bg-soil-100"
              >
                <Upload size={26} />
                <span className="text-sm font-semibold">{t('dz.gallery')}</span>
              </button>
            </div>

            {camError && (
              <p className="rounded-xl bg-harvest-400/12 p-3 text-xs text-harvest-600">{camError}</p>
            )}
            <p className="text-[11px] leading-relaxed text-soil-700/70">{t('dz.tip')}</p>
          </div>
        )}

        {/* ── live camera ── */}
        {mode === 'camera' && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="h-72 w-full object-cover"
              />
              {/* Square framing guide — matches the centre crop applied on capture. */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="aspect-square h-[85%] rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]" />
              </div>
              <p className="absolute inset-x-0 bottom-2 text-center text-[11px] font-medium text-white drop-shadow">
                {t('dz.frameHint')}
              </p>
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => { stopCamera(); setMode('idle'); }}
                className="rounded-xl border border-leaf-100 px-4 py-2.5 text-sm font-semibold text-soil-700"
              >
                {t('dz.cancel')}
              </button>

              <button
                onClick={capture}
                aria-label={t('dz.capture')}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-leaf-600 text-white shadow-card transition active:scale-95"
              >
                <Circle size={30} strokeWidth={2.5} />
              </button>

              {hasMultipleCams ? (
                <button
                  onClick={flipCamera}
                  aria-label={t('dz.switchCamera')}
                  className="rounded-xl border border-leaf-100 p-2.5 text-soil-700"
                >
                  <SwitchCamera size={18} />
                </button>
              ) : (
                <span className="w-[42px]" />
              )}
            </div>
          </div>
        )}

        {/* ── preview + result ── */}
        {mode === 'preview' && preview && (
          <div className="space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Leaf sample" className="max-h-64 w-full rounded-xl object-cover" />

            {!result && !busy && (
              <div className="flex gap-3">
                <button
                  onClick={() => (cameraSupported ? startCamera() : reset())}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-leaf-100 px-4 py-3 text-sm font-semibold text-soil-700"
                >
                  <RotateCcw size={15} /> {t('dz.retake')}
                </button>
                <button
                  onClick={diagnose}
                  className="flex-1 rounded-xl bg-leaf-600 py-3 text-sm font-bold text-white transition hover:bg-leaf-700"
                >
                  {t('dz.usePhoto')}
                </button>
              </div>
            )}

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
                    <p className="text-sm font-bold text-soil-900">
                      ₹{result.est_cost_inr_per_acre}/{t('common.acre')}
                    </p>
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

                <button
                  onClick={reset}
                  className="w-full rounded-xl border border-leaf-100 py-2.5 text-sm font-semibold text-leaf-700 transition hover:bg-leaf-50"
                >
                  {t('dz.another')}
                </button>
              </div>
            )}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}