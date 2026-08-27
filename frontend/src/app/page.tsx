'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Leaf, Menu } from 'lucide-react';
import OnboardingFlow, { OnboardingResult } from '@/components/OnboardingFlow';
import HomeDashboard, { ViewKey } from '@/components/HomeDashboard';
import AppSidebar, { NavKey } from '@/components/AppSidebar';
import FloatingChat from '@/components/FloatingChat';
import NpkCalculatorWidget from '@/components/NpkCalculatorWidget';
import LeafDiagnosticModal from '@/components/LeafDiagnosticModal';
import MandiProfitWidget from '@/components/MandiProfitWidget';
import PmfbyReportDownload from '@/components/PmfbyReportDownload';
import FarmRiskWidget from '@/components/FarmRiskWidget';
import WeatherPanel from '@/components/WeatherPanel';
import SchemeAdvisorWidget from '@/components/SchemeAdvisorWidget';
import { loadProfile, saveProfile, FarmProfile } from '@/lib/idb';
import { api, getToken } from '@/lib/api';
import { makeT, Locale } from '@/lib/i18n';
import { LatLon } from '@/lib/geo';

type Screen = 'boot' | 'onboarding' | 'home' | ViewKey;

export default function Home() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [profile, setProfile] = useState<FarmProfile | null>(null);
  const [online, setOnline] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const language = (profile?.language ?? 'hi') as Locale;
  const t = makeT(language);

  useEffect(() => {
    (async () => {
      const stored = await loadProfile('default');
      if (stored && stored.crop && stored.areaHa > 0) {
        setProfile(stored);
        setScreen('home');
      } else {
        setScreen('onboarding');
      }
      if (!getToken()) {
        try {
          await api.requestToken('9000000000', stored?.name, stored?.district, stored?.language ?? 'hi');
        } catch { /* offline is fine */ }
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
    setScreen('home');
  }, []);

  const setLanguage = useCallback(async (l: Locale) => {
    if (!profile) return;
    const next = { ...profile, language: l };
    setProfile(next);
    await saveProfile(next);
  }, [profile]);

  /** Single navigation entry point — sidebar, dashboard tiles and the back
   *  arrow all route through here, so behaviour stays identical. */
  const navigate = useCallback((key: NavKey) => {
    setScreen(key as Screen);
    setMenuOpen(false);
    // Feature pages are independent, so a fresh page should start at the top.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, []);

  if (screen === 'boot') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-soil-50">
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
        onCancel={profile ? () => setScreen('home') : undefined}
      />
    );
  }

  if (!profile) return null;

  const farm = {
    lat: profile.lat,
    lon: profile.lon,
    crop: profile.crop,
    areaHa: profile.areaHa,
    state: profile.state,
    district: profile.district,
    farmerName: profile.name,
    language,
    boundary: (profile.boundary as LatLon[]) ?? [],
  };

  // Shared chrome: one sidebar and one chat instance for every screen.
  const chrome = (
    <>
      <AppSidebar
        open={menuOpen}
        current={screen as NavKey}
        language={language}
        onNavigate={navigate}
        onClose={() => setMenuOpen(false)}
      />
      <FloatingChat
        farm={farm}
        currentView={screen}
        onLanguageChange={setLanguage}
      />
    </>
  );

  if (screen === 'home') {
    return (
      <>
        <HomeDashboard
          name={profile.name}
          crop={profile.crop}
          areaHa={profile.areaHa}
          lat={profile.lat}
          lon={profile.lon}
          state={profile.state}
          district={profile.district}
          village={profile.village}
          language={language}
          online={online}
          onLanguageChange={setLanguage}
          onOpen={(v) => navigate(v as NavKey)}
          onEditFarm={() => setScreen('onboarding')}
          onOpenMenu={() => setMenuOpen(true)}
        />
        {chrome}
      </>
    );
  }

  const body = () => {
    switch (screen) {
      case 'weather': return <WeatherPanel lat={farm.lat} lon={farm.lon} language={language} />;
      case 'npk':     return <NpkCalculatorWidget lat={farm.lat} lon={farm.lon} crop={farm.crop} areaHa={farm.areaHa} language={language} />;
      case 'mandi':   return <MandiProfitWidget lat={farm.lat} lon={farm.lon} crop={farm.crop} state={farm.state} district={farm.district} language={language} />;
      case 'disease': return <LeafDiagnosticModal crop={farm.crop} language={language} />;
      case 'pmfby':   return <PmfbyReportDownload {...farm} language={language} />;
      case 'risk':    return <FarmRiskWidget lat={farm.lat} lon={farm.lon} crop={farm.crop} state={farm.state} boundary={farm.boundary} language={language} />;
      case 'schemes': return <SchemeAdvisorWidget lat={farm.lat} lon={farm.lon} crop={farm.crop} areaHa={farm.areaHa} state={farm.state} language={language} />;
      default:        return null;
    }
  };

  return (
    <>
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col bg-soil-50">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-leaf-100 bg-white px-3 py-3">
          {/* Hamburger is the primary navigation control and leads the header. */}
          <button
            onClick={() => setMenuOpen(true)}
            aria-label={t('nav.menu')}
            className="rounded-xl bg-leaf-50 p-2.5 text-leaf-700 transition active:scale-95"
          >
            <Menu size={20} />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight text-soil-900">
              {t(`nav.${screen}`)}
            </p>
            <p className="truncate text-[11px] text-soil-700">
              {profile.crop} · {profile.areaHa.toFixed(2)} {t('common.ha')}
            </p>
          </div>

          {/* Back is retained but visually secondary — the sidebar is now the
              primary way to move between features. */}
          <button
            onClick={() => navigate('home')}
            aria-label={t('nav.home')}
            className="rounded-lg p-2 text-soil-700/60 transition active:bg-soil-50"
          >
            <ArrowLeft size={17} />
          </button>
        </header>

        {/* pb-28 clears the floating chat button */}
        <section className="flex-1 px-4 pb-28 pt-4">{body()}</section>
      </main>
      {chrome}
    </>
  );
}