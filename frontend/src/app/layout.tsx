import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgriSaarthi — खेती का साथी',
  description: 'Offline-first precision farming copilot for Indian smallholder farmers',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'AgriSaarthi' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#1B7A43',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hi">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}