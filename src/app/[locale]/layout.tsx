import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { SocketProvider } from '@/components/providers/socket-provider';
import { UnifiedSetupProvider } from '@/components/providers/unified-setup-provider';
import { ApiKeyProvider } from '@/components/auth/api-key-dialog';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/i18n/config';
import '../globals.css';

// Force dynamic rendering to avoid Next.js 16 Turbopack bugs
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

const geistSans = GeistSans;
const geistMono = GeistMono;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
};

export const metadata: Metadata = {
  title: 'Claude Workspace',
  description: 'Workspace powered by Claude Code CLI',
  icons: {
    icon: '/logo.svg',
    apple: '/logo.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Claude Workspace',
  },
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!locales.includes(locale as any)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <NextIntlClientProvider messages={messages}>
          <ApiKeyProvider>
            <SocketProvider>
              <ThemeProvider>
                <UnifiedSetupProvider>
                  {children}
                </UnifiedSetupProvider>
                <Toaster position="top-right" richColors closeButton />
              </ThemeProvider>
            </SocketProvider>
          </ApiKeyProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
