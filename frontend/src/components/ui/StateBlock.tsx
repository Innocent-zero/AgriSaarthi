import { ReactNode } from 'react';
import { Loader2, WifiOff, RefreshCw, Inbox, AlertTriangle } from 'lucide-react';
import Disclosure from './Disclosure';

interface LoadingProps {
  message: string;
  rows?: number;
}

export function LoadingState({ message, rows = 3 }: LoadingProps) {
  return (
    <div className="card p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-leaf-700">
        <Loader2 size={15} className="animate-spin" />
        {message}
      </p>
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="skeleton h-3"
            style={{ width: `${100 - i * 14}%`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

interface ErrorProps {
  message: string;
  technical?: string;
  onRetry?: () => void;
  retryLabel: string;
  detailsLabel: string;
  offline?: boolean;
}

export function ErrorState({ message, technical, onRetry, retryLabel, detailsLabel, offline }: ErrorProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-harvest-400/40 bg-harvest-50/60">
      <div className="p-5">
        <p className="flex items-start gap-2 text-sm leading-relaxed text-soil-900">
          {offline ? (
            <WifiOff size={16} className="mt-0.5 shrink-0 text-harvest-600" />
          ) : (
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-harvest-600" />
          )}
          {message}
        </p>
        {onRetry && (
          <button onClick={onRetry} className="btn-dark mt-3 px-4 py-2.5 text-sm">
            <RefreshCw size={14} />
            {retryLabel}
          </button>
        )}
      </div>
      {technical && (
        <Disclosure label={detailsLabel} tone="quiet">
          <p className="break-words font-mono text-[10px] leading-relaxed text-soil-500">{technical}</p>
        </Disclosure>
      )}
    </div>
  );
}

interface EmptyProps {
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ title, message, action }: EmptyProps) {
  return (
    <div className="rounded-2xl border border-dashed border-soil-200 bg-white p-6 text-center">
      <Inbox size={26} className="mx-auto text-leaf-300" />
      <p className="mt-2 text-sm font-semibold text-soil-900">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-soil-500">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
