import { useState, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  label: string;
  children: ReactNode;
  tone?: 'quiet' | 'panel';
  defaultOpen?: boolean;
  hint?: string;
}

export default function Disclosure({ label, children, tone = 'panel', defaultOpen = false, hint }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const wrap = tone === 'panel' ? 'rounded-xl border border-soil-100 bg-white' : 'border-t border-soil-100';

  return (
    <div className={wrap}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition active:bg-leaf-50"
      >
        <span className="flex-1 text-sm font-semibold text-soil-900">{label}</span>
        {hint && <span className="text-xs text-soil-500">{hint}</span>}
        <ChevronDown
          size={16}
          className={`shrink-0 text-soil-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="animate-slideUp border-t border-soil-100 px-4 py-3">{children}</div>
      )}
    </div>
  );
}
