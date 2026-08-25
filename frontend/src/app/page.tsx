'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Leaf } from 'lucide-react';
import OnboardingFlow, { OnboardingResult } from '@/components/OnboardingFlow';
import HubMenu, { ViewKey } from '@/components/HubMenu';
import HybridCopilotChat from '@/components/HybridCopilotChat';
import VoiceSearchBar from '@/components/VoiceSearchBar';
import NpkCalculatorWidget from '@/components/NpkCalculatorWidget';
import LeafDiagnosticModal from '@/components/LeafDiagnosticModal';
import MandiProfitWidget from '@/components/MandiProfitWidget';
import PmfbyReportDownload from '@/components/PmfbyReportDownload';
import FarmRiskWidget from '@/components/FarmRiskWidget';
import WeatherPanel from '@/components/WeatherPanel';
import { loadProfile, saveProfile, FarmProfile } from '@/lib/idb';
import { api, getToken } from '@/lib/api';
import { makeT, Locale } from '@/lib/i18n';
import { LatLon } from '@/lib/geo';

type Screen = 'boot' | 'onboarding' | 'hub' | ViewKey;

export default function Home() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [profile, setProfile] = useState<FarmProfile | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<{ text: string; nonce: number } | null>(null);
  const [lastReply, setLastReply] = useState('');

  const language = (profile?.language ?? 'hi') as Locale;
  const t = makeT(language);

  useEffect(() => {
    (async () => {
      const stored = await loadProfile('default');
      if (stored && stored.crop && stored.areaHa > 0) {
        setProfile(stored);
        setScreen('hub');
      } else {
        setScreen('onboarding');
      }
      if (!getToken()) {
        try { await api.requestToken('9000000000', stored?.name, stored?.district, stored?.language ?? 'hi'); }
        catch { /* offline is fine */ }
      }
    })();

    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const handleOnboarding = useCallback(async (r: OnboardingResult) => {
    const next: FarmProfile = {
      id: 'default',
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      crop: r.crop,
      areaHa: r.areaHa,
      language: r.language,
      boundary: r.boundary,
      updatedAt: Date.now(),
    };
    setProfile(next);
    await saveProfile(next);
    setScreen('hub');
  }, []);

  const setLanguage = useCallback(async (l: Locale) => {
    if (!profile) return;
    const next = { ...profile, language: l };
    setProfile(next);
    await saveProfile(next);
  }, [profile]);

  if (screen === 'boot') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Leaf size={30} className="animate-pulse text-leaf-600" />
      </div>
    );
  }

  if (screen === 'onboarding') {
    return (
      <OnboardingFlow
        initial={profile ? {
          name: profile.name, crop: profile.crop, language: profile.language as Locale,
          boundary: (profile.boundary as LatLon[]) ?? [], lat: profile.lat, lon: profile.lon,
        } : undefined}
        onComplete={handleOnboarding}
        onCancel={profile ? () => setScreen('hub') : undefined}
      />
    );
  }

  if (!profile) return null;

  if (screen === 'hub') {
    return (
      <HubMenu
        name={profile.name}
        crop={profile.crop}
        areaHa={profile.areaHa}
        language={language}
        online={online}
        onLanguageChange={setLanguage}
        onOpen={(v) => setScreen(v)}
        onEditFarm={() => setScreen('onboarding')}
      />
    );
  }

  const farm = {
    lat: profile.lat, lon: profile.lon, crop: profile.crop, areaHa: profile.areaHa,
    state: profile.state, district: profile.district, farmerName: profile.name,
    language, boundary: (profile.boundary as LatLon[]) ?? [],
  };

  const body = () => {
    switch (screen) {
      case 'weather': return <WeatherPanel lat={farm.lat} lon={farm.lon} language={language} />;
      case 'npk':     return <NpkCalculatorWidget lat={farm.lat} lon={farm.lon} crop={farm.crop} areaHa={farm.areaHa} language={language} />;
      case 'mandi':   return <MandiProfitWidget lat={farm.lat} lon={farm.lon} crop={farm.crop} language={language} />;
      case 'disease': return <LeafDiagnosticModal crop={farm.crop} language={language} />;
      case 'pmfby':   return <PmfbyReportDownload {...farm} language={language} />;
      case 'risk':    return <FarmRiskWidget lat={farm.lat} lon={farm.lon} crop={farm.crop} state={farm.state} language={language} />;
      case 'chat':    return <HybridCopilotChat farm={farm} pendingMessage={pending} onReply={setLastReply} />;
      default:        return null;
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col bg-soil-50">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-leaf-100 bg-white px-4 py-3">
        <button onClick={() => setScreen('hub')} className="rounded-lg p-2 text-soil-700 hover:bg-soil-50" aria-label={t('nav.back')}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <p className="text-sm font-bold leading-tight text-soil-900">{t(`tile.${screen}`)}</p>
          <p className="text-[11px] text-soil-700">{profile.crop} · {profile.areaHa.toFixed(2)} {t('common.ha')}</p>
        </div>
      </header>

      <section className={`flex-1 px-4 py-4 ${screen === 'chat' ? 'pb-44' : 'pb-8'}`}>
        {body()}
      </section>

      {screen === 'chat' && (
        <div className="sticky bottom-0 border-t border-leaf-100 bg-white px-4 py-3">
          <VoiceSearchBar
            language={language}
            onLanguageChange={setLanguage}
            onSubmit={(text) => setPending({ text, nonce: Date.now() })}
            lastReply={lastReply}
          />
        </div>
      )}
    </main>
  );
}