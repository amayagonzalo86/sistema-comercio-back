import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@/styles/globals.scss';
import { Providers } from './providers';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap' });

const appName = process.env.NEXT_PUBLIC_APP_NAME || 'Comercio ERP';

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: 'Gestión comercial multi-sucursal: ventas, caja, stock, compras y factura electrónica ARCA.',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0f1d31',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
