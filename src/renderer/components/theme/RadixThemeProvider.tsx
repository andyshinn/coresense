import { Theme } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useStore } from '../../lib/store';
import { resolveTheme } from '../../lib/theme';

export function RadixThemeProvider({ children }: { children: ReactNode }) {
  const themePref = useStore((s) => s.ui.themePref);
  const systemDark = useStore((s) => s.systemDark);
  const appearance = resolveTheme(themePref, systemDark); // 'dark' | 'light'
  return (
    <Theme
      appearance={appearance}
      accentColor="amber"
      grayColor="sand"
      panelBackground="translucent"
      radius="medium"
      scaling="100%"
    >
      {children}
    </Theme>
  );
}
