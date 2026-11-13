export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
/** 12 345 with thin spaces and a real minus sign. */
export const fmtInt = (n: number) =>
  nf
    .format(Math.round(n) === 0 ? 0 : Math.round(n))
    .replace(/[  ]/g, ' ')
    .replace('-', '−');

export const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** Compass bearing in degrees (0 = north/up, clockwise) for a screen-space vector. */
export const bearing = (dx: number, dy: number) => ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;

export const fmtBearing = (deg: number) => `${pad(Math.round(deg) % 360, 3)}°`;

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  return root.querySelector(sel) as T;
}

export function qsa<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll(sel)) as T[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Vec {
  x: number;
  y: number;
}

export interface Cam {
  /** World point at the center of the stage. */
  x: number;
  y: number;
  /** Zoom (1 = rest). */
  z: number;
}

/**
 * Smooth zoom + pan path (van Wijk & Nuij, "Smooth and efficient zooming and panning", 2003).
 * Points are [centerX, centerY, visibleWidthInWorldUnits].
 */
export function zoomPath(p0: [number, number, number], p1: [number, number, number], rho = 1.25) {
  const rho2 = rho * rho;
  const rho4 = rho2 * rho2;
  const [ux0, uy0, w0] = p0;
  const [ux1, uy1, w1] = p1;
  const dx = ux1 - ux0;
  const dy = uy1 - uy0;
  const d2 = dx * dx + dy * dy;
  let S: number;
  let at: (t: number) => [number, number, number];

  if (d2 < 1e-9) {
    S = Math.log(w1 / w0) / rho;
    at = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / rho;
    const coshr0 = Math.cosh(r0);
    const sinhr0 = Math.sinh(r0);
    at = (t) => {
      const s = t * S;
      const u = (w0 / (rho2 * d1)) * (coshr0 * Math.tanh(rho * s + r0) - sinhr0);
      return [ux0 + u * dx, uy0 + u * dy, (w0 * coshr0) / Math.cosh(rho * s + r0)];
    };
  }
  return { at, length: Math.abs(S) };
}

/** Distance along a ray (origin inside rect) to the rect border. */
export function rayExit(ox: number, oy: number, dx: number, dy: number, r: Rect) {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (r.x + r.w - ox) / dx);
  else if (dx < -1e-9) t = Math.min(t, (r.x - ox) / dx);
  if (dy > 1e-9) t = Math.min(t, (r.y + r.h - oy) / dy);
  else if (dy < -1e-9) t = Math.min(t, (r.y - oy) / dy);
  return t;
}

export const rectsOverlap = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const ARROW = `<svg class="ico-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/></svg>`;

/** Small seeded PRNG (mulberry32), returns values in [0, 1). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
