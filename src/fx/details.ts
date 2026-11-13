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

/* ------------------------------------------------------------ outline trace */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Text boxes: the outline draws itself, holds, then erases, in a loop. */
const LOOPED = '.logbox, .code, .sim, .skills, .portrait__frame';
/** Buttons: same animation, but only while hovered (or focused). */
const ON_HOVER = '.btn';

function addTrace(el: HTMLElement, hover: boolean) {
  if (el.classList.contains('has-trace')) return;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'trace');
  svg.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ x: '0', y: '0', width: '100%', height: '100%', pathLength: '1' })) rect.setAttribute(k, v);
  svg.append(rect);
  if (!hover) {
    // each box has its own pace and phase so they never pulse together
    const dur = 3.5 + Math.random() * 1.5;
    svg.style.setProperty('--trace-dur', `${dur.toFixed(2)}s`);
    svg.style.setProperty('--trace-delay', `${(-Math.random() * dur).toFixed(2)}s`);
  }
  el.classList.add('has-trace', hover ? 'has-trace--hover' : 'has-trace--loop');
  el.append(svg);
}

export function addTraces(root: ParentNode) {
  for (const el of root.querySelectorAll<HTMLElement>(LOOPED)) addTrace(el, false);
  for (const el of root.querySelectorAll<HTMLElement>(ON_HOVER)) addTrace(el, true);
}
