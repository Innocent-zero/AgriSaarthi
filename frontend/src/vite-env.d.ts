/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_NDVI_TILE_URL?: string;
  readonly VITE_DEFAULT_LAT?: string;
  readonly VITE_DEFAULT_LON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

