'use client';

import { useState, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  label: string;
  children: ReactNode;
  /** 'quiet' for inline explanations, 'panel' for bordered sections. */
  tone?: 'quiet' | 'panel';
  defaultOpen?: boolean;
  /** Optional short value shown on the right, e.g. a count or total. */
  hint?: string;
}

/**
 * Collapsed by default so secondary detail never competes with the decision
 * above it. Uses a real button and aria-expanded so screen readers and
 * keyboard users get the same affordance as a tap.
 */
export default function Disclosure({
  label, children, tone = 'panel', defaultOpen = false, hint,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const wrap = tone === 'panel'
    ? 'rounded-xl border border-leaf-100 bg-white'
    : 'border-t border-leaf-50';

  return (
    <div className={wrap}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition active:bg-leaf-50"
      >
        <span className="flex-1 text-sm font-semibold text-soil-900">{label}</span>
        {hint && <span className="text-xs text-soil-700/70">{hint}</span>}
        <ChevronDown
          size={16}
          className={`shrink-0 text-soil-700 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="animate-slideUp border-t border-leaf-50 px-4 py-3">
          {children}
        </div>
      )}
    </div>
  );
}