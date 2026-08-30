import type { TFunc } from '@/lib/i18n';
import type { Farm } from '@/App';
import MandiProfitWidget from '@/components/MandiProfitWidget';

interface Props {
  t: TFunc;
  farm: Farm;
}

export default function MandiView({ t, farm }: Props) {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-soil-900">{t('mandi.title')}</h1>
      </div>

      <MandiProfitWidget
        lat={farm.lat}
        lon={farm.lon}
        crop={farm.crop}
        state={farm.state}
        district={farm.district}
        language={farm.language}
      />
    </div>
  );
}
