import './storefront.css';
import './globals.css';
import './design-system.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: {
    default: 'Restaurant | Order something delicious',
    template: '%s | Restaurant',
  },
  description: 'Explore the menu, choose your favourites, and place your restaurant order online.',
  applicationName: 'Restaurant',
  openGraph: {
    type: 'website',
    siteName: 'Restaurant',
    title: 'Restaurant | Order something delicious',
    description: 'Explore the menu and order your favourites online.',
  },
  twitter: {
    card: 'summary',
    title: 'Restaurant | Order something delicious',
    description: 'Explore the menu and order your favourites online.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#eef2f5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-NG"><body>{children}</body></html>;
}
