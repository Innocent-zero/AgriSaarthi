'use client';

import { useEffect, useRef } from 'react';
import {
  Leaf, X, Home, Camera, TrendingUp, CloudSun, Sprout,
  ShieldAlert, FileText, Landmark, Check,
} from 'lucide-react';
import { makeT, Locale } from '@/lib/i18n';

/** Screens the sidebar can navigate to. Mirrors page.tsx's Screen union. */
export type NavKey =
  | 'home' | 'disease' | 'mandi' | 'weather' | 'npk' | 'risk' | 'pmfby' | 'schemes';

/**
 * The single navigation definition for the whole app. Order puts the two
 * primary farmer actions directly under Home, matching the dashboard's
 * priority. Flat by design — no nested groups.
 */
export const NAV_ITEMS: Array<{ key: NavKey; icon: typeof Home; labelKey: string }> = [
  { key: 'home',    icon: Home,        labelKey: 'nav.home' },
  { key: 'disease', icon: Camera,      labelKey: 'nav.disease' },
  { key: 'mandi',   icon: TrendingUp,  labelKey: 'nav.mandi' },
  { key: 'weather', icon: CloudSun,    labelKey: 'nav.weather' },
  { key: 'npk',     icon: Sprout,      labelKey: 'nav.npk' },
  { key: 'risk',    icon: ShieldAlert, labelKey: 'nav.risk' },
  { key: 'pmfby',   icon: FileText,    labelKey: 'nav.pmfby' },
  { key: 'schemes', icon: Landmark,    labelKey: 'nav.schemes' },
];

interface Props {
  open: boolean;
  current: NavKey;
  language: Locale;
  onNavigate: (key: NavKey) => void;
  onClose: () => void;
}

export default function AppSidebar({ open, current, language, onNavigate, onClose }: Props) {
  const t = makeT(language);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Escape closes; focus moves into the drawer so keyboard users are not
  // stranded behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    firstItemRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Stop the page scrolling behind an open drawer on mobile.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      {/* Scrim. Rendered always so it can fade rather than pop. */}
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Drawer. Overlay at every breakpoint so no page layout has to change. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.menu')}
        className={`fixed inset-y-0 left-0 z-[70] flex w-[82%] max-w-[300px] flex-col
          bg-white shadow-2xl transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2.5 border-b border-leaf-100 px-4 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-600 text-white">
            <Leaf size={18} />
          </span>
          <p className="flex-1 text-base font-bold text-soil-900">{t('app.name')}</p>
          <button
            onClick={onClose}
            aria-label={t('nav.closeMenu')}
            className="rounded-lg p-2 text-soil-700 transition active:bg-soil-50"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {NAV_ITEMS.map((item, i) => {
            const active = item.key === current;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                ref={i === 0 ? firstItemRef : undefined}
                onClick={() => onNavigate(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition
                  ${active
                    ? 'bg-leaf-600 text-white'
                    : 'text-soil-900 active:bg-leaf-50'}`}
              >
                <Icon size={20} className="shrink-0" />
                <span className={`flex-1 text-sm ${active ? 'font-bold' : 'font-medium'}`}>
                  {t(item.labelKey)}
                </span>
                {/* Active state carries a shape as well as a colour, so it
                    reads without relying on colour perception. */}
                {active && <Check size={16} className="shrink-0" />}
              </button>
            );
          })}
        </nav>

        <p className="border-t border-leaf-50 px-4 py-3 text-[10px] text-soil-700/60">
          {t('app.tagline')}
        </p>
      </div>
    </>
  );
}