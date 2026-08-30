import { useEffect } from 'react';
import { X, Home, Leaf, MapPin, CloudSun, Sprout, ShieldAlert, FileText, Landmark } from 'lucide-react';
import type { TFunc } from '@/lib/i18n';

export type ViewKey = 'home' | 'disease' | 'mandi' | 'weather' | 'npk' | 'risk' | 'pmfby' | 'schemes';

interface Props {
  open: boolean;
  onClose: () => void;
  active: ViewKey;
  onNavigate: (v: ViewKey) => void;
  t: TFunc;
}

const ITEMS: Array<{ key: ViewKey; icon: typeof Home; navKey: string }> = [
  { key: 'home', icon: Home, navKey: 'nav.home' },
  { key: 'disease', icon: Leaf, navKey: 'nav.disease' },
  { key: 'mandi', icon: MapPin, navKey: 'nav.mandi' },
  { key: 'weather', icon: CloudSun, navKey: 'nav.weather' },
  { key: 'npk', icon: Sprout, navKey: 'nav.npk' },
  { key: 'risk', icon: ShieldAlert, navKey: 'nav.risk' },
  { key: 'pmfby', icon: FileText, navKey: 'nav.pmfby' },
  { key: 'schemes', icon: Landmark, navKey: 'nav.schemes' },
];

export default function NavDrawer({ open, onClose, active, onNavigate, t }: Props) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:z-40">
      <div
        className="absolute inset-0 bg-soil-900/40 backdrop-blur-sm animate-fadeIn"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="absolute left-0 top-0 h-full w-[280px] max-w-[85vw] bg-white shadow-lift animate-slideIn flex flex-col"
        role="dialog"
        aria-label={t('nav.menu')}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-soil-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-600 text-white">
              <Leaf size={18} />
            </div>
            <div>
              <p className="text-base font-bold leading-tight font-display text-soil-900">{t('app.name')}</p>
              <p className="text-[11px] text-soil-500">{t('app.tagline')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-soil-500 hover:bg-soil-50 hover:text-soil-900 transition"
            aria-label={t('nav.closeMenu')}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <button
                key={item.key}
                onClick={() => {
                  onNavigate(item.key);
                  onClose();
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3.5 text-left transition ${
                  isActive
                    ? 'bg-leaf-50 text-leaf-700'
                    : 'text-soil-800 hover:bg-soil-50'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${
                    isActive ? 'bg-leaf-600 text-white' : 'bg-soil-100 text-soil-600'
                  }`}
                >
                  <Icon size={18} />
                </span>
                <span className="flex-1 text-sm font-semibold">{t(item.navKey)}</span>
                {isActive && <span className="h-2 w-2 rounded-full bg-leaf-500" />}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-soil-100 px-5 py-3">
          <p className="text-[10px] leading-relaxed text-soil-400">{t('app.tagline')}</p>
        </div>
      </aside>
    </div>
  );
}
