import type { TFunc } from '@/lib/i18n';
import type { Farm } from '@/App';
import LeafDiagnosticModal from '@/components/LeafDiagnosticModal';

interface Props {
  t: TFunc;
  farm: Farm;
}

export default function LeafDiagnosisView({ t, farm }: Props) {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-soil-900">{t('dz.title')}</h1>
      </div>

      <LeafDiagnosticModal crop={farm.crop} language={farm.language} />
    </div>
  );
}
