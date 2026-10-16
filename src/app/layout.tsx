import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'WingChunRoots',
  description: 'Verified Wing Chun teaching lineages, a school finder and a training passport.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Mobile webview readiness (plan §5.8 (b)): content can extend under the notch and
  // the app shell (M00b) pads with env(safe-area-inset-*).
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
