'use client';

import { useCallback, useEffect, useState } from 'react';
import { Leaf, Settings2, WifiOff, Wifi, X } from 'lucide-react';
import VoiceSearchBar from '@/app/api/components/VoiceSearchBar';
import HybridCopilotChat from '@/app/api/components/HybridCopilotChat';
import SatelliteFieldMap from '@/app/api/components/SatelliteFieldMap';
import { loadProfile, saveProfile, FarmProfile } from '@/lib/idb';
import { api, getToken } from '@/lib/api';

const CROPS = ['Wheat', 'Rice', 'Maize', 'Cotton', 'Sugarcane', 'Mustard', 'Potato', 'Soybean'];

const DEFAULT_PROFILE: FarmProfile = {
  id: 'default',
  name: '',
  lat: Number(process.env.NEXT_PUBLIC_DEFAULT_LAT ?? 26.8467),
  lon: Number(process.env.NEXT_PUBLIC_DEFAULT_LON ?? 80.9462),
  crop: 'Wheat',
  areaHa: 1,
  language: 'hi',
  updatedAt: 0,
};

export default function Home() {
  const [profile, setProfile] = useState<FarmProfile>(DEFAULT_PROFILE);
  const [boundary, setBoundary] = useState<Array<{ lat: number; lon: number }>>([]);
  const [pending, setPending] = useState<{ text: string; nonce: number } | null>(null);
  const [lastReply, setLastReply] = useState('');
  const [online, setOnline] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const hi = profile.language === 'hi';

  useEffect(() => {
    (async () => {
      const stored = await loadProfile('default');
      if (stored) setProfile(stored);
      else setShowSettings(true);
      setHydrated(true);

      if (!getToken()) {
        // Anonymous session — advisory endpoints accept optionalAuth.
        try { await api.requestToken('9000000000', stored?.name, stored?.district, stored?.language ?? 'hi'); }
        catch { /* offline is fine */ }
      }
    })();

    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const update = useCallback((patch: Partial<FarmProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      void saveProfile(next);
      return next;
    });
  }, []);

  const ask = useCallback((text: string) => {
    setPending({ text, nonce: Date.now() });
  }, []);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Leaf size={30} className="animate-pulse text-leaf-600" />
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-leaf-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-600 text-white">
              <Leaf size={18} />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight text-soil-900">AgriSaarthi</h1>
              <p className="text-[11px] text-soil-700">
                {profile.name ? `${profile.name} · ` : ''}{profile.crop} · {profile.areaHa} ha
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${
              online ? 'bg-leaf-50 text-leaf-700' : 'bg-harvest-400/15 text-harvest-600'}`}>
              {online ? <Wifi size={11} /> : <WifiOff size={11} />}
              {online ? (hi ? 'ऑनलाइन' : 'Online') : (hi ? 'ऑफ़लाइन' : 'Offline')}
            </span>
            <button onClick={() => setShowSettings(true)}
                    className="rounded-lg p-2 text-soil-700 hover:bg-soil-50" aria-label="Settings">
              <Settings2 size={17} />
            </button>
          </div>
        </div>
      </header>

      {/* Map */}
      <section className="px-4 pt-4">
        <SatelliteFieldMap
          lat={profile.lat}
          lon={profile.lon}
          language={profile.language}
          boundary={boundary}
          onSelect={(lat, lon) => update({ lat, lon })}
          onBoundaryChange={setBoundary}
        />
      </section>

      {/* Chat */}
      <section className="flex-1 px-4 py-4">
        <HybridCopilotChat
          farm={{
            lat: profile.lat,
            lon: profile.lon,
            crop: profile.crop,
            areaHa: profile.areaHa,
            state: profile.state,
            district: profile.district,
            farmerName: profile.name,
            language: profile.language,
            boundary,
          }}
          pendingMessage={pending}
          onReply={setLastReply}
        />
      </section>

      {/* Voice bar */}
      <div className="sticky bottom-0 border-t border-leaf-100 bg-white/95 px-4 py-3 backdrop-blur">
        <VoiceSearchBar
          language={profile.language}
          onLanguageChange={(language) => update({ language })}
          onSubmit={ask}
          lastReply={lastReply}
        />
      </div>

      {/* Settings sheet */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45" onClick={() => setShowSettings(false)}>
          <div className="max-h-[85vh] w-full animate-slideUp overflow-y-auto rounded-t-3xl bg-white p-5"
               onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-soil-900">{hi ? 'मेरी जानकारी' : 'My details'}</h2>
              <button onClick={() => setShowSettings(false)} className="rounded-lg p-1.5 hover:bg-soil-50" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium text-soil-700">
                {hi ? 'नाम' : 'Name'}
                <input value={profile.name} onChange={(e) => update({ name: e.target.value })}
                       className="mt-1 w-full rounded-lg border border-leaf-100 px-3 py-2.5 text-sm outline-none focus:border-leaf-500" />
              </label>

              <label className="block text-xs font-medium text-soil-700">
                {hi ? 'फ़सल' : 'Crop'}
                <select value={profile.crop} onChange={(e) => update({ crop: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-leaf-100 px-3 py-2.5 text-sm outline-none focus:border-leaf-500">
                  {CROPS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>

              <label className="block text-xs font-medium text-soil-700">
                {hi ? 'रकबा (हेक्टेयर)' : 'Area (hectares)'}
                <input type="number" step={0.1} min={0.1} value={profile.areaHa}
                       onChange={(e) => update({ areaHa: Number(e.target.value) })}
                       className="mt-1 w-full rounded-lg border border-leaf-100 px-3 py-2.5 text-sm outline-none focus:border-leaf-500" />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-soil-700">
                  {hi ? 'राज्य' : 'State'}
                  <input value={profile.state ?? ''} onChange={(e) => update({ state: e.target.value })}
                         className="mt-1 w-full rounded-lg border border-leaf-100 px-3 py-2.5 text-sm outline-none focus:border-leaf-500" />
                </label>
                <label className="text-xs font-medium text-soil-700">
                  {hi ? 'ज़िला' : 'District'}
                  <input value={profile.district ?? ''} onChange={(e) => update({ district: e.target.value })}
                         className="mt-1 w-full rounded-lg border border-leaf-100 px-3 py-2.5 text-sm outline-none focus:border-leaf-500" />
                </label>
              </div>

              <button onClick={() => setShowSettings(false)}
                      className="mt-2 w-full rounded-xl bg-leaf-600 py-3 text-sm font-bold text-white hover:bg-leaf-700">
                {hi ? 'सेव करें' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}