import type { Geometry } from '../core/geometry';
import type { Palette } from '../core/theme';
import { rng, smoothstep, type Cam } from '../core/util';
import type { Hue, SheetDef } from '../sheets/registry';

/*
 * Network field: nodes and links spread over several far planes, everywhere in the
 * background. A low-frequency noise thins them out, so some areas are dense, others
 * sparse or empty. Nodes drift, and links stretch and fade when their nodes move apart.
 */

/** Global strength of the networks. Raise it to make them more visible. */
export const NET_ALPHA = 1;

/**
 * Planes, from far to near. `spacing`: mean distance between two nodes (px at zoom 1).
 * Near planes are looser, with bigger nodes, thicker links and stronger colour.
 */
const PLANES = [
  { d: 0.18, spacing: 210, seed: 707 },
  { d: 0.36, spacing: 280, seed: 808 },
  { d: 0.6, spacing: 360, seed: 909 },
];

/** Size of the dense / empty patches (px at zoom 1). */
const PATCH = 820;

/** Colour index: 0 = neutral, then one per hue. */
const HUES: Hue[] = ['orange', 'violet', 'blue', 'red'];
const COLORS = HUES.length + 1;
const LEVELS = 4;
const TAU = Math.PI * 2;

interface Plane {
  d: number;
  /** Nearness, 0 (farthest plane) to 1 (nearest). */
  q: number;
  n: number;
  x: Float32Array;
  y: Float32Array;
  ax: Float32Array;
  ay: Float32Array;
  phase: Float32Array;
  speed: Float32Array;
  color: Uint8Array;
  /** Drawn as a bigger dot. */
  hub: Uint8Array;
  /** Flat list of node pairs. */
  edges: Uint32Array;
  /** Links longer than this (plane units) fade out completely. */
  reach: number;
  /** Largest node drift, for culling. */
  amp: number;
  /** Slow sway of the whole plane. */
  flow: { ax: number; ay: number; phase: number };
  sx: Float32Array;
  sy: Float32Array;
  vis: Uint8Array;
}

function hash(ix: number, iy: number, seed: number) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const fbm = (x: number, y: number, seed: number) => noise(x, y, seed) * 0.65 + noise(x * 2.3 + 17.1, y * 2.3 - 4.7, seed + 1) * 0.35;

export class NetworkField {
  private planes: Plane[] = [];
  /** Nodes and links are drawn a bit finer on phones. */
  private size = 1;
  /** Edges grouped by strength level and colour, so they can be stroked in a few batches. */
  private buckets: number[][] = Array.from({ length: LEVELS * COLORS }, () => []);

  build(geo: Geometry, sheets: SheetDef[], s: number) {
    const { sw, sh, bounds: b } = geo;
    this.size = geo.compact ? 0.75 : 1;
    // the spacing barely shrinks with the screen: a phone shows as many nodes per area as a desktop
    const spread = Math.max(s * (geo.compact ? 0.7 : 1), 0.85);
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

    this.planes = PLANES.map((P, pi) => {
      const rnd = rng(P.seed);
      const R = (a: number, c: number) => a + (c - a) * rnd();
      const q = pi / (PLANES.length - 1);
      const sp = P.spacing * spread;
      const reach = sp * 1.5;
      // the camera only sweeps `bounds * d` of this plane, plus one screen and a half around it
      const x0 = b.x * P.d - sw * 1.5;
      const y0 = b.y * P.d - sh * 1.5;
      const cols = Math.ceil(((b.x + b.w) * P.d + sw * 1.5 - x0) / sp);
      const rows = Math.ceil(((b.y + b.h) * P.d + sh * 1.5 - y0) / sp);
      const patch = PATCH * spread * (1 + 0.6 * q);

      // jittered grid, thinned by the noise
      const grid = new Int32Array(cols * rows).fill(-1);
      const xs: number[] = [];
      const ys: number[] = [];
      const cells: number[] = [];
      const colors: number[] = [];
      for (let gy = 0; gy < rows; gy++)
        for (let gx = 0; gx < cols; gx++) {
          const px = x0 + (gx + 0.5 + R(-0.42, 0.42)) * sp;
          const py = y0 + (gy + 0.5 + R(-0.42, 0.42)) * sp;
          const keep = 0.03 + 0.92 * smoothstep(0.3, 0.64, fbm(px / patch, py / patch, P.seed));
          if (rnd() > keep) continue;
          grid[gy * cols + gx] = xs.length;
          xs.push(px);
          ys.push(py);
          cells.push(gx, gy);
          // colour comes in clusters, taking the hue of the section the plane sits behind
          const colored = noise(px / (sp * 4), py / (sp * 4), P.seed + 99) > 0.68 - 0.14 * q || rnd() < 0.04;
          colors.push(colored ? HUES.indexOf(nearestHue(px / P.d, py / P.d)) + 1 : 0);
        }

      const n = xs.length;
      const L: Plane = {
        d: P.d,
        q,
        n,
        x: Float32Array.from(xs),
        y: Float32Array.from(ys),
        ax: new Float32Array(n),
        ay: new Float32Array(n),
        phase: new Float32Array(n),
        speed: new Float32Array(n),
        color: Uint8Array.from(colors),
        hub: new Uint8Array(n),
        edges: new Uint32Array(0),
        reach,
        amp: sp * 0.24,
        flow: { ax: R(20, 40) * s * (0.5 + q), ay: R(14, 30) * s * (0.5 + q), phase: R(0, 6.28) },
        sx: new Float32Array(n),
        sy: new Float32Array(n),
        vis: new Uint8Array(n),
      };
      for (let i = 0; i < n; i++) {
        L.ax[i] = sp * R(0.08, 0.24);
        L.ay[i] = sp * R(0.08, 0.24);
        L.phase[i] = R(0, 6.28);
        L.speed[i] = R(0.1, 0.26);
        L.hub[i] = rnd() < 0.14 ? 1 : 0;
      }

      // links: every node reaches for its 1 to 3 nearest neighbours
      const seen = new Set<number>();
      const edges: number[] = [];
      const near: { j: number; dd: number }[] = [];
      for (let i = 0; i < n; i++) {
        const cx = cells[i * 2];
        const cy = cells[i * 2 + 1];
        near.length = 0;
        for (let gy = cy - 2; gy <= cy + 2; gy++)
          for (let gx = cx - 2; gx <= cx + 2; gx++) {
            if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
            const j = grid[gy * cols + gx];
            if (j < 0 || j === i) continue;
            const dd = (xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2;
            if (dd < (reach * 1.05) ** 2) near.push({ j, dd });
          }
        near.sort((a, c) => a.dd - c.dd);
        const want = 1 + Math.floor(rnd() * 3);
        for (let m = 0; m < Math.min(want, near.length); m++) {
          const j = near[m].j;
          const key = Math.min(i, j) * n + Math.max(i, j);
          if (seen.has(key) || rnd() < 0.12) continue;
          seen.add(key);
          edges.push(i, j);
        }
      }
      L.edges = Uint32Array.from(edges);
      return L;
    });
  }

  /** Draws every plane, far first. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Cam, P: Palette, t: number, alpha: number) {
    const z = cam.z;
    const neutral = P.deco;
    const colorOf = (c: number) => (c ? P.hues[HUES[c - 1]] : neutral);

    for (const L of this.planes) {
      const { q, x, y, ax, ay, phase, speed, sx, sy, vis, color, hub, edges } = L;
      const zE = Math.pow(z, L.d);
      const zS = zE * this.size;
      const ox = w / 2 - cam.x * z * L.d + L.flow.ax * Math.sin(t * 0.05 + L.flow.phase) * zE;
      const oy = h / 2 - cam.y * z * L.d + L.flow.ay * Math.cos(t * 0.04 + L.flow.phase * 1.7) * zE;

      // node positions, only around the screen (a link can't be longer than `reach`)
      const m = (L.reach + L.amp) * zE + 12;
      for (let i = 0; i < L.n; i++) {
        const bx = ox + x[i] * zE;
        const by = oy + y[i] * zE;
        if (bx < -m || bx > w + m || by < -m || by > h + m) {
          vis[i] = 0;
          continue;
        }
        vis[i] = 1;
        sx[i] = bx + ax[i] * Math.sin(t * speed[i] + phase[i]) * zE;
        sy[i] = by + ay[i] * Math.cos(t * speed[i] * 0.87 + phase[i] * 1.3) * zE;
      }

      // links fade out as their nodes drift apart, and come back when they get closer
      for (const bk of this.buckets) bk.length = 0;
      const r0 = L.reach * 0.62 * zE;
      const r1 = L.reach * zE;
      for (let e = 0; e < edges.length; e += 2) {
        const i = edges[e];
        const j = edges[e + 1];
        if (!vis[i] || !vis[j]) continue;
        const f = 1 - smoothstep(r0, r1, Math.hypot(sx[j] - sx[i], sy[j] - sy[i]));
        if (f < 0.06) continue;
        const lvl = Math.min(LEVELS - 1, (f * LEVELS) | 0);
        this.buckets[lvl * COLORS + (color[i] || color[j])].push(i, j);
      }
      ctx.lineWidth = (2.2 + 2 * q) * zS;
      ctx.lineCap = 'round';
      for (let lvl = 0; lvl < LEVELS; lvl++) {
        const la = (lvl + 1) / LEVELS;
        for (let c = 0; c < COLORS; c++) {
          const bk = this.buckets[lvl * COLORS + c];
          if (!bk.length) continue;
          ctx.beginPath();
          for (let e = 0; e < bk.length; e += 2) {
            ctx.moveTo(sx[bk[e]], sy[bk[e]]);
            ctx.lineTo(sx[bk[e + 1]], sy[bk[e + 1]]);
          }
          // a neutral base, then a coloured pass that gets stronger up close
          ctx.globalAlpha = (0.09 + 0.08 * q) * la * alpha;
          ctx.strokeStyle = neutral;
          ctx.stroke();
          if (c) {
            ctx.globalAlpha = (0.05 + 0.16 * q) * la * alpha;
            ctx.strokeStyle = colorOf(c);
            ctx.stroke();
          }
        }
      }

      // nodes: filled dots, bigger for the hubs (one batched path per colour and size)
      const dot = Math.max(1.5, (2.8 + 2.6 * q) * zS);
      const ring = Math.max(3, (5 + 4.5 * q) * zS);
      for (let c = 0; c < COLORS; c++) {
        ctx.fillStyle = colorOf(c);
        for (const big of [0, 1]) {
          const r = big ? ring : dot;
          ctx.beginPath();
          for (let i = 0; i < L.n; i++) {
            if (!vis[i] || color[i] !== c || hub[i] !== big) continue;
            ctx.moveTo(sx[i] + r, sy[i]);
            ctx.arc(sx[i], sy[i], r, 0, TAU);
          }
          ctx.globalAlpha = (c ? 0.36 + 0.4 * q : 0.22 + 0.28 * q) * alpha;
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }
}
