'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Leaf, ArrowRight, ArrowLeft, Crosshair, Check, Languages } from 'lucide-react';
import { makeT, Locale } from '@/lib/i18n';
import { polygonAreaHectares, polygonCentroid, isPlausibleField, LatLon } from '@/lib/geo';
import 'leaflet/dist/leaflet.css';

const MapContainer = dynamic(() => import('react-leaflet').then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((m) => m.TileLayer), { ssr: false });
const Polygon = dynamic(() => import('react-leaflet').then((m) => m.Polygon), { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then((m) => m.CircleMarker), { ssr: false });

const ClickCapture = dynamic(
  async () => {
    const { useMapEvents } = await import('react-leaflet');
    return function Capture({ onClick }: { onClick: (lat: number, lon: number) => void }) {
      useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
      return null;
    };
  },
  { ssr: false },
);

const Recenter = dynamic(
  async () => {
    const { useMap } = await import('react-leaflet');
    return function R({ lat, lon }: { lat: number; lon: number }) {
      const map = useMap();
      useEffect(() => { map.setView([lat, lon], 16); }, [lat, lon, map]);
      return null;
    };
  },
  { ssr: false },
);

const CROPS = [
  { key: 'Wheat', hi: 'गेहूँ', emoji: '🌾' },
  { key: 'Rice', hi: 'धान', emoji: '🌾' },
  { key: 'Maize', hi: 'मक्का', emoji: '🌽' },
  { key: 'Sugarcane', hi: 'गन्ना', emoji: '🎋' },
  { key: 'Cotton', hi: 'कपास', emoji: '☁️' },
  { key: 'Mustard', hi: 'सरसों', emoji: '🌻' },
  { key: 'Potato', hi: 'आलू', emoji: '🥔' },
  { key: 'Soybean', hi: 'सोयाबीन', emoji: '🫘' },
];

export interface OnboardingResult {
  name: string;
  boundary: LatLon[];
  lat: number;
  lon: number;
  areaHa: number;
  crop: string;
  language: Locale;
}

interface Props {
  initial?: Partial<OnboardingResult>;
  onComplete: (r: OnboardingResult) => void;
  onCancel?: () => void;
}

export default function OnboardingFlow({ initial, onComplete, onCancel }: Props) {
  const [language, setLanguage] = useState<Locale>(initial?.language ?? 'hi');
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial?.name ?? '');
  const [boundary, setBoundary] = useState<LatLon[]>(initial?.boundary ?? []);
  const [crop, setCrop] = useState(initial?.crop ?? '');
  const [centre, setCentre] = useState<LatLon>({
    lat: initial?.lat ?? Number(process.env.NEXT_PUBLIC_DEFAULT_LAT ?? 26.8467),
    lon: initial?.lon ?? Number(process.env.NEXT_PUBLIC_DEFAULT_LON ?? 80.9462),
  });
  const [locating, setLocating] = useState(false);

  const t = makeT(language);
  const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  const areaHa = useMemo(() => polygonAreaHectares(boundary), [boundary]);
  const valid = isPlausibleField(boundary);

  // Offer the device location on first entry to the map step.
  useEffect(() => {
    if (step !== 1 || boundary.length > 0 || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setCentre({ lat: p.coords.latitude, lon: p.coords.longitude }); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, [step, boundary.length]);

  const locateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setCentre({ lat: p.coords.latitude, lon: p.coords.longitude }); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const finish = () => {
    const c = polygonCentroid(boundary) ?? centre;
    onComplete({
      name: name.trim(),
      boundary,
      lat: c.lat,
      lon: c.lon,
      areaHa: Number(areaHa.toFixed(3)),
      crop,
      language,
    });
  };

  const canAdvance = step === 0 ? name.trim().length >= 2 : step === 1 ? valid : crop.length > 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col bg-soil-50">
      {/* header */}
      <header className="flex items-center justify-between px-5 pb-3 pt-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-600 text-white">
            <Leaf size={18} />
          </div>
          <div>
            <p className="text-base font-bold leading-tight text-soil-900">{t('app.name')}</p>
            <p className="text-[11px] text-soil-700">{t('onb.step', { n: step + 1 })}</p>
          </div>
        </div>
        <button
          onClick={() => setLanguage(language === 'hi' ? 'en' : 'hi')}
          className="flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-leaf-700 shadow-card"
        >
          <Languages size={15} />
          {language === 'hi' ? 'हिं' : 'EN'}
        </button>
      </header>

      {/* progress */}
      <div className="flex gap-1.5 px-5 pb-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition ${i <= step ? 'bg-leaf-600' : 'bg-leaf-100'}`} />
        ))}
      </div>

      <div className="flex-1 px-5">
        {/* ── step 0: name ── */}
        {step === 0 && (
          <div className="animate-slideUp">
            <h2 className="text-xl font-bold text-soil-900">{t('onb.name.title')}</h2>
            <p className="mt-1 text-sm text-soil-700">{t('onb.name.sub')}</p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canAdvance && setStep(1)}
              placeholder={t('onb.name.ph')}
              className="mt-6 w-full rounded-2xl border-2 border-leaf-100 bg-white px-4 py-4 text-lg text-soil-900 outline-none focus:border-leaf-500"
            />
          </div>
        )}

        {/* ── step 1: map ── */}
        {step === 1 && (
          <div className="animate-slideUp">
            <h2 className="text-xl font-bold text-soil-900">{t('onb.map.title')}</h2>
            <p className="mt-1 text-sm text-soil-700">{t('onb.map.sub')}</p>

            <div className="mt-4 overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
              <div className="h-72 w-full">
                <MapContainer center={[centre.lat, centre.lon]} zoom={16} scrollWheelZoom className="h-full w-full">
                  <TileLayer url={tileUrl} attribution="&copy; OpenStreetMap contributors" />
                  <Recenter lat={centre.lat} lon={centre.lon} />
                  <ClickCapture onClick={(lat, lon) => setBoundary((b) => [...b, { lat, lon }])} />
                  {boundary.map((p, i) => (
                    <CircleMarker
                      key={`${p.lat}-${p.lon}-${i}`}
                      center={[p.lat, p.lon]}
                      radius={6}
                      pathOptions={{ color: '#fff', weight: 2, fillColor: '#1B7A43', fillOpacity: 1 }}
                    />
                  ))}
                  {boundary.length >= 3 && (
                    <Polygon
                      positions={boundary.map((p) => [p.lat, p.lon] as [number, number])}
                      pathOptions={{ color: '#1B7A43', fillOpacity: 0.25, weight: 2 }}
                    />
                  )}
                </MapContainer>
              </div>

              <div className="flex items-center justify-between px-3 py-2.5">
                <button
                  onClick={locateMe}
                  disabled={locating}
                  className="flex items-center gap-1.5 rounded-lg bg-soil-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <Crosshair size={13} className={locating ? 'animate-spin' : ''} />
                  {t('onb.map.locate')}
                </button>
                {boundary.length > 0 && (
                  <button onClick={() => setBoundary([])} className="text-xs font-semibold text-alert-600">
                    {t('onb.map.clear', { n: boundary.length })}
                  </button>
                )}
              </div>
            </div>

            <div className={`mt-4 rounded-2xl p-4 text-center ${valid ? 'bg-leaf-600 text-white' : 'bg-leaf-50 text-soil-700'}`}>
              {valid ? (
                <>
                  <p className="text-[11px] opacity-85">{t('onb.map.area', { area: '' }).replace(/:.*$/, '')}</p>
                  <p className="text-2xl font-bold">{areaHa.toFixed(2)} <span className="text-base font-medium">{t('common.hectares')}</span></p>
                  <p className="mt-0.5 text-[11px] opacity-85">{(areaHa * 2.4711).toFixed(2)} {t('common.acre')}</p>
                </>
              ) : (
                <p className="text-sm font-medium">{t('onb.map.need')}</p>
              )}
            </div>
          </div>
        )}

        {/* ── step 2: crop ── */}
        {step === 2 && (
          <div className="animate-slideUp">
            <h2 className="text-xl font-bold text-soil-900">{t('onb.crop.title')}</h2>
            <p className="mt-1 text-sm text-soil-700">{t('onb.crop.sub')}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {CROPS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setCrop(c.key)}
                  className={`flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition ${
                    crop === c.key
                      ? 'border-leaf-600 bg-leaf-50'
                      : 'border-transparent bg-white shadow-card hover:border-leaf-100'
                  }`}
                >
                  <span className="text-2xl">{c.emoji}</span>
                  <span className="flex-1 text-sm font-semibold text-soil-900">
                    {language === 'hi' ? c.hi : c.key}
                  </span>
                  {crop === c.key && <Check size={16} className="text-leaf-600" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* footer nav */}
      <div className="sticky bottom-0 mt-6 flex gap-3 border-t border-leaf-100 bg-white px-5 py-4">
        {step > 0 ? (
          <button
            onClick={() => setStep(step - 1)}
            className="flex items-center gap-1.5 rounded-xl border border-leaf-100 px-4 py-3 text-sm font-semibold text-soil-700"
          >
            <ArrowLeft size={16} /> {t('nav.back')}
          </button>
        ) : onCancel ? (
          <button onClick={onCancel} className="rounded-xl border border-leaf-100 px-4 py-3 text-sm font-semibold text-soil-700">
            {t('nav.back')}
          </button>
        ) : null}

        <button
          onClick={() => (step === 2 ? finish() : setStep(step + 1))}
          disabled={!canAdvance}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-leaf-600 py-3 text-sm font-bold text-white transition hover:bg-leaf-700 disabled:opacity-40"
        >
          {step === 2 ? t('onb.finish') : t('common.continue')}
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}