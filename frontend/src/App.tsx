import { useEffect, useState, useCallback } from 'react';
import { Menu, Leaf, Wifi, WifiOff } from 'lucide-react';
import NavDrawer, { type ViewKey } from '@/components/NavDrawer';
import FloatingChat from '@/components/FloatingChat';
import HomeDashboard from '@/components/HomeDashboard';
import OnboardingFlow, { type OnboardingResult } from '@/components/OnboardingFlow';
import LeafDiagnosisView from '@/components/views/LeafDiagnosisView';
import MandiView from '@/components/views/MandiView';
import WeatherView from '@/components/views/WeatherView';
import FertilizerView from '@/components/views/FertilizerView';
import RiskView from '@/components/views/RiskView';
import InsuranceView from '@/components/views/InsuranceView';
import SchemesView from '@/components/views/SchemesView';
import { makeT, type Locale } from '@/lib/i18n';
import { loadProfile, saveProfile, flushOutbox, type FarmProfile } from '@/lib/idb';
import { api, getToken } from '@/lib/api';
import apiClient from '@/lib/api';
import type { LatLon } from '@/lib/geo';

/** Shared farm context passed to every feature view and the chatbot. */
export interface Farm {
  lat: number;
  lon: number;
  crop: string;
  areaHa: number;
  state?: string;
  district?: string;
  village?: string;
  farmerName: string;
  language: Locale;
  boundary?: LatLon[];
}

type Screen = 'boot' | 'onboarding' | ViewKey;

function App() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [profile, setProfile] = useState<FarmProfile | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [online, setOnline] = useState(true);

  const language: Locale = (profile?.language ?? 'hi') as Locale;
  const t = makeT(language);

  // ── boot: load persisted profile, decide onboarding vs. dashboard ──
  useEffect(() => {
    (async () => {
      const stored = await loadProfile('default');
      if (stored && stored.crop && stored.areaHa > 0) {
        setProfile(stored);
        setScreen('home');
      } else {
        setScreen('onboarding');
      }
      // Best-effort auth — the app must remain usable offline even if this fails.
      if (!getToken()) {
        try {
          await api.requestToken('9000000000', stored?.name, stored?.district, stored?.language ?? 'hi');
        } catch { /* offline is fine */ }
      }
    })();

    const goOnline = () => {
      setOnline(true);
      // Replay anything queued while offline, using the same axios client
      // that carries the bearer token — the outbox itself is populated by
      // any feature that calls queueSync() while offline.
      void flushOutbox(async (endpoint, body) => {
        await apiClient.post(endpoint, body);
      });
    };
    const goOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
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

  const navigate = useCallback((v: ViewKey) => {
    setScreen(v);
    setDrawerOpen(false);
  }, []);

  if (screen === 'boot') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#adc4a8]">
        <Leaf size={30} className="animate-pulse text-white" />
      </div>
    );
  }

  if (screen === 'onboarding') {
    return (
      <OnboardingFlow
        initial={profile ? {
          name: profile.name,
          crop: profile.crop,
          language: profile.language as Locale,
          boundary: (profile.boundary as LatLon[]) ?? [],
          lat: profile.lat,
          lon: profile.lon,
        } : undefined}
        onComplete={handleOnboarding}
        onCancel={profile ? () => setScreen('home') : undefined}
      />
    );
  }

  if (!profile) return null;

  const farm: Farm = {
    lat: profile.lat,
    lon: profile.lon,
    crop: profile.crop,
    areaHa: profile.areaHa,
    state: profile.state,
    district: profile.district,
    village: profile.village,
    farmerName: profile.name,
    language,
    boundary: (profile.boundary as LatLon[]) ?? [],
  };

  const view = screen as ViewKey;

  const titles: Record<ViewKey, string> = {
    home: t('nav.home'),
    disease: t('nav.disease'),
    mandi: t('nav.mandi'),
    weather: t('nav.weather'),
    npk: t('nav.npk'),
    risk: t('nav.risk'),
    pmfby: t('nav.pmfby'),
    schemes: t('nav.schemes'),
  };

  return (
    <div className="min-h-screen bg-[#adc4a8] px-0 sm:px-3 lg:px-5">
      <div className="editorial-shell mx-auto min-h-screen max-w-[1440px] overflow-hidden shadow-2xl shadow-soil-900/10">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-soil-100 bg-white/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 text-soil-700 transition hover:bg-soil-50 active:scale-95"
              aria-label={t('nav.menu')}
            >
              <Menu size={22} />
            </button>
            <div className="flex flex-1 items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-leaf-600 text-white">
                <Leaf size={16} />
              </div>
              <div>
                <p className="text-sm font-bold leading-tight font-display text-soil-900">{t('app.name')}</p>
                <p className="text-[10px] leading-tight text-soil-500">{titles[view]}</p>
              </div>
            </div>
            <span className={`chip ${online ? 'bg-leaf-50 text-leaf-700' : 'bg-alert-50 text-alert-600'}`}>
              {online ? <Wifi size={11} /> : <WifiOff size={11} />}
              {online ? t('common.online') : t('common.offline')}
            </span>
          </div>
        </header>

        {/* Navigation drawer */}
        <NavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          active={view}
          onNavigate={navigate}
          t={t}
        />

        {/* Main content */}
        <main>
          {view === 'home' && (
            <HomeDashboard
              t={t}
              farm={farm}
              online={online}
              onNavigate={navigate}
              onEditFarm={() => setScreen('onboarding')}
            />
          )}
          {view === 'disease' && <LeafDiagnosisView t={t} farm={farm} />}
          {view === 'mandi' && <MandiView t={t} farm={farm} />}
          {view === 'weather' && <WeatherView t={t} farm={farm} />}
          {view === 'npk' && <FertilizerView t={t} farm={farm} />}
          {view === 'risk' && <RiskView t={t} farm={farm} />}
          {view === 'pmfby' && <InsuranceView t={t} farm={farm} />}
          {view === 'schemes' && <SchemesView t={t} farm={farm} />}
        </main>

        {/* Floating chatbot — real agent, history, actions, voice */}
        <FloatingChat
          t={t}
          farm={farm}
          currentView={view}
          language={language}
          onLanguageChange={setLanguage}
        />
      </div>
    </div>
  );
}

export default App;
