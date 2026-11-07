import type { Hue } from '../sheets/registry';

export interface Palette {
  bg: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  line: string;
  line2: string;
  line3: string;
  accent: string;
  /** Neutral colour of the background shapes (alpha is applied when drawing). */
  deco: string;
  hues: Record<Hue, string>;
}

let palette: Palette | null = null;

function read(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    bg: v('--bg'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    ink4: v('--ink-4'),
    line: v('--line'),
    line2: v('--line-2'),
    line3: v('--line-3'),
    accent: v('--orange'),
    deco: v('--deco'),
    hues: { orange: v('--orange'), blue: v('--blue'), violet: v('--violet'), red: v('--red') },
  };
}

export const getPalette = () => (palette ??= read());

export type ThemeName = 'dark' | 'light';

export const currentTheme = (): ThemeName =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

export function setTheme(t: ThemeName) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#ecebe6' : '#0a0a0b');
  palette = read();
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* storage unavailable: theme simply won't persist */
  }
  window.dispatchEvent(new CustomEvent('themechange'));
}

export const FONT_MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';
