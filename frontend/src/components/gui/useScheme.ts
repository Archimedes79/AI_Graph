import { useEffect } from 'react';
import { schemeVars } from './scheme';

/**
 * Put the active scheme on the document root.
 *
 * On the root rather than on the app's own shell element, because a scheme has
 * to reach things React does not render inside it: the window's backdrop behind
 * a short page, the scrollbars, and native form controls, which follow
 * `color-scheme`. A light scheme applied only to the shell is a light page on a
 * dark desk with dark scrollbars down the side.
 */
export function useSchemeOnRoot(id: string | undefined): void {
  useEffect(() => {
    const root = document.documentElement;
    const vars = schemeVars(id) as Record<string, string>;
    for (const [name, value] of Object.entries(vars)) {
      if (name.startsWith('--')) root.style.setProperty(name, value);
    }
    // `colorScheme` is a real CSS property, not a variable, so it is set as one.
    root.style.colorScheme = vars.colorScheme ?? 'dark';
  }, [id]);
}
