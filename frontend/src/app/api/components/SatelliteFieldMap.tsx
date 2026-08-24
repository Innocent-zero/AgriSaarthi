'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { MapPin, Layers, Crosshair } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

const MapContainer = dynamic(() => import('react-leaflet').then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((m) => m.Marker), { ssr: false });
const Polygon = dynamic(() => import('react-leaflet').then((m) => m.Polygon), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then((m) => m.Popup), { ssr: false });

interface Props {
  lat: number;
  lon: number;
  language: 'hi' | 'en';
  boundary?: Array<{ lat: number; lon: number }>;
  onSelect: (lat: number, lon: number) => void;
  onBoundaryChange?: (points: Array<{ lat: number; lon: number }>) => void;
}

/**
 * Click handler must live inside the MapContainer tree, so it is defined here
 * and loaded client-side only (react-leaflet hooks require a map context).
 */
const ClickCapture = dynamic(
  async () => {
    const { useMapEvents } = await import('react-leaflet');
    return function Capture({ onClick }: { onClick: (lat: number, lon: number) => void }) {
      useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
      return null;
    };
  },
  { ssr: false },
);

export default function SatelliteFieldMap({ lat, lon, language, boundary = [], onSelect, onBoundaryChange }: Props) {
  const hi = language === 'hi';
  const [mode, setMode] = useState<'centre' | 'boundary'>('centre');
  const [showNdvi, setShowNdvi] = useState(false);
  const [locating, setLocating] = useState(false);

  const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ndviUrl = process.env.NEXT_PUBLIC_NDVI_TILE_URL;

  const polygon = useMemo(
    () => boundary.map((p) => [p.lat, p.lon] as [number, number]),
    [boundary],
  );

  const handleClick = (clickLat: number, clickLon: number) => {
    if (mode === 'centre') {
      onSelect(clickLat, clickLon);
    } else if (onBoundaryChange) {
      onBoundaryChange([...boundary, { lat: clickLat, lon: clickLon }]);
    }
  };

  const locateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onSelect(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-leaf-100 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-leaf-50 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-soil-900">
          <MapPin size={15} className="text-leaf-600" />
          {hi ? 'मेरा खेत' : 'My field'}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMode(mode === 'centre' ? 'boundary' : 'centre')}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    mode === 'boundary' ? 'bg-harvest-500 text-white' : 'bg-leaf-50 text-leaf-700'}`}>
            {mode === 'boundary' ? (hi ? 'सीमा बना रहे हैं' : 'Drawing boundary') : (hi ? 'सीमा बनाएँ' : 'Draw boundary')}
          </button>
          {ndviUrl && (
            <button onClick={() => setShowNdvi(!showNdvi)}
                    className={`rounded-lg p-1.5 transition ${showNdvi ? 'bg-leaf-600 text-white' : 'bg-leaf-50 text-leaf-700'}`}
                    aria-label="Toggle NDVI">
              <Layers size={14} />
            </button>
          )}
          <button onClick={locateMe} disabled={locating}
                  className="rounded-lg bg-soil-900 p-1.5 text-white disabled:opacity-50" aria-label="Locate me">
            <Crosshair size={14} className={locating ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="h-64 w-full">
        <MapContainer center={[lat, lon]} zoom={14} scrollWheelZoom className="h-full w-full">
          <TileLayer url={tileUrl} attribution="&copy; OpenStreetMap contributors" />
          {showNdvi && ndviUrl && <TileLayer url={ndviUrl} opacity={0.6} />}
          <ClickCapture onClick={handleClick} />
          <Marker position={[lat, lon]}>
            <Popup>
              {hi ? 'खेत का केंद्र' : 'Field centre'}<br />
              {lat.toFixed(5)}, {lon.toFixed(5)}
            </Popup>
          </Marker>
          {polygon.length >= 3 && (
            <Polygon positions={polygon} pathOptions={{ color: '#1B7A43', fillOpacity: 0.22, weight: 2 }} />
          )}
        </MapContainer>
      </div>

      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-soil-700">
        <span>
          {mode === 'boundary'
            ? hi ? 'खेत के कोनों पर टैप करें' : 'Tap each corner of your field'
            : hi ? 'खेत पर टैप करके जगह चुनें' : 'Tap the map to set your field'}
        </span>
        {boundary.length > 0 && onBoundaryChange && (
          <button onClick={() => onBoundaryChange([])} className="font-semibold text-alert-600">
            {hi ? `सीमा मिटाएँ (${boundary.length})` : `Clear (${boundary.length})`}
          </button>
        )}
      </div>
    </div>
  );
}