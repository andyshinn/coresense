import { Theme } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useRadixTheme } from '../../lib/radix-theme-store';
import { useStore } from '../../lib/store';
import { resolveTheme } from '../../lib/theme';

export function RadixThemeProvider({ children }: { children: ReactNode }) {
  const themePref = useStore((s) => s.ui.themePref);
  const systemDark = useStore((s) => s.systemDark);
  const appearance = resolveTheme(themePref, systemDark); // 'dark' | 'light'
  const { accentColor, grayColor, panelBackground } = useRadixTheme();
  return (
    <Theme
      appearance={appearance}
      accentColor={accentColor}
      grayColor={grayColor}
      panelBackground={panelBackground}
      radius="medium"
      scaling="100%"
    >
      {children}
    </Theme>
  );
}
