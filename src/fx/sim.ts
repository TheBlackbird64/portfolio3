import { FONT_MONO, getPalette } from '../core/theme';

/*
 * A small but honest load-balancer simulation:
 * Poisson arrivals, per-server concurrency + queue, heterogeneous servers,
 * periodic health checks (so failures are detected late, like in real life),
 * retries with a budget, and live latency percentiles.
 */

type Phase = 'toLB' | 'toSrv' | 'queued' | 'proc' | 'bounce' | 'resp';

interface Req {
  born: number;
  phase: Phase;
  t: number;
  srv: number;
  retries: number;
  work: number;
}

interface Server {
  name: string;
  up: boolean;
  lbUp: boolean;
  speed: number;
  slots: number;
  proc: Req[];
  queue: Req[];
  flash: number;
  reviveAt: number;
}

interface Fx {
  x: number;
  y: number;
  life: number;
}

const SERVICE_MEAN = 0.3;
const QUEUE_MAX = 18;
const RETRY_MAX = 2;
const HC_PERIOD = 1.2;

const expRand = (mean: number) => -Math.log(1 - Math.random()) * mean;

export class LoadBalancerSim {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private spark: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private w = 600;
  private h = 300;
  private dpr = 1;

  private rate = 36;
  private algo: 'rr' | 'lc' = 'rr';
  private rr = 0;
  private reqs: Req[] = [];
  private fx: Fx[] = [];
  private servers: Server[];
  private time = 0;
  private spawnAcc = 0;
  private hcAcc = 0;
  private hcPulse = 0;
  private statAcc = 0;
  private done: { t: number; lat: number }[] = [];
  private fails: number[] = [];
  private sparkData: number[] = [];

  private running = false;
  private raf = 0;
  private last = 0;

  private stats: Record<string, HTMLElement> = {};

  constructor(private root: HTMLElement) {
    this.canvas = root.querySelector('.sim__canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.spark = root.querySelector('[data-spark]')!;
    this.sctx = this.spark.getContext('2d')!;
    this.servers = [1, 1.05, 0.6, 1.2].map((speed, i) => ({
      name: `srv-0${i + 1}`,
      up: true,
      lbUp: true,
      speed,
      slots: 3,
      proc: [],
      queue: [],
      flash: 0,
      reviveAt: 0,
    }));
    root.querySelectorAll<HTMLElement>('[data-stat]').forEach((el) => (this.stats[el.dataset.stat!] = el));
    this.bind();
    new ResizeObserver(() => this.resize()).observe(root.querySelector('.sim__stage')!);
    this.resize();
    // warm up so the first frame already looks alive
    for (let i = 0; i < 240; i++) this.step(1 / 60);
    this.render();
  }

  private bind() {
    const rate = this.root.querySelector<HTMLInputElement>('[data-sim-rate]')!;
    const out = this.root.querySelector<HTMLOutputElement>('[data-sim-rate-out]')!;
    rate.addEventListener('input', () => {
      this.rate = Number(rate.value);
      out.textContent = `${rate.value} req/s`;
      rate.style.setProperty('--p', `${((this.rate - 5) / 115) * 100}%`);
    });
    rate.style.setProperty('--p', `${((this.rate - 5) / 115) * 100}%`);

    this.root.querySelectorAll<HTMLButtonElement>('[data-algo]').forEach((b) =>
      b.addEventListener('click', () => {
        this.algo = b.dataset.algo as 'rr' | 'lc';
        this.root.querySelectorAll('[data-algo]').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
      }),
    );

    this.root.querySelector('[data-sim-chaos]')!.addEventListener('click', () => {
      const alive = this.servers.filter((s) => s.up);
      if (alive.length <= 1) return;
      const s = alive[Math.floor(Math.random() * alive.length)];
      this.setUp(s, false);
      s.reviveAt = this.time + 5;
    });

    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.w;
      const y = ((e.clientY - r.top) / r.height) * this.h;
      this.servers.forEach((s, i) => {
        const b = this.srvBox(i);
        if (x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6) {
          this.setUp(s, !s.up);
          s.reviveAt = 0;
        }
      });
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.w;
      const y = ((e.clientY - r.top) / r.height) * this.h;
      const over = this.servers.some((_, i) => {
        const b = this.srvBox(i);
        return x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6;
      });
      this.canvas.style.cursor = over ? 'pointer' : 'default';
    });
  }

  private setUp(s: Server, up: boolean) {
    s.up = up;
    if (!up) {
      // in-flight work is lost: those requests bounce back to the LB and get retried
      for (const r of [...s.proc, ...s.queue]) {
        r.phase = 'bounce';
        r.t = 1;
      }
      s.proc = [];
      s.queue = [];
    }
  }

  private resize() {
    const stage = this.root.querySelector<HTMLElement>('.sim__stage')!;
    this.w = Math.max(280, stage.clientWidth);
    this.h = Math.round(Math.min(Math.max(this.w * 0.46, 220), 330));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.height = `${this.h}px`;
    const sw = this.spark.clientWidth || 120;
    this.spark.width = Math.round(sw * this.dpr);
    this.spark.height = Math.round(28 * this.dpr);
    this.render();
  }

  /* ------------------------------------------------------------ geometry */

  private get cy() {
    return this.h / 2;
  }
  private clientBox() {
    return { x: 14, y: this.cy - 44, w: 62, h: 88 };
  }
  private lbBox() {
    const x = Math.round(this.w * 0.36);
    return { x: x - 30, y: this.cy - 26, w: 60, h: 52 };
  }
  private srvBox(i: number) {
    const n = this.servers.length;
    const top = 26;
    const span = this.h - top * 2;
    const bh = Math.min(48, span / n - 14);
    const cy = top + (span / n) * (i + 0.5);
    const bw = Math.min(118, this.w * 0.2);
    return { x: this.w - bw - 14, y: cy - bh / 2, w: bw, h: bh };
  }

  /** Point along client → LB. */
  private onIn(t: number) {
    const c = this.clientBox();
    const l = this.lbBox();
    const x0 = c.x + c.w;
    const x1 = l.x;
    return { x: x0 + (x1 - x0) * t, y: this.cy + Math.sin(t * Math.PI) * 0 };
  }

  /** Point along LB → server i (orthogonal elbow). */
  private onOut(i: number, t: number) {
    const l = this.lbBox();
    const s = this.srvBox(i);
    const x0 = l.x + l.w;
    const y0 = this.cy;
    const x2 = s.x - 26;
    const y1 = s.y + s.h / 2;
    const xm = x0 + (x2 - x0) * 0.42;
    const segs = [Math.abs(xm - x0), Math.abs(y1 - y0), Math.abs(x2 - xm)];
    const total = segs[0] + segs[1] + segs[2];
    let d = t * total;
    if (d <= segs[0]) return { x: x0 + d, y: y0 };
    d -= segs[0];
    if (d <= segs[1]) return { x: xm, y: y0 + Math.sign(y1 - y0) * d };
    d -= segs[1];
    return { x: xm + d, y: y1 };
  }

  /* ---------------------------------------------------------- simulation */

  private route(r: Req) {
    const candidates = this.servers.map((s, i) => ({ s, i })).filter(({ s }) => s.lbUp);
    if (!candidates.length) {
      this.fail(r, this.lbBox().x + 30, this.cy);
      return;
    }
    let pick: number;
    if (this.algo === 'rr') {
      pick = candidates[this.rr++ % candidates.length].i;
    } else {
      candidates.sort((a, b) => a.s.proc.length + a.s.queue.length - (b.s.proc.length + b.s.queue.length) || Math.random() - 0.5);
      pick = candidates[0].i;
    }
    r.phase = 'toSrv';
    r.srv = pick;
    r.t = 0;
  }

  private fail(r: Req, x: number, y: number) {
    this.fails.push(this.time);
    this.fx.push({ x, y, life: 1 });
    r.phase = 'resp';
    r.t = -1; // marker: drop
  }

  private step(dt: number) {
    this.time += dt;

    // arrivals (Poisson-ish)
    this.spawnAcc += dt * this.rate;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (Math.random() < 0.92 || this.rate < 10)
        this.reqs.push({ born: this.time - Math.random() * dt, phase: 'toLB', t: Math.random() * 0.05, srv: -1, retries: 0, work: expRand(SERVICE_MEAN) });
    }

    // health checks: the LB only learns about failures periodically
    this.hcAcc += dt;
    if (this.hcAcc >= HC_PERIOD) {
      this.hcAcc = 0;
      this.hcPulse = 1;
      for (const s of this.servers) s.lbUp = s.up;
    }
    this.hcPulse = Math.max(0, this.hcPulse - dt * 1.6);

    for (const s of this.servers) {
      if (!s.up && s.reviveAt && this.time >= s.reviveAt) {
        s.up = true;
        s.reviveAt = 0;
      }
      s.flash = Math.max(0, s.flash - dt * 4);
      // processing
      for (const r of s.proc) r.work -= dt * s.speed;
      const finished = s.proc.filter((r) => r.work <= 0);
      if (finished.length) {
        s.proc = s.proc.filter((r) => r.work > 0);
        for (const r of finished) {
          this.done.push({ t: this.time, lat: this.time - r.born });
          r.phase = 'resp';
          r.t = 1;
          s.flash = 1;
        }
      }
      while (s.proc.length < s.slots && s.queue.length) {
        const r = s.queue.shift()!;
        r.phase = 'proc';
        s.proc.push(r);
      }
    }

    for (const r of this.reqs) {
      switch (r.phase) {
        case 'toLB':
          r.t += dt / 0.42;
          if (r.t >= 1) this.route(r);
          break;
        case 'toSrv':
          r.t += dt / 0.5;
          if (r.t >= 1) {
            const s = this.servers[r.srv];
            if (!s.up) {
              r.phase = 'bounce';
              r.t = 1;
            } else if (s.proc.length < s.slots) {
              r.phase = 'proc';
              s.proc.push(r);
            } else if (s.queue.length < QUEUE_MAX) {
              r.phase = 'queued';
              s.queue.push(r);
            } else {
              const b = this.srvBox(r.srv);
              this.fail(r, b.x - 26, b.y + b.h / 2);
            }
          }
          break;
        case 'bounce':
          r.t -= dt / 0.3;
          if (r.t <= 0) {
            if (++r.retries > RETRY_MAX) this.fail(r, this.lbBox().x + 60, this.cy);
            else this.route(r);
          }
          break;
        case 'resp':
          if (r.t > 0) r.t -= dt / 0.35;
          break;
      }
    }
    this.reqs = this.reqs.filter((r) => !(r.phase === 'resp' && r.t <= 0));
    for (const f of this.fx) f.life -= dt * 1.4;
    this.fx = this.fx.filter((f) => f.life > 0);

    // stats every 0.5 s over a 5 s window
    this.statAcc += dt;
    if (this.statAcc >= 0.5) {
      this.statAcc = 0;
      const since = this.time - 5;
      this.done = this.done.filter((d) => d.t >= since);
      this.fails = this.fails.filter((t) => t >= since);
      const lats = this.done.map((d) => d.lat).sort((a, b) => a - b);
      const q = (p: number) => (lats.length ? lats[Math.min(lats.length - 1, Math.floor(p * lats.length))] : 0);
      const p99 = Math.round(q(0.99) * 100);
      this.sparkData.push(p99);
      if (this.sparkData.length > 60) this.sparkData.shift();
      const total = this.done.length + this.fails.length;
      this.setStat('tput', String(Math.round(this.done.length / 5)));
      this.setStat('p50', String(Math.round(q(0.5) * 100)));
      this.setStat('p99', String(p99));
      this.setStat('err', total ? ((this.fails.length / total) * 100).toFixed(1).replace('.', ',') : '0');
      this.root.classList.toggle('is-degraded', total > 0 && this.fails.length / total > 0.02);
    }
  }

  private setStat(k: string, v: string) {
    const el = this.stats[k];
    if (el && el.textContent !== v) el.textContent = v;
  }

  /* ------------------------------------------------------------- drawing */

  private render() {
    const { ctx, w, h, dpr } = this;
    const P = getPalette();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.font = `500 10px ${FONT_MONO}`;
    ctx.textBaseline = 'middle';

    // wires
    ctx.strokeStyle = P.line2;
    ctx.beginPath();
    const a = this.onIn(0);
    const b = this.onIn(1);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    this.servers.forEach((_, i) => {
      for (let k = 0; k <= 24; k++) {
        const p = this.onOut(i, k / 24);
        if (k === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
    });
    ctx.stroke();

    // health-check pulse
    if (this.hcPulse > 0) {
      ctx.globalAlpha = this.hcPulse * 0.8;
      ctx.strokeStyle = P.ink3;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      const l = this.lbBox();
      this.servers.forEach((_, i) => {
        const s = this.srvBox(i);
        ctx.moveTo(l.x + l.w / 2, l.y + l.h);
        ctx.quadraticCurveTo(l.x + l.w / 2, s.y + s.h + 10, s.x + s.w / 2, s.y + s.h + 4);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // nodes
    const box = (r: { x: number; y: number; w: number; h: number }, stroke: string) => {
      ctx.fillStyle = P.bg;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = stroke;
      ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    };
    const c = this.clientBox();
    box(c, P.ink3);
    ctx.fillStyle = P.ink2;
    ctx.textAlign = 'center';
    ctx.fillText('CLIENTS', c.x + c.w / 2, c.y + 16);
    ctx.fillStyle = P.ink3;
    ctx.fillText(`${this.rate}/s`, c.x + c.w / 2, c.y + c.h - 14);
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = P.ink4;
      ctx.strokeRect(c.x + 14 + k * 12 + 0.5, c.y + 36.5, 8, 14);
    }

    const l = this.lbBox();
    box(l, P.ink);
    ctx.fillStyle = P.ink;
    ctx.fillText('LB', l.x + l.w / 2, l.y + 19);
    ctx.fillStyle = P.accent;
    ctx.fillText(this.algo === 'rr' ? 'RR' : 'LC', l.x + l.w / 2, l.y + 35);

    this.servers.forEach((s, i) => {
      const r = this.srvBox(i);
      box(r, s.up ? (s.flash > 0 ? P.ink2 : P.ink3) : P.accent);
      if (!s.up) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        ctx.strokeStyle = P.accentSoft;
        ctx.beginPath();
        for (let k = -r.h; k < r.w; k += 6) {
          ctx.moveTo(r.x + k, r.y + r.h);
          ctx.lineTo(r.x + k + r.h, r.y);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = s.up ? P.ink2 : P.accent;
      ctx.fillText(s.name, r.x + 8, r.y + 13);
      ctx.textAlign = 'right';
      ctx.fillStyle = s.up ? P.ink4 : P.accent;
      ctx.fillText(s.up ? `×${s.speed.toFixed(2).replace('.', ',')}` : 'HS', r.x + r.w - 7, r.y + 13);
      if (s.up !== s.lbUp) {
        ctx.fillStyle = P.accent;
        ctx.fillText(s.lbUp ? 'HC…' : 'HC ✓', r.x + r.w - 7, r.y + r.h - 10);
      }
      // load bar
      const bw = r.w - 16;
      ctx.fillStyle = P.line2;
      ctx.fillRect(r.x + 8, r.y + r.h - 11, bw * 0.62, 3);
      ctx.fillStyle = s.proc.length >= s.slots ? P.accent : P.ink2;
      ctx.fillRect(r.x + 8, r.y + r.h - 11, ((bw * 0.62) / s.slots) * s.proc.length, 3);
      // queue
      const qn = s.queue.length;
      for (let k = 0; k < Math.min(qn, 9); k++) {
        ctx.fillStyle = k > 5 ? P.accent : P.ink3;
        ctx.fillRect(r.x - 12 - (k % 3) * 6, r.y + r.h / 2 - 7 + Math.floor(k / 3) * 6, 4, 4);
      }
      if (qn > 9) {
        ctx.textAlign = 'right';
        ctx.fillStyle = P.accent;
        ctx.fillText(`+${qn - 9}`, r.x - 30, r.y + r.h / 2);
      }
    });

    // requests
    for (const r of this.reqs) {
      let p: { x: number; y: number } | null = null;
      let color = P.ink;
      let size = 2.4;
      if (r.phase === 'toLB') p = this.onIn(Math.min(r.t, 1));
      else if (r.phase === 'toSrv') p = this.onOut(r.srv, Math.min(r.t, 1));
      else if (r.phase === 'bounce') {
        p = this.onOut(r.srv, Math.max(r.t, 0));
        color = P.accent;
        size = 2.8;
      } else if (r.phase === 'resp' && r.t > 0) {
        p = this.onOut(r.srv, r.t);
        color = P.ink3;
        size = 1.6;
      }
      if (!p) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // failures
    ctx.strokeStyle = P.accent;
    ctx.lineWidth = 1.5;
    for (const f of this.fx) {
      ctx.globalAlpha = f.life;
      const s = 4 + (1 - f.life) * 6;
      ctx.beginPath();
      ctx.moveTo(f.x - s, f.y - s);
      ctx.lineTo(f.x + s, f.y + s);
      ctx.moveTo(f.x + s, f.y - s);
      ctx.lineTo(f.x - s, f.y + s);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    this.renderSpark();
  }

  private renderSpark() {
    const { sctx, spark, dpr } = this;
    const w = spark.width / dpr;
    const h = spark.height / dpr;
    const P = getPalette();
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, w, h);
    const d = this.sparkData;
    if (d.length < 2) return;
    const max = Math.max(80, ...d);
    sctx.strokeStyle = P.accent;
    sctx.lineWidth = 1.25;
    sctx.beginPath();
    d.forEach((v, i) => {
      const x = (i / 59) * w;
      const y = h - 2 - (v / max) * (h - 4);
      if (i === 0) sctx.moveTo(x, y);
      else sctx.lineTo(x, y);
    });
    sctx.stroke();
  }

  /* ---------------------------------------------------------- lifecycle */

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.step(dt);
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  redraw() {
    this.render();
  }
}
