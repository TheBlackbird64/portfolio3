import type { Geometry } from '../core/geometry';
import { FONT_MONO, getPalette } from '../core/theme';
import { clamp, pad, rng, smoothstep, type Cam } from '../core/util';
import type { Hue, SheetDef } from '../sheets/registry';
import { NET_ALPHA, NetworkField } from './network';

/*
 * Abstract background: slowly drifting rectangles, gathered in two opposite
 * corners of every sheet (in that sheet's colour), plus a sparse field in between.
 * Every shape lives at its own depth, so camera moves produce parallax.
 */

const enum Kind {
  Stroke,
  Fill,
  Solid,
  Gradient,
  Dots,
  Glow,
}

interface Deco {
  /** Sheet the shape belongs to (coordinates are relative to its anchor), or null for absolute world coordinates. */
  home: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Depth: < 1 behind (slower), > 1 in front (faster). */
  d: number;
  kind: Kind;
  hue: Hue | null;
  alpha: number;
  ax: number;
  ay: number;
  phase: number;
  speed: number;
  /** Direction pointing away from the cluster corner (for gradients). */
  ix: number;
  iy: number;
  /**
   * Far backdrop layer: coordinates are in the layer's own (compressed) space and
   * the depth is applied as is, so these planes always lag far behind the camera.
   */
  deep?: boolean;
}

/** Global knob for the far backdrop rectangle planes. Raise it to make them more visible. */
const BACKDROP_ALPHA = 2.3;

export interface DrawState {
  cam: Cam;
  geo: Geometry;
  sheets: SheetDef[];
  overview: boolean;
  hoverId: string | null;
  time: number;
  /** 0 when reduced motion is requested. */
  motion: number;
}

const snap8 = (v: number) => Math.round(v / 8) * 8;

function rgba(color: string, a: number) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export class Background {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private dpr = 1;
  private w = 1;
  private h = 1;
  private decos: Deco[] = [];
  private field = new NetworkField();
  /** Global fade used by the intro. */
  intro = 0;

  constructor() {
    this.canvas.className = 'bg-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /* ------------------------------------------------------------ composition */

  build(geo: Geometry, sheets: SheetDef[]) {
    const out: Deco[] = [];
    const { sw, sh } = geo;
    const s = clamp(Math.min(sw / 1440, sh / 900), 0.5, 1.25);

    for (const def of sheets) {
      const g = geo.get(def.id);
      const rnd = rng(9173 + def.num * 7919);
      const top = -sh / 2;
      const bottom = g.maxScroll + sh / 2;
      // alternate the diagonal from one sheet to the next
      const corners: [number, number][] =
        def.num % 2 === 0
          ? [
              [sw / 2, top],
              [-sw / 2, bottom],
            ]
          : [
              [-sw / 2, top],
              [sw / 2, bottom],
            ];
      const band = { x: geo.margin, top: geo.insetTop, bottom: geo.insetBottom };
      for (const [cx, cy] of corners) this.cluster(out, def, cx, cy, -Math.sign(cx), cy < 0 ? 1 : -1, rnd, s, geo.compact, band);

      // tall sheets: a few small shapes in the side margins, so scrolling has depth too
      const steps = Math.floor(g.maxScroll / (sh * 0.8));
      for (let k = 1; k <= steps; k++) {
        const side = k % 2 ? 1 : -1;
        const y = top + k * sh * 0.8 + (rnd() - 0.5) * 160;
        const x = side * (sw / 2 - geo.margin * (0.3 + rnd() * 0.3));
        const base = { home: def.id, ax: 4 + rnd() * 6, ay: 6 + rnd() * 8, phase: rnd() * 6.28, speed: 0.25 + rnd() * 0.3, ix: -side, iy: 1 };
        const sz = snap8(14 + rnd() * 18) || 8;
        out.push({ ...base, x: x - sz / 2, y, w: sz, h: sz, d: 1.25 + rnd() * 0.15, kind: Kind.Stroke, hue: null, alpha: 0.3 });
        out.push({ ...base, x: x + side * -18, y: y + sz + 14, w: 5, h: 5, d: 1.38, kind: Kind.Solid, hue: def.hue, alpha: 0.9 });
        if (rnd() < 0.5) out.push({ ...base, x: x + side * 10, y: y - 120, w: 1, h: snap8(60 + rnd() * 100), d: 1.12, kind: Kind.Fill, hue: null, alpha: 0.22 });
      }
    }

    // sparse field between sheets
    const rnd = rng(424242);
    const b = geo.bounds;
    const cell = 560;
    for (let x = b.x - 1400; x < b.x + b.w + 1400; x += cell)
      for (let y = b.y - 1000; y < b.y + b.h + 1000; y += cell) {
        if (rnd() > 0.6) continue;
        const px = x + rnd() * cell;
        const py = y + rnd() * cell;
        if (geo.hit(px, py, 80)) continue;
        const r = rnd();
        const d = 0.55 + rnd() * 0.9;
        const base = { home: null, x: px, y: py, d, ax: 4 + rnd() * 10, ay: 4 + rnd() * 10, phase: rnd() * 6.28, speed: 0.15 + rnd() * 0.3, ix: 1, iy: 1, hue: null };
        const o = 0.6 + 0.6 * d; // nearer = less transparent
        if (r < 0.5) out.push({ ...base, w: 4, h: 4, kind: Kind.Solid, alpha: 0.32 * o });
        else if (r < 0.85) {
          const sz = 10 + rnd() * 18;
          out.push({ ...base, w: sz, h: sz, kind: Kind.Stroke, alpha: 0.18 * o });
        } else out.push({ ...base, w: 40 + rnd() * 90, h: 1, kind: Kind.Fill, alpha: 0.18 * o });
      }

    this.backdrop(out, geo, sheets, s);
    this.field.build(geo, sheets, s);

    // draw far shapes first
    this.decos = out.sort((a, b) => a.d - b.d);
  }

  /**
   * Several faint planes of rectangles spread over the whole canvas, each one further away:
   * when the camera travels from one sheet to the next, the far planes barely move.
   */
  private backdrop(out: Deco[], geo: Geometry, sheets: SheetDef[], s: number) {
    const { sw, sh, bounds: b } = geo;
    const k = geo.compact ? 0.65 : 1;
    const anchors = sheets.map((def) => ({ hue: def.hue, ...geo.get(def.id).anchor }));
    const nearestHue = (x: number, y: number) => {
      let best = anchors[0];
      let bd = Infinity;
      for (const a of anchors) {
        const dd = (a.x - x) ** 2 + (a.y - y) ** 2;
        if (dd < bd) {
          bd = dd;
          best = a;
        }
      }
      return best.hue;
    };

    // `opacity`: nearer planes are less transparent
    const layers = [
      { d: 0.16, cell: 560, keep: 0.5, seed: 101, opacity: 0.85 },
      { d: 0.32, cell: 420, keep: 0.55, seed: 202, opacity: 1.2 },
      { d: 0.5, cell: 320, keep: 0.55, seed: 303, opacity: 1.6 },
    ];
    for (const [li, L] of layers.entries()) {
      const rnd = rng(L.seed);
      const R = (a: number, c: number) => a + (c - a) * rnd();
      const cell = L.cell * s * k;
      // the camera only sweeps `bounds * d` of this plane, plus one screen around it
      const x0 = b.x * L.d - sw * 1.5;
      const x1 = (b.x + b.w) * L.d + sw * 1.5;
      const y0 = b.y * L.d - sh * 1.5;
      const y1 = (b.y + b.h) * L.d + sh * 1.5;
      for (let gx = x0; gx < x1; gx += cell)
        for (let gy = y0; gy < y1; gy += cell) {
          if (rnd() > L.keep) continue;
          const px = snap8(gx + R(0, cell * 0.6));
          const py = snap8(gy + R(0, cell * 0.6));
          const tinted = rnd() < 0.4;
          const hue = tinted ? nearestHue(px / L.d, py / L.d) : null;
          const base = {
            home: null,
            d: L.d + R(-0.03, 0.03),
            ax: R(1, 4),
            ay: R(1, 5),
            phase: R(0, 6.28),
            speed: R(0.08, 0.2),
            ix: 1,
            iy: 1,
            deep: true,
            hue,
          };
          const sz = (a: number, c: number) => Math.max(8, snap8(R(a, c) * s * k));
          const tint = (tinted ? 1.8 : 1) * L.opacity;
          const r = rnd();
          if (li === 0) {
            // far: large soft panels, sometimes outlined
            const w = sz(180, 440);
            const h = sz(120, 320);
            out.push({ ...base, x: px, y: py, w, h, kind: Kind.Fill, alpha: 0.022 * tint });
            if (r < 0.45) out.push({ ...base, x: px, y: py, w, h, kind: Kind.Stroke, alpha: 0.05 * tint });
          } else if (li === 1) {
            // middle: outlined frames, a few panels and dot grids
            if (r < 0.6) out.push({ ...base, x: px, y: py, w: sz(80, 240), h: sz(60, 180), kind: Kind.Stroke, alpha: 0.065 * tint });
            else if (r < 0.85) out.push({ ...base, x: px, y: py, w: sz(60, 160), h: sz(40, 120), kind: Kind.Fill, alpha: 0.03 * tint });
            else out.push({ ...base, x: px, y: py, w: sz(48, 96), h: sz(32, 64), kind: Kind.Dots, alpha: 0.1 * L.opacity });
          } else {
            // nearest backdrop plane: small frames, hairlines and specks
            if (r < 0.55) {
              const q = sz(24, 96);
              out.push({ ...base, x: px, y: py, w: q, h: rnd() < 0.5 ? q : sz(16, 64), kind: Kind.Stroke, alpha: 0.085 * tint });
            } else if (r < 0.75) out.push({ ...base, x: px, y: py, w: sz(60, 200), h: 1, kind: Kind.Fill, alpha: 0.07 * L.opacity });
            else out.push({ ...base, x: px, y: py, w: 4, h: 4, kind: Kind.Solid, alpha: (tinted ? 0.3 : 0.12) * L.opacity });
          }
        }
    }
  }

  private cluster(
    out: Deco[],
    def: SheetDef,
    cx: number,
    cy: number,
    ix: number,
    iy: number,
    rnd: () => number,
    s: number,
    compact: boolean,
    band: { x: number; top: number; bottom: number },
  ) {
    const R = (a: number, b: number) => a + (b - a) * rnd();
    const k = compact ? 0.6 : 1;
    const bandY = iy > 0 ? band.top : band.bottom;
    /**
     * px, py: distance of the rect's near corner from the cluster corner, measured inward.
     * `edge` shapes are kept inside the margins so they never sit on top of the text.
     */
    const add = (px: number, py: number, w: number, h: number, d: number, kind: Kind, hue: Hue | null, alpha: number, drift = 1, edge = false) => {
      const W = Math.max(1, snap8(w * s * k) || w);
      const H = Math.max(1, snap8(h * s * k) || h);
      let qx = px * s * k;
      let qy = py * s * k;
      if (edge && qx + W > band.x - 6 && qy + H > bandY - 6) {
        if (rnd() < 0.5) qx = R(-W * 0.3, Math.max(0, band.x - W - 10));
        else qy = R(-H * 0.3, Math.max(0, bandY - H - 10));
      }
      const nx = cx + ix * qx;
      const ny = cy + iy * qy;
      out.push({
        home: def.id,
        x: ix > 0 ? snap8(nx) : snap8(nx) - W,
        y: iy > 0 ? snap8(ny) : snap8(ny) - H,
        w: W,
        h: H,
        d,
        kind,
        hue,
        alpha,
        ax: R(2, 7) * drift,
        ay: R(3, 9) * drift,
        phase: R(0, 6.28),
        speed: R(0.18, 0.42),
        ix,
        iy,
      });
    };

    out.push({ home: def.id, x: cx, y: cy, w: R(340, 480) * s * k, h: 0, d: 0.7, kind: Kind.Glow, hue: def.hue, alpha: 0.14, ax: 6, ay: 6, phase: R(0, 6.28), speed: 0.12, ix, iy });
    // soft, large pieces may run under the content
    add(R(-90, -20), R(-110, -30), R(240, 360), R(260, 400), 0.78, Kind.Gradient, def.hue, R(0.22, 0.3), 0.6);
    add(R(20, 70), R(30, 90), R(150, 240), R(110, 190), 0.88, Kind.Stroke, null, 0.12, 0.8);
    add(R(-30, 30), R(120, 200), R(70, 140), R(50, 90), 0.95, Kind.Fill, def.hue, 0.14);
    // crisp pieces stay in the margins
    add(R(120, 260), R(10, 60), R(60, 110), R(40, 70), 1.0, Kind.Stroke, def.hue, 0.5, 1, true);
    add(R(10, 50), R(150, 240), 64, 40, 1.06, Kind.Dots, null, 0.4, 1, true);
    const sq = R(16, 34);
    add(R(30, 160), R(30, 160), sq, sq, 1.18, Kind.Solid, def.hue, 0.95, 1, true);
    for (let i = 0; i < 3; i++) {
      const sz = R(10, 22);
      add(R(20, 280), R(20, 280), sz, sz, R(1.1, 1.3), Kind.Stroke, null, 0.3, 1.4, true);
    }
    for (let i = 0; i < 3; i++) add(R(20, 300), R(20, 300), 5, 5, R(1.15, 1.4), Kind.Solid, rnd() < 0.5 ? def.hue : null, 0.85, 1.6, true);
  }

  /* ----------------------------------------------------------------- draw */

  draw(st: DrawState) {
    const { ctx, w, h, dpr } = this;
    const P = getPalette();
    const { cam, geo } = st;
    const z = cam.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pf = smoothstep(0.22, 0.75, z) * st.motion;
    const t = st.time * st.motion;
    const fade = this.intro * (st.overview ? 0.55 : 1);
    // backdrop planes only cover what the camera sees near zoom 1: hide them when zoomed far out
    const deepFade = smoothstep(0.3, 0.6, z);
    const anchors = new Map<string, { x: number; y: number }>();
    for (const [id, g] of geo.map) anchors.set(id, g.anchor);

    // networks sit behind every rectangle (they still move with their own depth)
    const netAlpha = fade * deepFade * NET_ALPHA;
    if (netAlpha > 0.01) this.field.draw(ctx, w, h, cam, P, t, st.motion, netAlpha);
    for (const r of this.decos) {
      if (r.deep && deepFade < 0.01) continue;
      const d = r.deep ? r.d : 1 + (r.d - 1) * pf;
      const zE = Math.pow(z, d);
      let ox: number;
      let oy: number;
      if (r.home) {
        const A = anchors.get(r.home)!;
        ox = (A.x - cam.x) * z * d;
        oy = (A.y - cam.y) * z * d;
      } else {
        ox = -cam.x * z * d;
        oy = -cam.y * z * d;
      }
      const dx = r.ax * Math.sin(t * r.speed + r.phase);
      const dy = r.ay * Math.cos(t * r.speed * 0.83 + r.phase * 1.7);
      const x = w / 2 + ox + (r.x + dx) * zE;
      const y = h / 2 + oy + (r.y + dy) * zE;
      const color = r.hue ? P.hues[r.hue] : P.deco;
      const a = r.alpha * (0.8 + 0.2 * Math.sin(t * r.speed * 0.7 + r.phase * 2.3)) * fade * (r.deep ? deepFade * BACKDROP_ALPHA : 1);
      if (a < 0.004) continue;

      if (r.kind === Kind.Glow) {
        const rad = r.w * zE;
        if (x + rad < 0 || x - rad > w || y + rad < 0 || y - rad > h) continue;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, rgba(color, a));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        continue;
      }

      const rw = Math.max(r.w * zE, r.w === 1 ? 1 : 0.5);
      const rh = Math.max(r.h * zE, r.h === 1 ? 1 : 0.5);
      if (x > w || y > h || x + rw < 0 || y + rh < 0) continue;

      switch (r.kind) {
        case Kind.Stroke: {
          ctx.globalAlpha = a;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(rw), Math.round(rh));
          break;
        }
        case Kind.Fill:
        case Kind.Solid: {
          ctx.globalAlpha = a;
          ctx.fillStyle = color;
          ctx.fillRect(x, y, rw, rh);
          break;
        }
        case Kind.Gradient: {
          const sx = r.ix > 0 ? x : x + rw;
          const sy = r.iy > 0 ? y : y + rh;
          const g = ctx.createLinearGradient(sx, sy, sx + r.ix * rw, sy + r.iy * rh);
          g.addColorStop(0, rgba(color, a));
          g.addColorStop(1, rgba(color, 0));
          ctx.globalAlpha = 1;
          ctx.fillStyle = g;
          ctx.fillRect(x, y, rw, rh);
          break;
        }
        case Kind.Dots: {
          ctx.globalAlpha = a;
          ctx.fillStyle = color;
          const step = 12 * zE;
          if (step < 3) break;
          const ds = Math.max(1, 2 * zE);
          for (let i = 0; i * step <= rw; i++) for (let j = 0; j * step <= rh; j++) ctx.fillRect(x + i * step, y + j * step, ds, ds);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;

    // sheet outlines and names, only once zoomed out enough to need them
    const ov = 1 - smoothstep(0.32, 0.72, z);
    if (ov > 0.01) {
      const ox = w / 2 - cam.x * z;
      const oy = h / 2 - cam.y * z;
      ctx.font = `500 11px ${FONT_MONO}`;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      for (const def of st.sheets) {
        const f = geo.get(def.id).frame;
        const x = Math.round(f.x * z + ox) + 0.5;
        const y = Math.round(f.y * z + oy) + 0.5;
        const fw = Math.round(f.w * z);
        const fh = Math.round(f.h * z);
        if (x > w || y > h || x + fw < 0 || y + fh < 0) continue;
        const hover = def.id === st.hoverId;
        const hue = P.hues[def.hue];
        ctx.globalAlpha = ov * this.intro;
        ctx.strokeStyle = hover ? hue : P.line3;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, fw, fh);
        if (hover) {
          ctx.fillStyle = rgba(hue, 0.08);
          ctx.fillRect(x, y, fw, fh);
        }
        ctx.fillStyle = hue;
        ctx.fillRect(x - 0.5, y - 0.5, 6, 6);
        ctx.fillStyle = hover ? P.ink : P.ink3;
        ctx.fillText(`${pad(def.num)}  ${def.title.toUpperCase()}`, x, y - 10);
      }
      ctx.globalAlpha = 1;
    }
  }
}
