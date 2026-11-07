import { damp } from '../core/util';

/* ------------------------------------------------------- variable-font name */

/** Letters of the hero name widen and thicken near the cursor (Archivo's wdth + wght axes). */
export class NameProximity {
  private chars: HTMLElement[];
  private cur: { s: number; w: number }[];

  constructor(root: HTMLElement) {
    this.chars = Array.from(root.querySelectorAll<HTMLElement>('.ch'));
    this.cur = this.chars.map(() => ({ s: 0, w: 0 }));
  }

  /** Returns true while still animating. */
  tick(dt: number, px: number | null, py: number | null): boolean {
    let moving = false;
    const rects = px === null ? null : this.chars.map((c) => c.getBoundingClientRect());
    this.chars.forEach((ch, i) => {
      let f = 0;
      if (rects && py !== null && px !== null) {
        const r = rects[i];
        const d = Math.hypot(r.left + r.width / 2 - px, r.top + r.height / 2 - py);
        const t = Math.max(0, 1 - d / 260);
        f = t * t * (3 - 2 * t);
      }
      const c = this.cur[i];
      const ns = damp(c.s, f, 9, dt);
      const nw = damp(c.w, f, 9, dt);
      if (Math.abs(ns - c.s) > 0.002 || Math.abs(nw - c.w) > 0.002) {
        moving = true;
        c.s = ns;
        c.w = nw;
        ch.style.fontStretch = `${(100 + 22 * ns).toFixed(1)}%`;
        ch.style.fontWeight = `${Math.round(640 + 240 * nw)}`;
      }
    });
    return moving;
  }
}

/* ------------------------------------------------------------------- clock */

export function startClock(els: HTMLElement[], city: string, timeZone: string) {
  const f = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' });
  const tick = () => {
    const t = `${city} — ${f.format(new Date())}`;
    for (const el of els) if (el.textContent !== t) el.textContent = t;
  };
  tick();
  window.setInterval(tick, 10_000);
}

/* -------------------------------------------------------------- log stream */

const rand = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));
const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[rand(0, 15)]).join('');

/** Fake but plausible live logs for each project hero. */
export class LogStream {
  private timer = 0;
  private offset = rand(1_200_000, 1_900_000);
  private list: HTMLOListElement;

  constructor(
    root: HTMLElement,
    private templates: string[],
  ) {
    this.list = root.querySelector('.logbox__lines')!;
    for (let i = 0; i < 7; i++) this.push(false);
  }

  private fill(tpl: string) {
    return tpl.replace(/\{(\w)\}/g, (_, k: string) => {
      switch (k) {
        case 'p': return String(rand(0, 11));
        case 'o': return String((this.offset += rand(40, 900)));
        case 'b': return String(rand(64, 1024));
        case 'f': return (Math.random() * 1.8 + 0.3).toFixed(2);
        case 'c': return String(rand(10, 99));
        case 'w': return String(rand(120, 9800));
        case 't': return String(rand(41, 47));
        case 's': return String(rand(5, 9));
        case 'r': return String(rand(5, 50) * 100);
        case 'h': return String(rand(91, 99));
        case 'k': return `k_${hex(6)}`;
        default: return '';
      }
    });
  }

  private push(animate = true) {
    const now = new Date();
    const ts = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const warn = Math.random() < 0.07;
    const msg = this.fill(this.templates[rand(0, this.templates.length - 1)]);
    const li = document.createElement('li');
    if (animate) li.className = 'is-new';
    li.innerHTML = `<span class="lg-t">${ts}</span><span class="lg-l${warn ? ' lg-l--warn' : ''}">${warn ? 'WRN' : 'INF'}</span><span class="lg-m">${msg}</span>`;
    this.list.appendChild(li);
    while (this.list.children.length > 9) this.list.firstElementChild!.remove();
  }

  start() {
    if (this.timer) return;
    const loop = () => {
      this.push();
      this.timer = window.setTimeout(loop, rand(280, 900));
    };
    this.timer = window.setTimeout(loop, 400);
  }

  stop() {
    window.clearTimeout(this.timer);
    this.timer = 0;
  }
}

/* -------------------------------------------------------------------- copy */

export function bindCopy(root: ParentNode) {
  root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy!);
        btn.textContent = 'Adresse copiée ✓';
      } catch {
        btn.textContent = btn.dataset.copy!;
      }
      btn.classList.add('is-done');
      window.setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove('is-done');
      }, 1800);
    });
  });
}
