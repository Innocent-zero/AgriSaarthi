import type { TFunc } from '@/lib/i18n';
import type { Farm } from '@/App';
import FarmRiskWidget from '@/components/FarmRiskWidget';
import SatelliteFieldMap from '@/components/SatelliteFieldMap';
import Disclosure from '@/components/ui/Disclosure';

interface Props {
  t: TFunc;
  farm: Farm;
}

export default function RiskView({ t, farm }: Props) {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-4 sm:px-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-soil-900">{t('risk.title')}</h1>
      </div>

      <div className="space-y-3">
        <FarmRiskWidget
          lat={farm.lat}
          lon={farm.lon}
          crop={farm.crop}
          state={farm.state}
          boundary={farm.boundary}
          language={farm.language}
        />

        <Disclosure label={t('risk.ndvi.title')} tone="panel">
          <SatelliteFieldMap
            lat={farm.lat}
            lon={farm.lon}
            language={farm.language}
            boundary={farm.boundary}
            onSelect={() => { /* read-only view from the risk screen */ }}
          />
        </Disclosure>
      </div>
    </div>
  );
}
