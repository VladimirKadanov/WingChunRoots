import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { ToastProvider } from '@/components/ui/toast';
import { fontFaceClassNames } from '@/design/fonts';
import { THEME_COLOR, THEME_SCRIPT } from '@/design/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'WingChunRoots', template: '%s · WingChunRoots' },
  description: 'Verified Wing Chun teaching lineages, a school finder and a training passport.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Mobile webview readiness (plan §5.8 (b)): content extends under the notch and the app
  // shell pads with env(safe-area-inset-*).
  viewportFit: 'cover',
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // data-theme is set by the inline script below when the reader chose a theme.
    <html lang="en" className={fontFaceClassNames} suppressHydrationWarning>
      <head>
        {/* Browser UI colour for each system theme; the script retargets both for a manual choice. */}
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content={THEME_COLOR.dark} suppressHydrationWarning />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={THEME_COLOR.light} suppressHydrationWarning />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
