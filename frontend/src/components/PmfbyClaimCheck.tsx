
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, Loader2, BookOpen, ExternalLink } from 'lucide-react';
import { api, ClaimCheck, friendlyError } from '@/lib/api';
import { makeT, Locale, translate } from '@/lib/i18n';

interface Props {
  causeKey: string;
  eventDate: string;
  lossPct: number;
  language: Locale;
}

const STATUS_STYLE: Record<string, { icon: typeof Info; cls: string }> = {
  ok:      { icon: CheckCircle2,  cls: 'bg-leaf-50 text-leaf-700 border-leaf-100' },
  warning: { icon: AlertTriangle, cls: 'bg-alert-400/10 text-alert-600 border-alert-400/30' },
  info:    { icon: Info,          cls: 'bg-harvest-400/12 text-harvest-600 border-harvest-400/30' },
};

export default function PmfbyClaimCheck({ causeKey, eventDate, lossPct, language }: Props) {
  const t = makeT(language);
  const [data, setData] = useState<ClaimCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    // Send the English label so the backend's peril matching is stable
    // regardless of which language the farmer is using.
    api.claimCheck({
      cause: translate('en', causeKey),
      eventDate,
      estimatedLossPct: Number(lossPct.toFixed(1)),
      language,
    })
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(friendlyError(e)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [causeKey, eventDate, lossPct, language]);

  if (busy && !data) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-leaf-50 p-3 text-xs text-leaf-700">
        <Loader2 size={13} className="animate-spin" /> {t('pmfby.checking')}
      </div>
    );
  }
  if (error) return <p className="rounded-xl bg-alert-400/10 p-3 text-xs text-alert-600">{error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-2 rounded-xl border border-leaf-100 bg-white p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-leaf-700">
        <BookOpen size={13} /> {t('pmfby.checkTitle')}
      </p>

      {data.findings.map((f) => {
        const s = STATUS_STYLE[f.status] ?? STATUS_STYLE.info;
        const Icon = s.icon;
        return (
          <div key={f.key} className={`flex gap-2 rounded-lg border p-2.5 ${s.cls}`}>
            <Icon size={14} className="mt-0.5 shrink-0" />
            <p className="text-[11px] leading-relaxed">{f.text}</p>
          </div>
        );
      })}

      {data.guidance && (
        <div className="rounded-lg bg-soil-50 p-2.5">
          <p className="text-[11px] leading-relaxed text-soil-900">{data.guidance}</p>
        </div>
      )}

      {data.citations.length > 0 && (
        <div className="border-t border-leaf-50 pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-soil-700/60">
            {t('rag.sources')}
          </p>
          {data.citations.map((c) => (
            <a key={`${c.scheme_id}-${c.heading}`} href={c.source_url || undefined}
               target="_blank" rel="noreferrer"
               className="flex items-start gap-1 py-0.5 text-[10px] text-leaf-700 hover:underline">
              {c.title} — {c.heading}
              {c.source_url && <ExternalLink size={9} className="mt-0.5 shrink-0" />}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
