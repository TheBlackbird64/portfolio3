import { SHEETS } from '../sheets/registry';
import { bearing, clamp, rayExit, rectsOverlap, type Rect, type Vec } from './util';

export interface SheetGeo {
  /** Slot = what the camera frames at rest (one stage, or taller). */
  slot: Rect;
  /** Visible sheet = slot inset by the margin. */
  frame: Rect;
  /** Camera target when arriving (top of the sheet). */
  anchor: Vec;
  maxScroll: number;
}

export interface Route {
  key: string;
  a: string;
  b: string;
  /** Visible part of the route, between the two sheets. */
  p: Vec;
  q: Vec;
  dist: number;
  cap: number;
}

export const routeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Lays the sheets out on the canvas. Everything is expressed in stage units so it adapts to any screen. */
export class Geometry {
  sw = 1;
  sh = 1;
  margin = 40;
  compact = false;
  map = new Map<string, SheetGeo>();
  routes: Route[] = [];
  bounds: Rect = { x: 0, y: 0, w: 1, h: 1 };

  compute(stage: HTMLElement, els: Map<string, HTMLElement>) {
    this.sw = stage.clientWidth;
    this.sh = stage.clientHeight;
    this.compact = this.sw < 760;
    const m = (this.margin = Math.round(clamp(Math.min(this.sw, this.sh * 1.6) * 0.036, 12, 56)));
    const fw = this.sw - 2 * m;
    const fh = this.sh - 2 * m;

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
        h: Math.max(this.sh, (heights.get(def.id) ?? fh) + 2 * m),
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
      const frame = { x: slot.x + m, y: slot.y + m, w: fw, h: slot.h - 2 * m };
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
    this.computeRoutes();
  }

  private computeRoutes() {
    const seen = new Set<string>();
    this.routes = [];
    for (const def of SHEETS)
      for (const other of def.links) {
        const key = routeKey(def.id, other);
        if (seen.has(key)) continue;
        seen.add(key);
        const A = this.map.get(def.id)!;
        const B = this.map.get(other)!;
        const dx = B.anchor.x - A.anchor.x;
        const dy = B.anchor.y - A.anchor.y;
        const len = Math.hypot(dx, dy);
        const ux = dx / len;
        const uy = dy / len;
        const pad = 18;
        const tA = rayExit(A.anchor.x, A.anchor.y, ux, uy, A.frame) + pad;
        const tB = rayExit(B.anchor.x, B.anchor.y, -ux, -uy, B.frame) + pad;
        if (tA + tB >= len) continue;
        this.routes.push({
          key,
          a: def.id,
          b: other,
          p: { x: A.anchor.x + ux * tA, y: A.anchor.y + uy * tA },
          q: { x: B.anchor.x - ux * tB, y: B.anchor.y - uy * tB },
          dist: len,
          cap: bearing(dx, dy),
        });
      }
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
  fitZoom(padding = 0.88) {
    return Math.min((this.sw * padding) / this.bounds.w, (this.sh * padding) / this.bounds.h);
  }
}
