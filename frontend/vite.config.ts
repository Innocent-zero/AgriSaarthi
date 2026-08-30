import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'AgriSaarthi',
        short_name: 'AgriSaarthi',
        description: 'Your farming co-pilot — weather, mandi, diagnosis, risk, insurance and schemes, in one place.',
        theme_color: '#1B7A43',
        background_color: '#F4EFE6',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-shell precache — the JS/CSS/HTML bundle itself.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Weather / soil — short-lived farm advisories. Network-first so
            // a farmer with patchy signal still sees the last-known reading
            // instead of a blank screen. Mirrors the old NetworkFirst rule.
            urlPattern: ({ url }) => /\/data\/(weather|soil)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'agri-advisory',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 60, maxAgeSeconds: 21600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Mandi optimisation + conversational agent — same policy the
            // old service worker used: network-first with a shorter cache
            // window, so a repeat question still gets an answer offline.
            urlPattern: ({ url }) => /\/(mandi|agent)\//.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'agri-dynamic',
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 40, maxAgeSeconds: 10800 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Map tiles (OSM / NDVI) — cache-first, they rarely change and
            // this is what makes the field map usable with a weak signal.
            urlPattern: ({ url }) => /tile\.openstreetmap\.org|\/ndvi\//.test(url.href),
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: 1209600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});

