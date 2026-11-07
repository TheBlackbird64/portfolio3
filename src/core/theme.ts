export interface Palette {
  bg: string;
  paper: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  line: string;
  line2: string;
  line3: string;
  accent: string;
  accentSoft: string;
  grid: string;
  cross: string;
  contour: string;
  contourMajor: string;
  frame: string;
  hatch: string;
}

let palette: Palette | null = null;

function read(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    bg: v('--bg'),
    paper: v('--paper'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    ink4: v('--ink-4'),
    line: v('--line'),
    line2: v('--line-2'),
    line3: v('--line-3'),
    accent: v('--accent'),
    accentSoft: v('--accent-soft'),
    grid: v('--cv-grid'),
    cross: v('--cv-cross'),
    contour: v('--cv-contour'),
    contourMajor: v('--cv-contour-major'),
    frame: v('--cv-frame'),
    hatch: v('--cv-hatch'),
  };
}

export const getPalette = () => (palette ??= read());

export type ThemeName = 'dark' | 'light';

export const currentTheme = (): ThemeName =>
  document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

export function setTheme(t: ThemeName) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#e9e7e0' : '#0c0d0f');
  palette = read();
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* storage unavailable: theme simply won't persist */
  }
  window.dispatchEvent(new CustomEvent('themechange'));
}

export const FONT_MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';
