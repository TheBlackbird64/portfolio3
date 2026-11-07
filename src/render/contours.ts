/*
 * Procedural terrain: domain-warped Perlin noise, turned into contour lines
 * with marching squares. Computed lazily, tile by tile, as the camera discovers them.
 */

const TILE = 960;
const CELL = 24;
const N = TILE / CELL;

function makeNoise(seed: number) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const grad = (h: number, x: number, y: number) => {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const X = xi & 255;
    const Y = yi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
}

const noise = makeNoise(20261107);

function fbm(x: number, y: number, octaves: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

function field(x: number, y: number) {
  const f = 1 / 1400;
  const px = x * f;
  const py = y * f;
  const wx = fbm(px + 3.1, py - 1.7, 3);
  const wy = fbm(px - 4.3, py + 2.9, 3);
  return fbm(px + 1.6 * wx, py + 1.6 * wy, 4);
}

const LEVELS: number[] = [];
for (let l = -0.6; l <= 0.6001; l += 0.05) LEVELS.push(+l.toFixed(3));

export interface ContourTile {
  minor: Path2D;
  major: Path2D;
}

export class ContourField {
  readonly tile = TILE;
  private cache = new Map<string, ContourTile>();

  /** Returns the tile, computing it if allowed by the per-frame budget. */
  get(tx: number, ty: number, budget: { left: number }): ContourTile | null {
    const key = `${tx},${ty}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (budget.left <= 0) return null;
    budget.left--;
    const t = this.compute(tx, ty);
    this.cache.set(key, t);
    return t;
  }

  private compute(tx: number, ty: number): ContourTile {
    const x0 = tx * TILE;
    const y0 = ty * TILE;
    const n = N + 1;
    const v = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = field(x0 + i * CELL, y0 + j * CELL);

    const minor = new Path2D();
    const major = new Path2D();

    for (let li = 0; li < LEVELS.length; li++) {
      const L = LEVELS[li];
      const path = li % 5 === 0 ? major : minor;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = v[j * n + i]; // top-left
          const b = v[j * n + i + 1]; // top-right
          const c = v[(j + 1) * n + i + 1]; // bottom-right
          const d = v[(j + 1) * n + i]; // bottom-left
          let idx = 0;
          if (a > L) idx |= 8;
          if (b > L) idx |= 4;
          if (c > L) idx |= 2;
          if (d > L) idx |= 1;
          if (idx === 0 || idx === 15) continue;

          const x = x0 + i * CELL;
          const y = y0 + j * CELL;
          const tX = x + (CELL * (L - a)) / (b - a);
          const rY = y + (CELL * (L - b)) / (c - b);
          const bX = x + (CELL * (L - d)) / (c - d);
          const lY = y + (CELL * (L - a)) / (d - a);
          const R = x + CELL;
          const B = y + CELL;

          switch (idx) {
            case 1: case 14: path.moveTo(x, lY); path.lineTo(bX, B); break;
            case 2: case 13: path.moveTo(bX, B); path.lineTo(R, rY); break;
            case 3: case 12: path.moveTo(x, lY); path.lineTo(R, rY); break;
            case 4: case 11: path.moveTo(tX, y); path.lineTo(R, rY); break;
            case 6: case 9: path.moveTo(tX, y); path.lineTo(bX, B); break;
            case 7: case 8: path.moveTo(x, lY); path.lineTo(tX, y); break;
            case 5:
              if ((a + b + c + d) / 4 > L) { path.moveTo(x, lY); path.lineTo(tX, y); path.moveTo(bX, B); path.lineTo(R, rY); }
              else { path.moveTo(x, lY); path.lineTo(bX, B); path.moveTo(tX, y); path.lineTo(R, rY); }
              break;
            case 10:
              if ((a + b + c + d) / 4 > L) { path.moveTo(tX, y); path.lineTo(R, rY); path.moveTo(x, lY); path.lineTo(bX, B); }
              else { path.moveTo(x, lY); path.lineTo(tX, y); path.moveTo(bX, B); path.lineTo(R, rY); }
              break;
          }
        }
      }
    }
    return { minor, major };
  }
}
