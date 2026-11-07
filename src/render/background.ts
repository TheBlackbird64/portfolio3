import type { Geometry } from '../core/geometry';
import { FONT_MONO, getPalette } from '../core/theme';
import { fmtBearing, fmtInt, pad, smoothstep, type Cam, type Vec } from '../core/util';
import { ContourField } from './contours';

export interface SheetView {
  id: string;
  num: number;
  title: string;
  /** 1 = unexplored hatch fully visible, 0 = explored. */
  hatch: number;
}

export interface DrawState {
  cam: Cam;
  geo: Geometry;
  sheets: SheetView[];
  currentId: string;
  overview: boolean;
  hoverId: string | null;
  visitedRoutes: Set<string>;
  trail: { from: Vec; alpha: number } | null;
  /** Terrain parallax strength (0 when reduced motion). */
  parallax: number;
}

const PARALLAX = 0.72;

export class Background {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private dpr = 1;
  private w = 1;
  private h = 1;
  private contours = new ContourField();
  /** Global fade used by the intro. */
  intro = 0;
  /** Set when some tiles could not be computed this frame. */
  pending = false;

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

  /** Pre-compute every terrain tile visible from a given camera (used before the intro). */
  warm(cam: Cam, parallax: number) {
    const budget = { left: 400 };
    this.forEachTile(cam, parallax, (tx, ty) => this.contours.get(tx, ty, budget));
  }

  private forEachTile(cam: Cam, parallax: number, fn: (tx: number, ty: number) => void) {
    const zc = Math.pow(cam.z, 0.55);
    const P = PARALLAX * parallax + (1 - parallax);
    const T = this.contours.tile;
    const cx0 = cam.x * P - this.w / 2 / zc;
    const cx1 = cam.x * P + this.w / 2 / zc;
    const cy0 = cam.y * P - this.h / 2 / zc;
    const cy1 = cam.y * P + this.h / 2 / zc;
    for (let ty = Math.floor(cy0 / T); ty <= Math.floor(cy1 / T); ty++)
      for (let tx = Math.floor(cx0 / T); tx <= Math.floor(cx1 / T); tx++) fn(tx, ty);
  }

  draw(s: DrawState) {
    const { ctx, w, h, dpr } = this;
    const P = getPalette();
    const { cam, geo } = s;
    const z = cam.z;
    const ox = w / 2 - cam.x * z;
    const oy = h / 2 - cam.y * z;
    const lw = Math.max(1, Math.round(dpr)) / dpr;
    const snap = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = this.intro;
    this.pending = false;

    // Frames in screen space
    const frames = s.sheets.map((sv) => {
      const f = geo.get(sv.id).frame;
      const r = { sv, x: f.x * z + ox, y: f.y * z + oy, w: f.w * z, h: f.h * z };
      return { ...r, visible: r.x < w + 60 && r.x + r.w > -60 && r.y < h + 60 && r.y + r.h > -60 };
    });

    // 1 — paper
    ctx.fillStyle = P.paper;
    for (const f of frames) if (f.visible) ctx.fillRect(f.x, f.y, f.w, f.h);

    // 2 — unexplored hatch
    for (const f of frames) {
      if (!f.visible || f.sv.hatch <= 0.01) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(f.x, f.y, f.w, f.h);
      ctx.clip();
      ctx.globalAlpha = this.intro * f.sv.hatch;
      ctx.strokeStyle = P.hatch;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const step = 9;
      const x0 = Math.max(f.x, 0);
      const x1 = Math.min(f.x + f.w, w);
      const y0 = Math.max(f.y, 0);
      const y1 = Math.min(f.y + f.h, h);
      for (let k = x0 - (y1 - y0) - ((x0 + y0) % step); k < x1; k += step) {
        ctx.moveTo(k, y1);
        ctx.lineTo(k + (y1 - y0), y0);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = this.intro;

    // 3 — everything that lives "between" sheets
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    for (const f of frames) if (f.visible) ctx.rect(f.x, f.y, f.w, f.h);
    ctx.clip('evenodd');

    this.drawContours(cam, s.parallax, lw);
    this.drawGrid(z, ox, oy, lw, snap);
    this.drawRoutes(s, z, ox, oy, lw);

    if (s.trail && s.trail.alpha > 0.01) {
      ctx.globalAlpha = this.intro * s.trail.alpha;
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.trail.from.x * z + ox, s.trail.from.y * z + oy);
      ctx.lineTo(w / 2, h / 2);
      ctx.stroke();
      ctx.globalAlpha = this.intro;
    }
    ctx.restore();

    // 4 — frames, crop marks, labels
    ctx.font = `500 ${s.overview ? 11 : 10}px ${FONT_MONO}`;
    ctx.textBaseline = 'alphabetic';
    const showLabels = s.overview || geo.margin * z >= 26;
    for (const f of frames) {
      if (!f.visible) continue;
      const isCur = f.sv.id === s.currentId;
      const isHover = f.sv.id === s.hoverId;
      ctx.lineWidth = lw;
      ctx.strokeStyle = isHover ? P.accent : isCur && !s.overview ? P.line3 : P.frame;
      ctx.strokeRect(snap(f.x), snap(f.y), Math.round(f.w), Math.round(f.h));
      if (isHover) {
        ctx.fillStyle = P.accentSoft;
        ctx.fillRect(f.x, f.y, f.w, f.h);
      }

      // crop marks
      const o = 7;
      const L = 12;
      ctx.strokeStyle = isHover ? P.accent : P.ink3;
      ctx.beginPath();
      const X0 = snap(f.x);
      const Y0 = snap(f.y);
      const X1 = snap(f.x + f.w);
      const Y1 = snap(f.y + f.h);
      ctx.moveTo(X0 - o - L, Y0); ctx.lineTo(X0 - o, Y0);
      ctx.moveTo(X0, Y0 - o - L); ctx.lineTo(X0, Y0 - o);
      ctx.moveTo(X1 + o, Y0); ctx.lineTo(X1 + o + L, Y0);
      ctx.moveTo(X1, Y0 - o - L); ctx.lineTo(X1, Y0 - o);
      ctx.moveTo(X0 - o - L, Y1); ctx.lineTo(X0 - o, Y1);
      ctx.moveTo(X0, Y1 + o); ctx.lineTo(X0, Y1 + o + L);
      ctx.moveTo(X1 + o, Y1); ctx.lineTo(X1 + o + L, Y1);
      ctx.moveTo(X1, Y1 + o); ctx.lineTo(X1, Y1 + o + L);
      ctx.stroke();

      if (showLabels && f.y > -20 && f.y < h + 20) {
        const g = geo.get(f.sv.id);
        ctx.fillStyle = isHover ? P.accent : isCur ? P.ink2 : P.ink3;
        ctx.textAlign = 'left';
        ctx.fillText(`${pad(f.sv.num)} — ${f.sv.title.toUpperCase()}`, f.x, f.y - 12);
        if (f.w > 260) {
          ctx.textAlign = 'right';
          ctx.fillStyle = P.ink4;
          ctx.fillText(`X ${fmtInt(g.anchor.x)}  Y ${fmtInt(-g.anchor.y)}`, f.x + f.w, f.y - 12);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawContours(cam: Cam, parallax: number, lw: number) {
    const { ctx, dpr, w, h } = this;
    const P = getPalette();
    const zc = Math.pow(cam.z, 0.55);
    const par = PARALLAX * parallax + (1 - parallax);
    const fade = smoothstep(0.08, 0.3, cam.z);
    if (fade <= 0) return;
    const budget = { left: 6 };
    const tiles: { minor: Path2D; major: Path2D }[] = [];
    this.forEachTile(cam, parallax, (tx, ty) => {
      const t = this.contours.get(tx, ty, budget);
      if (t) tiles.push(t);
      else this.pending = true;
    });
    ctx.save();
    ctx.setTransform(dpr * zc, 0, 0, dpr * zc, dpr * (w / 2 - cam.x * par * zc), dpr * (h / 2 - cam.y * par * zc));
    ctx.lineWidth = lw / zc;
    ctx.globalAlpha = this.intro * fade;
    ctx.strokeStyle = P.contour;
    for (const t of tiles) ctx.stroke(t.minor);
    ctx.strokeStyle = P.contourMajor;
    for (const t of tiles) ctx.stroke(t.major);
    ctx.restore();
  }

  private drawGrid(z: number, ox: number, oy: number, lw: number, snap: (v: number) => number) {
    const { ctx, w, h } = this;
    const P = getPalette();

    // fine lines
    const fine = [40, 200, 1000].find((s) => s * z >= 9) ?? 1000;
    const a = smoothstep(9, 24, fine * z);
    if (a > 0.01) {
      ctx.globalAlpha = this.intro * a;
      ctx.strokeStyle = P.grid;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const wx0 = Math.floor(-ox / z / fine) * fine;
      const wy0 = Math.floor(-oy / z / fine) * fine;
      for (let x = wx0; x * z + ox < w; x += fine) {
        const X = snap(x * z + ox);
        ctx.moveTo(X, 0);
        ctx.lineTo(X, h);
      }
      for (let y = wy0; y * z + oy < h; y += fine) {
        const Y = snap(y * z + oy);
        ctx.moveTo(0, Y);
        ctx.lineTo(w, Y);
      }
      ctx.stroke();
    }

    // survey crosses
    const step = [200, 1000, 5000].find((s) => s * z >= 56) ?? 5000;
    ctx.globalAlpha = this.intro;
    ctx.strokeStyle = P.cross;
    ctx.lineWidth = lw;
    ctx.beginPath();
    const arm = 4;
    const cx0 = Math.floor(-ox / z / step) * step;
    const cy0 = Math.floor(-oy / z / step) * step;
    for (let x = cx0; x * z + ox < w + arm; x += step)
      for (let y = cy0; y * z + oy < h + arm; y += step) {
        const X = snap(x * z + ox);
        const Y = snap(y * z + oy);
        ctx.moveTo(X - arm, Y);
        ctx.lineTo(X + arm + 1, Y);
        ctx.moveTo(X, Y - arm);
        ctx.lineTo(X, Y + arm + 1);
      }
    ctx.stroke();
  }

  private drawRoutes(s: DrawState, z: number, ox: number, oy: number, lw: number) {
    const { ctx, w, h } = this;
    const P = getPalette();
    ctx.font = `500 10px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const r of s.geo.routes) {
      const px = r.p.x * z + ox;
      const py = r.p.y * z + oy;
      const qx = r.q.x * z + ox;
      const qy = r.q.y * z + oy;
      if (Math.max(px, qx) < -20 || Math.min(px, qx) > w + 20 || Math.max(py, qy) < -20 || Math.min(py, qy) > h + 20) continue;

      const visited = s.visitedRoutes.has(r.key);
      const len = Math.hypot(qx - px, qy - py);
      const ux = (qx - px) / len;
      const uy = (qy - py) / len;
      const label = `${fmtBearing(r.cap)} · ${fmtInt(r.dist)}`;
      const tw = ctx.measureText(label).width + 18;
      const mx = (px + qx) / 2;
      const my = (py + qy) / 2;

      ctx.strokeStyle = visited ? P.ink3 : P.ink4;
      ctx.lineWidth = lw;
      ctx.setLineDash(visited ? [] : [3, 5]);
      ctx.beginPath();
      if (len > tw + 30 && z > 0.12) {
        ctx.moveTo(px, py);
        ctx.lineTo(mx - (ux * tw) / 2, my - (uy * tw) / 2);
        ctx.moveTo(mx + (ux * tw) / 2, my + (uy * tw) / 2);
        ctx.lineTo(qx, qy);
      } else {
        ctx.moveTo(px, py);
        ctx.lineTo(qx, qy);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // dimension-line ends: perpendicular tick + architectural slash
      ctx.beginPath();
      for (const [ex, ey] of [
        [px, py],
        [qx, qy],
      ]) {
        ctx.moveTo(ex - uy * 6, ey + ux * 6);
        ctx.lineTo(ex + uy * 6, ey - ux * 6);
        const sx = (ux - uy) * 0.7071 * 5;
        const sy = (uy + ux) * 0.7071 * 5;
        ctx.moveTo(ex - sx, ey - sy);
        ctx.lineTo(ex + sx, ey + sy);
      }
      ctx.stroke();

      if (len > tw + 30 && z > 0.12) {
        let ang = Math.atan2(uy, ux);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.fillStyle = visited ? P.ink2 : P.ink3;
        ctx.fillText(label, 0, 0.5);
        ctx.restore();
      }
    }
    ctx.textBaseline = 'alphabetic';
  }
}
