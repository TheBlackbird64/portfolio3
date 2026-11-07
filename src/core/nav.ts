import type { Geometry } from './geometry';
import type { Cam } from './util';
import type { SheetDef } from '../sheets/registry';

/**
 * The navigation never moves, but each entry carries a small arrow that keeps
 * pointing toward its sheet on the canvas — the only hint of where things are.
 */
export class NavArrows {
  private items: { id: string; el: HTMLElement; last: number; here: boolean }[] = [];

  constructor(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('[data-dir]').forEach((el) =>
      this.items.push({ id: el.dataset.dir!, el, last: NaN, here: false }),
    );
  }

  update(cam: Cam, geo: Geometry, currentId: string, settled: boolean) {
    for (const it of this.items) {
      const here = settled && it.id === currentId;
      if (here !== it.here) {
        it.here = here;
        it.el.classList.toggle('is-here', here);
      }
      if (here) continue;
      const a = geo.get(it.id).anchor;
      const deg = (Math.atan2(a.y - cam.y, a.x - cam.x) * 180) / Math.PI;
      if (!(Math.abs(deg - it.last) < 0.4)) {
        it.last = deg;
        it.el.style.setProperty('--a', `${deg.toFixed(1)}deg`);
      }
    }
  }
}

/** Tiny map of the canvas, drawn inside the "Carte" button. */
export function mapGlyph(geo: Geometry, sheets: SheetDef[]) {
  const W = 26;
  const H = 16;
  const b = geo.bounds;
  const s = Math.min(W / b.w, H / b.h);
  const ox = (W - b.w * s) / 2 - b.x * s;
  const oy = (H - b.h * s) / 2 - b.y * s;
  const rects = sheets
    .map((d) => {
      const f = geo.get(d.id).frame;
      return `<rect data-id="${d.id}" x="${(f.x * s + ox).toFixed(2)}" y="${(f.y * s + oy).toFixed(2)}" width="${Math.max(f.w * s, 1.5).toFixed(2)}" height="${Math.max(f.h * s, 1.5).toFixed(2)}"/>`;
    })
    .join('');
  return `<svg class="mapglyph" viewBox="0 0 ${W} ${H}" aria-hidden="true">${rects}</svg>`;
}
