import type { TFunc } from '@/lib/i18n';
import type { Farm } from '@/App';
import SchemeAdvisorWidget from '@/components/SchemeAdvisorWidget';

interface Props {
  t: TFunc;
  farm: Farm;
}

export default function SchemesView({ t, farm }: Props) {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-soil-900">{t('scheme.title')}</h1>
      </div>

      <SchemeAdvisorWidget
        lat={farm.lat}
        lon={farm.lon}
        crop={farm.crop}
        areaHa={farm.areaHa}
        state={farm.state}
        language={farm.language}
      />
    </div>
  );
}
