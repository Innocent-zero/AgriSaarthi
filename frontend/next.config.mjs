import withPWAInit from 'next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      // App shell — offline-first so the dashboard opens with no signal.
      urlPattern: /^https?.*\/(_next\/static|_next\/image).*/i,
      handler: 'CacheFirst',
      options: { cacheName: 'static-assets', expiration: { maxEntries: 200, maxAgeSeconds: 2592000 } },
    },
    {
      urlPattern: /\/api\/v1\/data\/(weather|soil)/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'agri-advisory',
        networkTimeoutSeconds: 6,
        expiration: { maxEntries: 60, maxAgeSeconds: 21600 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      urlPattern: /\/api\/v1\/(mandi|agent)\//i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'agri-dynamic',
        networkTimeoutSeconds: 8,
        expiration: { maxEntries: 40, maxAgeSeconds: 10800 },
      },
    },
    {
      urlPattern: /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/i,
      handler: 'CacheFirst',
      options: { cacheName: 'map-tiles', expiration: { maxEntries: 400, maxAgeSeconds: 1209600 } },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};

export default withPWA(nextConfig);