import type { Geometry } from '../core/geometry';
import { FONT_MONO, getPalette } from '../core/theme';
import { ARROW, fmtInt, pad, type Cam } from '../core/util';
import type { SheetDef } from '../sheets/registry';

export interface HudView {
  cam: Cam;
  geo: Geometry;
  currentId: string;
  overview: boolean;
  traveling: boolean;
  /** Pointer in stage coordinates. */
  pointer: { x: number; y: number; inside: boolean };
  visited: Set<string>;
}

const STEPS = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
const niceStep = (z: number, minPx: number) => STEPS.find((s) => s * z >= minPx) ?? STEPS[STEPS.length - 1];

function setupCanvas(c: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, dpr };
}

/* ----------------------------------------------------------------- rulers */

export class Rulers {
  private topCtx!: CanvasRenderingContext2D;
  private leftCtx!: CanvasRenderingContext2D;
  private dpr = 1;
  private len = { x: 1, y: 1 };
  private th = 20;

  constructor(
    private top: HTMLCanvasElement,
    private left: HTMLCanvasElement,
  ) {}

  resize(sw: number, sh: number, thickness: number) {
    this.th = thickness;
    this.len = { x: sw, y: sh };
    const a = setupCanvas(this.top, sw, thickness);
    const b = setupCanvas(this.left, thickness, sh);
    this.topCtx = a.ctx;
    this.leftCtx = b.ctx;
    this.dpr = a.dpr;
  }

  draw(v: HudView) {
    if (!this.topCtx || this.th <= 0) return;
    const f = v.geo.get(v.currentId).frame;
    const band = v.overview ? null : f;
    this.drawOne(this.topCtx, true, v.cam.x, v.cam.z, band ? [band.x, band.x + band.w] : null, v.pointer.inside ? v.pointer.x : null);
    this.drawOne(this.leftCtx, false, v.cam.y, v.cam.z, band ? [band.y, band.y + band.h] : null, v.pointer.inside ? v.pointer.y : null);
  }

  private drawOne(ctx: CanvasRenderingContext2D, horiz: boolean, center: number, z: number, band: [number, number] | null, cursor: number | null) {
    const P = getPalette();
    const len = horiz ? this.len.x : this.len.y;
    const th = this.th;
    const dpr = this.dpr;
    const snap = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;
    const toS = (w: number) => (w - center) * z + len / 2;
    ctx.clearRect(0, 0, horiz ? len : th, horiz ? th : len);

    if (band) {
      const a = Math.max(toS(band[0]), 0);
      const b = Math.min(toS(band[1]), len);
      if (b > a) {
        ctx.fillStyle = P.line;
        if (horiz) ctx.fillRect(a, 0, b - a, th);
        else ctx.fillRect(0, a, th, b - a);
        ctx.fillStyle = P.accent;
        for (const e of [toS(band[0]), toS(band[1])]) {
          if (e < 0 || e > len) continue;
          if (horiz) ctx.fillRect(e - 0.5, 0, 1.5, th);
          else ctx.fillRect(0, e - 0.5, th, 1.5);
        }
      }
    }

    const major = niceStep(z, 76);
    const lead = String(major)[0];
    const sub = lead === '2' ? 4 : lead === '5' ? 5 : 10;
    const minor = major / sub;
    const w0 = center - len / 2 / z;
    const w1 = center + len / 2 / z;

    ctx.strokeStyle = P.ink4;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    const i0 = Math.floor(w0 / minor);
    const i1 = Math.ceil(w1 / minor);
    for (let i = i0; i <= i1; i++) {
      const s = snap(toS(i * minor));
      const t = i % sub === 0 ? th * 0.5 : sub % 2 === 0 && i % (sub / 2) === 0 ? th * 0.32 : th * 0.18;
      if (horiz) {
        ctx.moveTo(s, th);
        ctx.lineTo(s, th - t);
      } else {
        ctx.moveTo(th, s);
        ctx.lineTo(th - t, s);
      }
    }
    ctx.stroke();

    ctx.fillStyle = P.ink3;
    ctx.font = `500 9px ${FONT_MONO}`;
    ctx.textBaseline = 'alphabetic';
    for (let i = Math.floor(w0 / major); i <= Math.ceil(w1 / major); i++) {
      const value = i * major;
      const s = toS(value);
      const label = fmtInt(horiz ? value : -value);
      if (horiz) {
        ctx.textAlign = 'left';
        ctx.fillText(label, s + 3, 9);
      } else {
        ctx.save();
        ctx.translate(9, s - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'right';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }

    if (cursor !== null) {
      ctx.fillStyle = P.accent;
      if (horiz) ctx.fillRect(Math.round(cursor), 0, 1, th);
      else ctx.fillRect(0, Math.round(cursor), th, 1);
    }
  }
}

/* ---------------------------------------------------------------- minimap */

export class Minimap {
  private ctx!: CanvasRenderingContext2D;
  private w = 184;
  private h = 80;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private hover: string | null = null;
  private geo: Geometry | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private onSelect: (id: string) => void,
    private titles: Map<string, string>,
  ) {
    canvas.addEventListener('click', (e) => {
      const id = this.hitAt(e);
      if (id) this.onSelect(id);
    });
    canvas.addEventListener('pointermove', (e) => {
      const id = this.hitAt(e);
      if (id !== this.hover) {
        this.hover = id;
        canvas.style.cursor = id ? 'pointer' : 'default';
        canvas.title = id ? (this.titles.get(id) ?? '') : '';
      }
    });
  }

  private hitAt(e: MouseEvent) {
    if (!this.geo) return null;
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - this.ox) / this.scale;
    const y = (e.clientY - r.top - this.oy) / this.scale;
    return this.geo.hit(x, y, 6 / this.scale);
  }

  layout(geo: Geometry) {
    this.geo = geo;
    const b = geo.bounds;
    const pad = 8;
    const top = 16; // room for the label row
    const maxW = 190;
    const maxH = 74;
    this.scale = Math.min((maxW - pad * 2) / b.w, (maxH - pad - top) / b.h);
    this.w = Math.round(b.w * this.scale + pad * 2);
    this.h = Math.round(b.h * this.scale + pad + top);
    this.ox = pad - b.x * this.scale;
    this.oy = top - b.y * this.scale;
    this.ctx = setupCanvas(this.canvas, this.w, this.h).ctx;
  }

  draw(v: HudView) {
    if (!this.ctx) return;
    const { ctx, scale: s, ox, oy } = this;
    const P = getPalette();
    ctx.clearRect(0, 0, this.w, this.h);

    ctx.strokeStyle = P.ink4;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    for (const r of v.geo.routes) {
      ctx.moveTo(r.p.x * s + ox, r.p.y * s + oy);
      ctx.lineTo(r.q.x * s + ox, r.q.y * s + oy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    for (const [id, g] of v.geo.map) {
      const f = g.frame;
      const x = Math.round(f.x * s + ox) + 0.5;
      const y = Math.round(f.y * s + oy) + 0.5;
      const w = Math.round(f.w * s);
      const h = Math.round(f.h * s);
      const cur = id === v.currentId;
      if (cur) {
        ctx.fillStyle = P.accentSoft;
        ctx.fillRect(x, y, w, h);
      } else if (v.visited.has(id)) {
        ctx.fillStyle = P.line;
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeStyle = cur ? P.accent : id === this.hover ? P.ink2 : P.ink4;
      ctx.strokeRect(x, y, w, h);
    }

    // viewport
    const vw = v.geo.sw / v.cam.z;
    const vh = v.geo.sh / v.cam.z;
    const vx = (v.cam.x - vw / 2) * s + ox;
    const vy = (v.cam.y - vh / 2) * s + oy;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.round(vw * s), Math.round(vh * s));
    ctx.fillStyle = P.accent;
    ctx.fillRect(Math.round(v.cam.x * s + ox) - 1, Math.round(v.cam.y * s + oy) - 1, 3, 3);
  }
}

/* ----------------------------------------------------------- edge markers */

type Side = 'l' | 'r' | 't' | 'b';

export class EdgeMarkers {
  private items = new Map<string, HTMLButtonElement>();
  private sizes = new Map<string, { w: number; h: number }>();
  private active: string[] = [];
  /** Area markers must stay out of (the minimap), in stage coordinates. */
  avoid: { x: number; y: number; w: number; h: number } | null = null;

  constructor(root: HTMLElement, defs: SheetDef[], onGo: (id: string) => void) {
    for (const d of defs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'edge';
      b.tabIndex = -1;
      b.setAttribute('aria-label', `Aller à ${d.title}`);
      b.innerHTML = `<span class="edge__arrow">${ARROW}</span><span class="edge__num">${pad(d.num)}</span><span class="edge__title">${d.title}</span><span class="edge__dist"></span>`;
      b.addEventListener('click', () => onGo(d.id));
      root.appendChild(b);
      this.items.set(d.id, b);
    }
  }

  measure() {
    for (const [id, el] of this.items) this.sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
  }

  show(ids: string[]) {
    this.active = ids;
    let i = 0;
    for (const [id, el] of this.items) {
      const on = ids.includes(id);
      el.style.transitionDelay = on ? `${120 + i++ * 70}ms` : '0ms';
      el.classList.toggle('is-on', on);
      el.tabIndex = on ? 0 : -1;
    }
  }

  hide() {
    this.active = [];
    for (const el of this.items.values()) {
      el.style.transitionDelay = '0ms';
      el.classList.remove('is-on');
      el.tabIndex = -1;
    }
  }

  /**
   * Markers live in the margin band around the current sheet, like the
   * "continued on sheet 12 →" notes printed in an atlas. Side markers run along the edge.
   */
  update(v: HudView) {
    if (!this.active.length) return;
    const { sw, sh } = v.geo;
    const band = Math.max(v.geo.margin, 30);
    const c = band / 2;
    const hw = sw / 2 - c;
    const hh = sh / 2 - c;
    const edgePad = 10;
    // When a tall sheet is scrolled, its content covers the top/bottom bands:
    // markers then slide to the side bands (the arrow still points the true way).
    const f = v.geo.get(v.currentId).frame;
    const topFree = (f.y - v.cam.y) * v.cam.z + sh / 2 > band * 0.6;
    const bottomFree = (f.y + f.h - v.cam.y) * v.cam.z + sh / 2 < sh - band * 0.6;
    const placed: { cx: number; cy: number; bw: number; bh: number }[] = [];
    for (const id of this.active) {
      const el = this.items.get(id)!;
      const a = v.geo.get(id).anchor;
      const dx = a.x - v.cam.x;
      const dy = a.y - v.cam.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const tx = Math.abs(ux) > 1e-6 ? hw / Math.abs(ux) : Infinity;
      const ty = Math.abs(uy) > 1e-6 ? hh / Math.abs(uy) : Infinity;
      const t = Math.min(tx, ty);
      let side: Side = tx < ty ? (ux > 0 ? 'r' : 'l') : uy > 0 ? 'b' : 't';
      let pinned: 'top' | 'bottom' | null = null;
      if ((side === 't' && !topFree) || (side === 'b' && !bottomFree)) {
        pinned = side === 't' ? 'top' : 'bottom';
        side = ux >= 0 ? 'r' : 'l';
      }
      const { w, h } = this.sizes.get(id) ?? { w: 120, h: 28 };
      const vertical = side === 'l' || side === 'r';
      const rot = side === 'l' ? -90 : side === 'r' ? 90 : 0;
      // occupied box once rotated
      const bw = vertical ? h : w;
      const bh = vertical ? w : h;
      let cx: number;
      let cy: number;
      if (vertical) {
        cx = side === 'l' ? c : sw - c;
        const yMin = bh / 2 + edgePad;
        const yMax = sh - bh / 2 - edgePad;
        cy = pinned === 'top' ? yMin : pinned === 'bottom' ? yMax : Math.min(Math.max(sh / 2 + uy * t, yMin), yMax);
      } else {
        cy = side === 't' ? c : sh - c;
        cx = Math.min(Math.max(sw / 2 + ux * t, bw / 2 + edgePad), sw - bw / 2 - edgePad);
      }
      const av = this.avoid;
      if (av && cx - bw / 2 < av.x + av.w + 8 && cx + bw / 2 > av.x - 8 && cy - bh / 2 < av.y + av.h + 8 && cy + bh / 2 > av.y - 8) {
        if (vertical) cy = av.y - bh / 2 - 10;
        else cx = av.x - bw / 2 - 10;
      }
      // never stack two markers: slide along the edge, toward the middle
      for (let k = 0; k < 4; k++) {
        const hit = placed.find((p) => Math.abs(p.cx - cx) < (p.bw + bw) / 2 + 6 && Math.abs(p.cy - cy) < (p.bh + bh) / 2 + 6);
        if (!hit) break;
        if (vertical) cy = cy >= sh / 2 ? hit.cy - (hit.bh + bh) / 2 - 8 : hit.cy + (hit.bh + bh) / 2 + 8;
        else cx = cx >= sw / 2 ? hit.cx - (hit.bw + bw) / 2 - 8 : hit.cx + (hit.bw + bw) / 2 + 8;
      }
      placed.push({ cx, cy, bw, bh });
      el.style.transform = `translate3d(${Math.round(cx - w / 2)}px, ${Math.round(cy - h / 2)}px, 0) rotate(${rot}deg)`;
      el.dataset.side = side;
      el.style.setProperty('--a', `${(Math.atan2(uy, ux) * 180) / Math.PI - rot}deg`);
      const dist = el.querySelector('.edge__dist')!;
      const txt = fmtInt(len);
      if (dist.textContent !== txt) dist.textContent = txt;
    }
  }
}

/* ------------------------------------------------------------- status bar */

export class Status {
  private x: HTMLElement;
  private y: HTMLElement;
  private z: HTMLElement;
  private cx: HTMLElement;
  private cy: HTMLElement;
  private bar: HTMLElement;
  private barLabel: HTMLElement;
  private last = '';

  constructor(root: HTMLElement) {
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.x = q('[data-x]');
    this.y = q('[data-y]');
    this.z = q('[data-z]');
    this.cx = q('[data-cx]');
    this.cy = q('[data-cy]');
    this.bar = q('[data-scalebar]');
    this.barLabel = q('[data-scale-label]');
  }

  update(v: HudView, scaleEls: HTMLElement[]) {
    const { cam } = v;
    const zt = cam.z.toFixed(2).replace('.', ',');
    const key = `${Math.round(cam.x)}|${Math.round(cam.y)}|${zt}`;
    if (key !== this.last) {
      this.last = key;
      this.x.textContent = fmtInt(cam.x);
      this.y.textContent = fmtInt(-cam.y);
      this.z.textContent = zt;
      const L = STEPS.find((s) => s * cam.z >= 44) ?? 50000;
      this.bar.style.width = `${Math.round(L * cam.z)}px`;
      this.barLabel.textContent = `${fmtInt(L)} px`;
      const scale = cam.z >= 0.995 ? '1:1' : `1:${(1 / cam.z).toFixed(cam.z > 0.5 ? 2 : 1).replace('.', ',')}`;
      for (const el of scaleEls) el.textContent = scale;
    }
    if (v.pointer.inside) {
      const wx = cam.x + (v.pointer.x - v.geo.sw / 2) / cam.z;
      const wy = cam.y + (v.pointer.y - v.geo.sh / 2) / cam.z;
      this.cx.textContent = fmtInt(wx);
      this.cy.textContent = fmtInt(-wy);
    }
  }
}
