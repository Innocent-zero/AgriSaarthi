import type { TFunc } from '@/lib/i18n';
import type { Farm } from '@/App';
import NpkCalculatorWidget from '@/components/NpkCalculatorWidget';

interface Props {
  t: TFunc;
  farm: Farm;
}

export default function FertilizerView({ t, farm }: Props) {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-soil-900">{t('npk.title')}</h1>
      </div>

      <NpkCalculatorWidget
        lat={farm.lat}
        lon={farm.lon}
        crop={farm.crop}
        areaHa={farm.areaHa}
        boundary={farm.boundary}
        language={farm.language}
      />
    </div>
  );
}
