'use client';

import { useTheme } from 'next-themes';
import { useMemo } from 'react';

const PIERRE_THEMES = {
  light: 'pierre-light' as const,
  dark: 'pierre-dark' as const,
};

export function usePierreTheme() {
  const { resolvedTheme } = useTheme();

  return useMemo(() => ({
    theme: PIERRE_THEMES,
    themeType: (resolvedTheme === 'dark' ? 'dark' : 'light') as 'dark' | 'light',
  }), [resolvedTheme]);
}
