'use client';

import {
  CloudSun, Sprout, TrendingUp, Camera, FileText, ShieldAlert, MessageCircle,
  Settings2, Languages, Wifi, WifiOff, Leaf,
} from 'lucide-react';
import { makeT, Locale } from '@/lib/i18n';

export type ViewKey =
  | 'weather' | 'npk' | 'mandi' | 'disease' | 'pmfby' | 'risk' | 'chat';

interface Props {
  name: string;
  crop: string;
  areaHa: number;
  language: Locale;
  online: boolean;
  onLanguageChange: (l: Locale) => void;
  onOpen: (v: ViewKey) => void;
  onEditFarm: () => void;
}

const TILES: Array<{ key: ViewKey; icon: typeof CloudSun; tone: string }> = [
  { key: 'weather', icon: CloudSun,      tone: 'bg-leaf-600' },
  { key: 'npk',     icon: Sprout,        tone: 'bg-leaf-500' },
  { key: 'mandi',   icon: TrendingUp,    tone: 'bg-harvest-500' },
  { key: 'disease', icon: Camera,        tone: 'bg-soil-900' },
  { key: 'pmfby',   icon: FileText,      tone: 'bg-soil-700' },
  { key: 'risk',    icon: ShieldAlert,   tone: 'bg-alert-600' },
  { key: 'chat',    icon: MessageCircle, tone: 'bg-leaf-700' },
];

export default function HubMenu({
  name, crop, areaHa, language, online, onLanguageChange, onOpen, onEditFarm,
}: Props) {
  const t = makeT(language);

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-soil-50">
      <header className="px-5 pb-4 pt-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-leaf-600 text-white">
              <Leaf size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight text-soil-900">
                {t('hub.greeting', { name })}
              </h1>
              <p className="text-xs text-soil-700">
                {t('hub.summary', { crop, area: areaHa.toFixed(2) })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${
              online ? 'bg-leaf-50 text-leaf-700' : 'bg-harvest-400/15 text-harvest-600'}`}>
              {online ? <Wifi size={11} /> : <WifiOff size={11} />}
              {online ? t('common.online') : t('common.offline')}
            </span>
            <button
              onClick={() => onLanguageChange(language === 'hi' ? 'en' : 'hi')}
              className="rounded-lg bg-white p-2 text-leaf-700 shadow-card"
              aria-label="Language"
            >
              <Languages size={16} />
            </button>
            <button onClick={onEditFarm} className="rounded-lg bg-white p-2 text-soil-700 shadow-card" aria-label="Edit farm">
              <Settings2 size={16} />
            </button>
          </div>
        </div>
      </header>

      <p className="px-5 pb-3 text-sm font-semibold text-soil-900">{t('hub.pick')}</p>

      <div className="grid grid-cols-2 gap-3 px-5 pb-8">
        {TILES.map(({ key, icon: Icon, tone }, i) => (
          <button
            key={key}
            onClick={() => onOpen(key)}
            style={{ animationDelay: `${i * 40}ms` }}
            className={`animate-slideUp flex flex-col items-start gap-2 rounded-2xl bg-white p-4 text-left shadow-card transition active:scale-[0.98] ${
              key === 'chat' ? 'col-span-2' : ''
            }`}
          >
            <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-white ${tone}`}>
              <Icon size={20} />
            </span>
            <span className="text-sm font-bold text-soil-900">{t(`tile.${key}`)}</span>
            <span className="text-[11px] leading-snug text-soil-700">{t(`tile.${key}.sub`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}