import { gsap } from 'gsap';
import { site } from './content';
import { Geometry } from './core/geometry';
import { mapGlyph, NavArrows } from './core/nav';
import { currentTheme, setTheme } from './core/theme';
import { clamp, damp, easeInOutCubic, lerp, pad, qs, qsa, reducedMotion, zoomPath, type Cam } from './core/util';
import { addTraces, bindCopy, LogStream, startClock } from './fx/details';
import { reveal, revealHeroName } from './fx/reveal';
import { LoadBalancerSim } from './fx/sim';
import { Background } from './render/background';
import { OVERVIEW_PATH, SHEETS, sheetFromPath, type SheetDef } from './sheets/registry';
import { buildSheet } from './sheets/templates';

interface Sheet {
  def: SheetDef;
  el: HTMLElement;
  visited: boolean;
  /** Elements still waiting for their reveal. */
  pending: HTMLElement[];
  svgs: SVGSVGElement[];
  logs?: LogStream;
  sim?: LoadBalancerSim;
}

const ARROW_SM = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 6h8M6.5 2.5 10 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;

const ICONS = {
  theme: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12z" class="fill"/></svg>`,
  menu: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.5h12M2 10.5h12"/></svg>`,
};

function chromeHtml() {
  const link = (s: SheetDef) =>
    `<a href="${s.path}" data-nav="${s.id}" style="--hue: var(--${s.hue})"><span class="nav__dir" data-dir="${s.id}">${ARROW_SM}</span>${s.title}</a>`;
  const menuLink = (s: SheetDef) =>
    `<li><a href="${s.path}" data-nav="${s.id}" style="--hue: var(--${s.hue})"><span class="nav__dir" data-dir="${s.id}">${ARROW_SM}</span><b>${s.title}</b><em>${s.sub}</em></a></li>`;
  return `
  <header class="bar">
    <a class="brand" href="/" aria-label="Accueil — ${site.firstName} ${site.lastName}">
      <span class="brand__mark" aria-hidden="true"></span>
      <span class="brand__name">${site.firstName} ${site.lastName}</span>
    </a>
    <nav class="nav" aria-label="Sections">${SHEETS.map(link).join('')}</nav>
    <div class="tools">
      <button type="button" class="tool tool--map" data-overview aria-label="Vue d’ensemble (M)" title="Vue d’ensemble (M)"><span class="tool__glyph"></span></button>
      <button type="button" class="tool" data-theme-toggle aria-label="Changer de thème" title="Changer de thème">${ICONS.theme}</button>
      <button type="button" class="tool tool--menu" data-menu aria-label="Menu" aria-expanded="false">${ICONS.menu}</button>
    </div>
  </header>
  <main class="stage">
    <div class="world"></div>
    <p class="overview-hint" aria-hidden="true">Cliquez une section · <kbd>Échap</kbd> pour revenir</p>
  </main>
  <nav class="pager" aria-label="Section précédente et suivante">
    <button type="button" class="pager__btn" data-step="-1"><span class="pager__arrow">${ARROW_SM}</span><span class="pager__label"></span></button>
    <span class="pager__count"></span>
    <button type="button" class="pager__btn pager__btn--next" data-step="1"><span class="pager__label"></span><span class="pager__arrow">${ARROW_SM}</span></button>
  </nav>
  <div class="menu" hidden>
    <ol class="menu__list">${SHEETS.map(menuLink).join('')}</ol>
    <div class="menu__tools">
      <button type="button" class="btn btn--sm" data-overview>Vue d’ensemble</button>
      <button type="button" class="btn btn--sm" data-theme-toggle>Thème clair / sombre</button>
    </div>
  </div>`;
}

export class App {
  private stage!: HTMLElement;
  private world!: HTMLElement;
  private bar!: HTMLElement;

  private geo = new Geometry();
  private bg = new Background();
  private nav!: NavArrows;

  private sheets: Sheet[] = [];
  private byId = new Map<string, Sheet>();
  private current!: Sheet;

  private cam: Cam = { x: 0, y: 0, z: 1 };
  private overview = false;
  private traveling = false;
  private tween: gsap.core.Tween | null = null;
  private scroll = 0;
  private scrollTarget = 0;
  private nudge = 0;
  private wheelX = 0;
  private wheelXTime = 0;
  private navLock = 0;
  private dirty = true;
  private revealCheck = false;
  private hoverId: string | null = null;
  private pointer = { x: 0, y: 0, inside: false };
  private stageRect = new DOMRect();
  private drag: { x: number; y: number; camX: number; camY: number; moved: boolean; id: number } | null = null;
  private touch: { x: number; y: number; scroll: number; axis: 'x' | 'y' | null; lastY: number; lastT: number; vy: number; id: number } | null = null;
  private time = 0;
  private bgSkip = false;

  constructor(private root: HTMLElement) {
    root.innerHTML = chromeHtml();
    this.stage = qs('.stage', root);
    this.world = qs('.world', root);
    this.bar = qs('.bar', root);
    this.stage.prepend(this.bg.canvas);

    for (const def of SHEETS) {
      const el = buildSheet(def);
      el.tabIndex = -1;
      el.inert = true;
      this.world.appendChild(el);
      const sheet: Sheet = {
        def,
        el,
        visited: false,
        pending: qsa('[data-reveal]', el),
        svgs: qsa<SVGSVGElement>('svg.dg', el),
      };
      const logs = el.querySelector<HTMLElement>('[data-logs]');
      if (logs && def.project) sheet.logs = new LogStream(logs, def.project.logs);
      const sim = el.querySelector<HTMLElement>('[data-sim]');
      if (sim) sheet.sim = new LoadBalancerSim(sim);
      this.sheets.push(sheet);
      this.byId.set(def.id, sheet);
    }

    startClock(qsa('[data-clock]', root), site.city, site.timezone);
    bindCopy(root);
    addTraces(document);
    this.nav = new NavArrows(root);

    const initial = location.pathname === OVERVIEW_PATH ? undefined : sheetFromPath(location.pathname);
    this.current = this.byId.get(initial?.id ?? 'index')!;
    if (!initial && location.pathname !== OVERVIEW_PATH) history.replaceState({}, '', '/');
    this.setChromeHue(this.current.def, false);

    this.layout();
    this.bindEvents();
    gsap.ticker.add((_t, delta) => this.frame(Math.min(delta / 1000, 0.05)));
    this.intro(location.pathname === OVERVIEW_PATH);

    document.fonts?.ready.then(() => this.layout());
  }

  /* ================================================================ layout */

  private layout() {
    const els = new Map(this.sheets.map((s) => [s.def.id, s.el]));
    const cs = getComputedStyle(this.root);
    const top = parseFloat(cs.getPropertyValue('--bar-h')) || 64;
    const bottom = parseFloat(cs.getPropertyValue('--pager-h')) || 0;
    this.geo.compute(this.stage, els, { top, bottom });
    this.stageRect = this.stage.getBoundingClientRect();
    this.bg.resize(this.geo.sw, this.geo.sh);
    this.bg.build(this.geo, SHEETS);
    qs('.tool__glyph', this.root).innerHTML = mapGlyph(this.geo, SHEETS);
    this.markGlyph();

    // keep the camera where it belongs
    if (!this.traveling) {
      if (this.overview) {
        const b = this.geo.bounds;
        Object.assign(this.cam, { x: b.x + b.w / 2, y: b.y + b.h / 2, z: this.geo.fitZoom() });
      } else {
        const g = this.geo.get(this.current.def.id);
        this.scroll = this.scrollTarget = clamp(this.scrollTarget, 0, g.maxScroll);
        Object.assign(this.cam, { x: g.anchor.x, y: g.anchor.y + this.scroll, z: 1 });
      }
    }
    this.dirty = true;
  }

  /* ================================================================= frame */

  private frame(dt: number) {
    this.time += dt;
    if (!this.traveling && !this.overview) {
      const g = this.geo.get(this.current.def.id);
      if (Math.abs(this.scrollTarget - this.scroll) > 0.1 || Math.abs(this.nudge) > 0.1) {
        this.scroll = damp(this.scroll, this.scrollTarget, 10, dt);
        if (Math.abs(this.scrollTarget - this.scroll) <= 0.1) this.scroll = this.scrollTarget;
        this.nudge = damp(this.nudge, 0, 7, dt);
        if (Math.abs(this.nudge) <= 0.1) this.nudge = 0;
        this.cam.y = g.anchor.y + this.scroll + this.nudge;
        this.dirty = true;
        this.revealCheck = true;
      }
    }

    if (this.dirty) {
      this.dirty = false;
      this.render();
      this.drawBackground();
    } else if (!reducedMotion.matches) {
      // the background breathes on its own: 30 fps is plenty when nothing else moves
      this.bgSkip = !this.bgSkip;
      if (!this.bgSkip) this.drawBackground();
    }
  }

  private drawBackground() {
    this.bg.draw({
      cam: this.cam,
      geo: this.geo,
      sheets: SHEETS,
      overview: this.overview,
      hoverId: this.hoverId,
      time: this.time,
      motion: reducedMotion.matches ? 0 : 1,
    });
  }

  private render() {
    const { sw, sh } = this.geo;
    const { x, y, z } = this.cam;
    let tx = sw / 2 - x * z;
    let ty = sh / 2 - y * z;
    if (Math.abs(z - 1) < 1e-4) {
      tx = Math.round(tx);
      ty = Math.round(ty);
    }
    this.world.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${z})`;
    this.world.style.opacity = this.bg.intro < 1 ? String(this.bg.intro) : '';
    this.nav.update(this.cam, this.geo, this.current.def.id, !this.traveling && !this.overview);

    if (this.revealCheck && !this.traveling && !this.overview) {
      this.revealCheck = false;
      this.checkReveals(false);
    }
  }

  /* ============================================================ navigation */

  go(id: string, opts: { push?: boolean } = {}) {
    const target = this.byId.get(id);
    if (!target) return;
    this.closeMenu();
    if (opts.push !== false && location.pathname !== target.def.path) history.pushState({}, '', target.def.path);
    if (!this.overview && !this.traveling && target === this.current) {
      this.scrollTarget = 0;
      return;
    }
    this.flyTo(target);
  }

  private flyTo(target: Sheet) {
    const from = { ...this.cam };
    const g = this.geo.get(target.def.id);
    const to = { x: g.anchor.x, y: g.anchor.y, z: 1 };
    const fromOverview = this.overview || Math.abs(from.z - 1) > 0.02;

    this.leave(this.current);
    this.overview = false;
    this.root.classList.remove('is-overview');
    this.hoverId = null;
    this.tween?.kill();
    this.traveling = true;
    this.root.classList.add('is-traveling');
    this.setChromeHue(target.def);
    this.setActive(target.def.id);

    const done = () => this.arrive(target);

    if (reducedMotion.matches) {
      Object.assign(this.cam, to);
      this.world.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
      this.dirty = true;
      done();
      return;
    }

    const state = { t: 0 };
    let duration: number;
    let update: () => void;
    if (fromOverview) {
      const path = zoomPath([from.x, from.y, this.geo.sw / from.z], [to.x, to.y, this.geo.sw], 1.35);
      duration = clamp(0.55 + path.length * 0.3, 0.9, 1.8);
      update = () => {
        const [x, y, w] = path.at(easeInOutCubic(state.t));
        this.cam.x = x;
        this.cam.y = y;
        this.cam.z = this.geo.sw / w;
      };
    } else {
      const units = Math.hypot(to.x - from.x, to.y - from.y) / Math.hypot(this.geo.sw, this.geo.sh);
      duration = clamp(0.8 + units * 0.3, 0.95, 1.9);
      const dip = clamp(0.1 + units * 0.1, 0.12, 0.45);
      update = () => {
        const t = state.t;
        const p = easeInOutCubic(t);
        this.cam.x = lerp(from.x, to.x, p);
        this.cam.y = lerp(from.y, to.y, p);
        this.cam.z = lerp(from.z, 1, p) * (1 - dip * Math.pow(Math.sin(Math.PI * t), 2));
      };
    }
    this.tween = gsap.to(state, {
      t: 1,
      duration,
      ease: 'none',
      onUpdate: () => {
        update();
        this.dirty = true;
      },
      onComplete: done,
    });
  }

  private arrive(target: Sheet) {
    this.traveling = false;
    this.tween = null;
    this.root.classList.remove('is-traveling');
    this.current = target;
    this.scroll = this.scrollTarget = this.nudge = 0;
    const g = this.geo.get(target.def.id);
    Object.assign(this.cam, { x: g.anchor.x, y: g.anchor.y, z: 1 });
    // apply the final camera before measuring what is in view
    this.dirty = false;
    this.render();
    this.enter(target);
    this.dirty = true;
  }

  private enter(s: Sheet) {
    s.el.inert = false;
    if (!s.visited) {
      s.visited = true;
      const nameEl = s.el.querySelector<HTMLElement>('[data-hero-name]');
      if (nameEl) revealHeroName(nameEl, 0.05);
    }
    this.checkReveals(true);
    this.revealCheck = true;
    s.logs?.start();
    s.sim?.start();
    s.svgs.forEach((svg) => svg.unpauseAnimations());
    this.setChromeHue(s.def);
    this.setActive(s.def.id);
    this.updatePager();
    document.title =
      s.def.kind === 'index' ? `${site.firstName} ${site.lastName} — ${site.role}` : `${s.def.title} — ${site.firstName} ${site.lastName}`;
    if (!s.el.contains(document.activeElement)) s.el.focus({ preventScroll: true });
  }

  private leave(s: Sheet) {
    s.el.inert = true;
    s.logs?.stop();
    s.sim?.stop();
    s.svgs.forEach((svg) => svg.pauseAnimations());
  }

  private checkReveals(initial: boolean) {
    const s = this.current;
    if (!s.pending.length) return;
    const top = this.stageRect.top;
    const limit = this.stageRect.bottom - this.geo.sh * 0.06;
    let i = 0;
    s.pending = s.pending.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < limit && r.bottom > top) {
        reveal(el, initial ? 0.1 + i * 0.07 : i * 0.06);
        i++;
        return false;
      }
      return true;
    });
  }

  /** The chrome takes the colour of the region the camera is heading to. */
  private setChromeHue(def: SheetDef, animate = true) {
    for (const el of [this.bar, qs('.pager', this.root), qs('.menu', this.root)]) {
      el.classList.toggle('no-anim', !animate);
      el.style.setProperty('--accent', `var(--${def.hue})`);
    }
  }

  private setActive(id: string) {
    qsa('[data-nav]', this.root).forEach((a) => a.classList.toggle('is-active', a.dataset.nav === id));
    this.markGlyph();
  }

  private markGlyph() {
    qsa('.mapglyph rect', this.root).forEach((r) => r.classList.toggle('is-here', r.dataset.id === this.current.def.id));
  }

  private updatePager() {
    const i = this.current.def.num;
    const prev = SHEETS[i - 1];
    const next = SHEETS[i + 1];
    const [p, n] = qsa<HTMLButtonElement>('.pager__btn', this.root);
    p.disabled = !prev;
    n.disabled = !next;
    qs('.pager__label', p).textContent = prev?.title ?? '';
    qs('.pager__label', n).textContent = next?.title ?? '';
    qs('.pager__count', this.root).textContent = `${pad(i)} / ${pad(SHEETS.length - 1)}`;
  }

  /* ============================================================== overview */

  enterOverview(push = true) {
    if (this.overview && !this.traveling) return;
    if (push && location.pathname !== OVERVIEW_PATH) history.pushState({}, '', OVERVIEW_PATH);
    this.closeMenu();
    this.leave(this.current);
    this.overview = true;
    this.root.classList.add('is-overview');
    qsa('[data-nav]', this.root).forEach((a) => a.classList.remove('is-active'));
    this.tween?.kill();
    const from = { ...this.cam };
    const b = this.geo.bounds;
    const to = { x: b.x + b.w / 2, y: b.y + b.h / 2, z: this.geo.fitZoom() };
    if (reducedMotion.matches) {
      Object.assign(this.cam, to);
      this.traveling = false;
      this.dirty = true;
      return;
    }
    this.traveling = true;
    this.root.classList.add('is-traveling');
    const path = zoomPath([from.x, from.y, this.geo.sw / from.z], [to.x, to.y, this.geo.sw / to.z], 1.35);
    const state = { t: 0 };
    this.tween = gsap.to(state, {
      t: 1,
      duration: clamp(0.5 + path.length * 0.3, 0.9, 1.6),
      ease: 'none',
      onUpdate: () => {
        const [x, y, w] = path.at(easeInOutCubic(state.t));
        Object.assign(this.cam, { x, y, z: this.geo.sw / w });
        this.dirty = true;
      },
      onComplete: () => {
        this.traveling = false;
        this.tween = null;
        this.root.classList.remove('is-traveling');
        this.dirty = true;
      },
    });
  }

  private toggleOverview() {
    if (this.overview) this.go(this.current.def.id);
    else this.enterOverview();
  }

  private zoomAt(px: number, py: number, factor: number) {
    const { sw, sh } = this.geo;
    const z0 = this.cam.z;
    const z1 = clamp(z0 * factor, this.geo.fitZoom() * 0.7, 1);
    const wx = this.cam.x + (px - sw / 2) / z0;
    const wy = this.cam.y + (py - sh / 2) / z0;
    this.cam.z = z1;
    this.cam.x = wx - (px - sw / 2) / z1;
    this.cam.y = wy - (py - sh / 2) / z1;
    this.clampOverviewCam();
    this.dirty = true;
  }

  private clampOverviewCam() {
    const b = this.geo.bounds;
    const m = 300;
    this.cam.x = clamp(this.cam.x, b.x - m, b.x + b.w + m);
    this.cam.y = clamp(this.cam.y, b.y - m, b.y + b.h + m);
  }

  /* =============================================================== helpers */

  private neighbourToward(dx: number, dy: number): string | null {
    let best: string | null = null;
    let bestCos = 0.4;
    for (const id of this.current.def.links) {
      const a = this.geo.get(id).anchor;
      const vx = a.x - this.cam.x;
      const vy = a.y - this.cam.y;
      const cos = (vx * dx + vy * dy) / (Math.hypot(vx, vy) || 1);
      if (cos > bestCos) {
        bestCos = cos;
        best = id;
      }
    }
    return best;
  }

  private bump(amount: number) {
    this.nudge = clamp(this.nudge + amount, -26, 26);
    this.dirty = true;
  }

  private closeMenu() {
    const menu = qs('.menu', this.root);
    if (menu.hidden) return;
    menu.hidden = true;
    qs('[data-menu]', this.root).setAttribute('aria-expanded', 'false');
  }

  /* ================================================================ intro */

  private intro(toOverview: boolean) {
    const g = this.geo.get(this.current.def.id);
    const end = { x: g.anchor.x, y: g.anchor.y, z: 1 };
    const b = this.geo.bounds;
    let seen = false;
    try {
      seen = sessionStorage.getItem('intro') === '1';
      sessionStorage.setItem('intro', '1');
    } catch {
      /* private mode: always play the full intro */
    }

    this.root.classList.add('is-intro');
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.remove('is-intro')));

    if (reducedMotion.matches) {
      this.bg.intro = 1;
      Object.assign(this.cam, end);
      if (toOverview) this.enterOverview(false);
      else this.enter(this.current);
      return;
    }

    const zFit = this.geo.fitZoom();
    const start = seen
      ? { x: end.x + this.geo.sw * 0.06, y: end.y - this.geo.sh * 0.04, z: 0.66 }
      : { x: lerp(b.x + b.w / 2, end.x, 0.55), y: lerp(b.y + b.h / 2, end.y, 0.55), z: clamp(zFit * 1.9, 0.18, 0.42) };
    Object.assign(this.cam, start);
    gsap.to(this.bg, { intro: 1, duration: seen ? 0.6 : 1.2, ease: 'power2.out', onUpdate: () => (this.dirty = true) });

    if (toOverview) {
      this.enterOverview(false);
      return;
    }

    this.traveling = true;
    this.root.classList.add('is-traveling');
    this.setActive(this.current.def.id);
    const path = zoomPath([start.x, start.y, this.geo.sw / start.z], [end.x, end.y, this.geo.sw], 1.2);
    const state = { t: 0 };
    this.tween = gsap.to(state, {
      t: 1,
      duration: seen ? 1.1 : 2.1,
      delay: seen ? 0.05 : 0.35,
      ease: 'none',
      onUpdate: () => {
        const [x, y, w] = path.at(seen ? easeInOutCubic(state.t) : 1 - Math.pow(1 - state.t, 3.2));
        Object.assign(this.cam, { x, y, z: this.geo.sw / w });
        this.dirty = true;
      },
      onComplete: () => this.arrive(this.current),
    });
    const skip = () => this.tween?.progress(1);
    window.addEventListener('keydown', skip, { once: true });
    this.stage.addEventListener('pointerdown', skip, { once: true });
  }

  /* =============================================================== events */

  private bindEvents() {
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.layout(), 120);
    });

    window.addEventListener('popstate', () => {
      const path = location.pathname;
      if (path === OVERVIEW_PATH) return this.enterOverview(false);
      const def = sheetFromPath(path);
      this.go(def?.id ?? 'index', { push: false });
    });

    window.addEventListener('themechange', () => {
      this.dirty = true;
      this.sheets.forEach((s) => s.sim?.redraw());
    });

    this.root.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (t.closest('[data-overview]')) {
        e.preventDefault();
        this.toggleOverview();
        return;
      }
      if (t.closest('[data-theme-toggle]')) {
        setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
        return;
      }
      if (t.closest('[data-menu]')) {
        const menu = qs('.menu', this.root);
        menu.hidden = !menu.hidden;
        qs('[data-menu]', this.root).setAttribute('aria-expanded', String(!menu.hidden));
        return;
      }
      const step = t.closest<HTMLElement>('[data-step]');
      if (step) {
        const def = SHEETS[this.current.def.num + Number(step.dataset.step)];
        if (def) this.go(def.id);
        return;
      }
      // internal links → camera travel
      const a = t.closest('a');
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      e.preventDefault();
      if (href === OVERVIEW_PATH) return this.enterOverview();
      const def = sheetFromPath(href);
      if (def) this.go(def.id);
    });

    window.addEventListener('pointermove', (e) => {
      const r = this.stageRect;
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointer.inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;

      if (this.overview && !this.traveling) {
        if (this.drag && e.pointerId === this.drag.id) {
          const dx = e.clientX - this.drag.x;
          const dy = e.clientY - this.drag.y;
          if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
          this.cam.x = this.drag.camX - dx / this.cam.z;
          this.cam.y = this.drag.camY - dy / this.cam.z;
          this.clampOverviewCam();
        }
        const wx = this.cam.x + (this.pointer.x - this.geo.sw / 2) / this.cam.z;
        const wy = this.cam.y + (this.pointer.y - this.geo.sh / 2) / this.cam.z;
        const hit = this.pointer.inside && !(e.target as Element).closest('.bar') ? this.geo.hit(wx, wy, 20 / this.cam.z) : null;
        if (hit !== this.hoverId) {
          this.hoverId = hit;
          this.stage.style.cursor = hit ? 'pointer' : 'grab';
        }
        this.dirty = true;
      }
      if (this.touch && e.pointerId === this.touch.id) this.onTouchMove(e);
    });
    document.addEventListener('mouseout', (e) => {
      if (e.relatedTarget) return;
      this.pointer.inside = false;
    });

    this.stage.addEventListener('pointerdown', (e) => {
      if (this.overview && !this.traveling && e.button === 0) {
        this.drag = { x: e.clientX, y: e.clientY, camX: this.cam.x, camY: this.cam.y, moved: false, id: e.pointerId };
        this.stage.setPointerCapture(e.pointerId);
        this.stage.style.cursor = 'grabbing';
        return;
      }
      if (e.pointerType === 'touch' && !this.traveling && !(e.target as Element).closest('[data-hscroll], input, .sim__canvas')) {
        this.touch = { x: e.clientX, y: e.clientY, scroll: this.scrollTarget, axis: null, lastY: e.clientY, lastT: performance.now(), vy: 0, id: e.pointerId };
      }
    });
    const endPointer = (e: PointerEvent) => {
      if (this.drag && e.pointerId === this.drag.id) {
        const { moved } = this.drag;
        this.drag = null;
        this.stage.style.cursor = this.hoverId ? 'pointer' : 'grab';
        if (!moved && this.hoverId) this.go(this.hoverId);
      }
      if (this.touch && e.pointerId === this.touch.id) this.onTouchEnd(e);
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', (e) => {
      if (this.touch && e.pointerId === this.touch.id) this.touch = null;
      if (this.drag && e.pointerId === this.drag.id) this.drag = null;
    });

    this.stage.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onWheel(e: WheelEvent) {
    if (e.ctrlKey && !this.overview) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.geo.sh : 1;
    const dx = e.deltaX * k;
    const dy = e.deltaY * k;

    if (this.overview) {
      if (this.traveling) return;
      this.zoomAt(this.pointer.x, this.pointer.y, Math.exp(-dy * 0.0016));
      return;
    }
    if (this.traveling) return;

    const h = (e.target as Element).closest<HTMLElement>('[data-hscroll]');
    if (h && Math.abs(dx) > Math.abs(dy) && h.scrollWidth > h.clientWidth) {
      h.scrollLeft += dx;
      return;
    }

    // horizontal trackpad swipe → neighbour on that side
    if (Math.abs(dx) > Math.abs(dy) * 1.5) {
      const now = performance.now();
      if (now - this.wheelXTime > 260) this.wheelX = 0;
      this.wheelXTime = now;
      this.wheelX += dx;
      if (Math.abs(this.wheelX) > 160 && now > this.navLock) {
        const id = this.neighbourToward(Math.sign(this.wheelX), 0);
        this.wheelX = 0;
        this.navLock = now + 1200;
        if (id) this.go(id);
      }
      return;
    }

    const g = this.geo.get(this.current.def.id);
    const next = this.scrollTarget + dy;
    if (g.maxScroll > 0 && next > -1 && next < g.maxScroll + 1) {
      this.scrollTarget = clamp(next, 0, g.maxScroll);
    } else {
      if (g.maxScroll > 0) this.scrollTarget = clamp(next, 0, g.maxScroll);
      this.bump(dy * 0.08);
    }
  }

  private onTouchMove(e: PointerEvent) {
    const t = this.touch!;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (!t.axis && Math.hypot(dx, dy) > 8) t.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (t.axis === 'y') {
      const g = this.geo.get(this.current.def.id);
      const now = performance.now();
      const v = (e.clientY - t.lastY) / Math.max(now - t.lastT, 1);
      t.vy = t.vy * 0.6 + v * 0.4;
      t.lastY = e.clientY;
      t.lastT = now;
      if (g.maxScroll > 0) {
        this.scrollTarget = clamp(t.scroll - dy, 0, g.maxScroll);
        this.scroll = this.scrollTarget;
        this.cam.y = g.anchor.y + this.scroll;
        this.dirty = true;
        this.revealCheck = true;
      }
    }
  }

  private onTouchEnd(e: PointerEvent) {
    const t = this.touch!;
    this.touch = null;
    const dx = e.clientX - t.x;
    const g = this.geo.get(this.current.def.id);
    if (t.axis === 'x' && Math.abs(dx) > 50) {
      const def = SHEETS[this.current.def.num + (dx < 0 ? 1 : -1)];
      if (def) this.go(def.id);
    } else if (t.axis === 'y' && g.maxScroll > 0) {
      this.scrollTarget = clamp(this.scrollTarget - t.vy * 320, 0, g.maxScroll);
    }
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const g = this.geo.get(this.current.def.id);
    const interactive = !!t.closest('button, a');

    if (e.key === 'm' || e.key === 'M') return this.toggleOverview();
    if (e.key === 'Escape') {
      if (this.overview) this.go(this.current.def.id);
      this.closeMenu();
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      const def = SHEETS.find((s) => s.num === Number(e.key));
      if (def) this.go(def.id);
      return;
    }
    if (this.traveling) return;

    const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      if (this.overview) {
        this.cam.x += (dir[0] * 120) / this.cam.z;
        this.cam.y += (dir[1] * 120) / this.cam.z;
        this.clampOverviewCam();
        this.dirty = true;
        return;
      }
      if (dir[1] !== 0 && g.maxScroll > 0) {
        const atTop = this.scrollTarget <= 1;
        const atBottom = this.scrollTarget >= g.maxScroll - 1;
        if ((dir[1] > 0 && !atBottom) || (dir[1] < 0 && !atTop)) {
          this.scrollTarget = clamp(this.scrollTarget + dir[1] * 160, 0, g.maxScroll);
          return;
        }
      }
      const id = this.neighbourToward(dir[0], dir[1]);
      if (id) this.go(id);
      else this.bump(dir[1] * 18);
      return;
    }
    if (this.overview) return;
    const page = this.geo.sh * 0.85;
    if (e.key === 'PageDown' || (e.key === ' ' && !interactive && !e.shiftKey)) {
      e.preventDefault();
      this.scrollTarget = clamp(this.scrollTarget + page, 0, g.maxScroll);
    } else if (e.key === 'PageUp' || (e.key === ' ' && !interactive && e.shiftKey)) {
      e.preventDefault();
      this.scrollTarget = clamp(this.scrollTarget - page, 0, g.maxScroll);
    } else if (e.key === 'Home') {
      this.scrollTarget = 0;
    } else if (e.key === 'End') {
      this.scrollTarget = g.maxScroll;
    } else if (e.key === 'Tab') {
      // keep focused elements in view inside tall sheets
      requestAnimationFrame(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || !this.current.el.contains(a)) return;
        const r = a.getBoundingClientRect();
        if (r.top < this.stageRect.top + 80 || r.bottom > this.stageRect.bottom - 40)
          this.scrollTarget = clamp(this.scrollTarget + (r.top - this.stageRect.top) - this.geo.sh * 0.4, 0, g.maxScroll);
      });
    }
  }
}
