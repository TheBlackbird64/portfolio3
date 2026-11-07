import { SHEETS } from '../sheets/registry';
import { clamp, rectsOverlap, type Rect, type Vec } from './util';

export interface SheetGeo {
  /** Slot = what the camera frames at rest (one stage, or taller). */
  slot: Rect;
  /** Area the sheet content occupies. */
  frame: Rect;
  /** Camera target when arriving (top of the sheet). */
  anchor: Vec;
  maxScroll: number;
}

/** Lays the sheets out on the canvas. Everything is expressed in stage units so it adapts to any screen. */
export class Geometry {
  sw = 1;
  sh = 1;
  margin = 40;
  /** Distance between the stage edges and the content, top and bottom. */
  insetTop = 40;
  insetBottom = 40;
  compact = false;
  map = new Map<string, SheetGeo>();
  bounds: Rect = { x: 0, y: 0, w: 1, h: 1 };

  compute(stage: HTMLElement, els: Map<string, HTMLElement>, insets: { top: number; bottom: number }) {
    this.sw = stage.clientWidth;
    this.sh = stage.clientHeight;
    this.compact = this.sw < 760;
    const m = (this.margin = Math.round(clamp(this.sw * 0.055, 20, 88)));
    const top = Math.max(m, insets.top + clamp(this.sh * 0.03, 8, 28));
    const bottom = Math.max(m * 0.8, insets.bottom + 16);
    this.insetTop = top;
    this.insetBottom = bottom;
    const fw = this.sw - 2 * m;
    const fh = this.sh - top - bottom;

    // write, then read (single layout pass)
    for (const el of els.values()) {
      el.style.width = `${fw}px`;
      el.style.minHeight = `${fh}px`;
    }
    const heights = new Map<string, number>();
    for (const [id, el] of els) heights.set(id, el.offsetHeight);

    const spread = this.compact ? 1.12 : 1;
    const slots = SHEETS.map((def) => ({
      id: def.id,
      r: {
        x: def.gx * this.sw * spread,
        y: def.gy * this.sh,
        w: this.sw,
        h: Math.max(this.sh, (heights.get(def.id) ?? fh) + top + bottom),
      } as Rect,
    }));

    // Tall sheets may run into a neighbour of the same column: push the lower one down.
    const gap = this.sh * 0.22;
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      slots.sort((a, b) => a.r.y - b.r.y);
      for (let i = 0; i < slots.length; i++)
        for (let j = 0; j < i; j++) {
          const A = slots[j].r;
          const B = slots[i].r;
          if (rectsOverlap(A, B, gap * 0.5)) {
            B.y = A.y + A.h + gap;
            moved = true;
          }
        }
      if (!moved) break;
    }

    const home = slots.find((s) => s.id === 'index')!.r;
    const ox = home.x + this.sw / 2;
    const oy = home.y + this.sh / 2;

    this.map.clear();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const { id, r } of slots) {
      const slot = { x: r.x - ox, y: r.y - oy, w: r.w, h: r.h };
      const frame = { x: slot.x + m, y: slot.y + top, w: fw, h: slot.h - top - bottom };
      this.map.set(id, {
        slot,
        frame,
        anchor: { x: slot.x + this.sw / 2, y: slot.y + this.sh / 2 },
        maxScroll: slot.h - this.sh,
      });
      const el = els.get(id)!;
      el.style.left = `${frame.x}px`;
      el.style.top = `${frame.y}px`;
      x0 = Math.min(x0, frame.x);
      y0 = Math.min(y0, frame.y);
      x1 = Math.max(x1, frame.x + frame.w);
      y1 = Math.max(y1, frame.y + frame.h);
    }
    this.bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  get(id: string) {
    return this.map.get(id)!;
  }

  /** Which sheet contains this world point (frames only). */
  hit(x: number, y: number, pad = 0): string | null {
    for (const [id, g] of this.map) {
      const f = g.frame;
      if (x >= f.x - pad && x <= f.x + f.w + pad && y >= f.y - pad && y <= f.y + f.h + pad) return id;
    }
    return null;
  }

  /** Zoom that fits the whole map in the stage. */
  fitZoom(padding = 0.84) {
    return Math.min((this.sw * padding) / this.bounds.w, (this.sh * padding) / this.bounds.h);
  }
}
