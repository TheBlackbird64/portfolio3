import { gsap } from 'gsap';
import { site } from './content';
import { Geometry, routeKey } from './core/geometry';
import { currentTheme, setTheme } from './core/theme';
import {
  bearing,
  clamp,
  damp,
  easeInOutCubic,
  fmtBearing,
  fmtInt,
  lerp,
  pad,
  qs,
  qsa,
  reducedMotion,
  zoomPath,
  type Cam,
  type Vec,
} from './core/util';
import { bindCopy, LogStream, NameProximity, startClock } from './fx/details';
import { reveal, revealHeroName } from './fx/reveal';
import { LoadBalancerSim } from './fx/sim';
import { EdgeMarkers, Minimap, Rulers, Status, type HudView } from './hud/hud';
import { Background } from './render/background';
import { OVERVIEW_PATH, SHEETS, sheetFromPath, type SheetDef } from './sheets/registry';
import { buildSheet } from './sheets/templates';

interface Sheet {
  def: SheetDef;
  el: HTMLElement;
  visited: boolean;
  /** Unexplored hatch opacity (1 → 0 on first visit). */
  hatch: number;
  /** Elements still waiting for their reveal. */
  pending: HTMLElement[];
  svgs: SVGSVGElement[];
  logs?: LogStream;
  sim?: LoadBalancerSim;
}

const ICONS = {
  map: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="5" height="5"/><rect x="9.5" y="3.5" width="5" height="5"/><rect x="3.5" y="9.5" width="5" height="5"/></svg>`,
  theme: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12z" class="fill"/></svg>`,
  menu: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5h12M2 11h12"/></svg>`,
  mark: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5"/><path d="M10 0.5v19M0.5 10h19"/></svg>`,
};

function chromeHtml() {
  const projects = SHEETS.filter((s) => s.kind === 'project');
  const others = SHEETS.filter((s) => s.kind !== 'project' && s.kind !== 'index');
  const link = (s: SheetDef) => `<a href="${s.path}" data-nav="${s.id}"><i>${pad(s.num)}</i>${s.title}</a>`;
  const menuLink = (s: SheetDef) =>
    `<li><a href="${s.path}" data-nav="${s.id}"><span>${pad(s.num)}</span><b>${s.title}</b><em>${s.sub}</em></a></li>`;
  return `
  <header class="bar">
    <a class="brand" href="/" aria-label="Index — ${site.firstName} ${site.lastName}">
      <span class="brand__mark">${ICONS.mark}</span>
      <span class="brand__name">${site.firstName} ${site.lastName}</span>
      <span class="brand__role">${site.role}</span>
    </a>
    <div class="where" aria-live="polite">
      <span class="where__state"></span><span class="where__num"></span><span class="where__title"></span>
      <span class="where__progress" aria-hidden="true"><i></i></span>
    </div>
    <nav class="nav" aria-label="Feuilles">
      <span class="nav__group">Projets</span>${projects.map(link).join('')}
      <span class="nav__sep" aria-hidden="true"></span>${others.map(link).join('')}
    </nav>
    <div class="tools">
      <button type="button" class="tool" data-overview aria-label="Vue d’ensemble de la carte">${ICONS.map}<span>Carte</span><kbd>M</kbd></button>
      <button type="button" class="tool tool--icon" data-theme-toggle aria-label="Changer de thème">${ICONS.theme}</button>
      <button type="button" class="tool tool--icon tool--menu" data-menu aria-label="Menu" aria-expanded="false">${ICONS.menu}</button>
    </div>
  </header>
  <div class="ruler-corner" aria-hidden="true"></div>
  <canvas class="ruler ruler--top" aria-hidden="true"></canvas>
  <canvas class="ruler ruler--left" aria-hidden="true"></canvas>
  <main class="stage">
    <div class="world"></div>
    <div class="edges"></div>
    <div class="reticle" aria-hidden="true"><span class="reticle__ring"></span><span class="reticle__label"></span></div>
    <div class="minimap">
      <div class="minimap__head"><span>Carte</span><button type="button" data-overview aria-label="Vue d’ensemble">⤢ <kbd>M</kbd></button></div>
      <canvas class="minimap__canvas"></canvas>
    </div>
    <div class="overview-hint" aria-hidden="true"><span>Cliquez une feuille</span><span>Glissez pour vous déplacer</span><span>Molette : zoom</span><span><kbd>Échap</kbd> retour</span></div>
  </main>
  <footer class="status">
    <span class="status__group"><span class="k">X</span><b data-x>0</b><span class="k">Y</span><b data-y>0</b><span class="k">Z</span><b data-z>1,00</b></span>
    <span class="status__scale"><i class="scalebar" data-scalebar></i><b data-scale-label>100 px</b></span>
    <span class="status__group status__cursor"><span class="k">Curseur</span><b data-cx>—</b><b data-cy>—</b></span>
    <span class="status__spacer"></span>
    <span class="status__hint"><kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> naviguer <span class="dot">·</span> <kbd>M</kbd> carte <span class="dot">·</span> <kbd>0</kbd>–<kbd>${SHEETS.length - 1}</kbd> feuilles</span>
  </footer>
  <div class="menu" hidden>
    <ol class="menu__list">${SHEETS.map(menuLink).join('')}</ol>
    <button type="button" class="btn btn--ghost" data-overview>${ICONS.map} Vue d’ensemble</button>
  </div>`;
}

export class App {
  private stage!: HTMLElement;
  private world!: HTMLElement;
  private reticleLabel!: HTMLElement;
  private whereEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private scaleEls: HTMLElement[] = [];

  private geo = new Geometry();
  private bg = new Background();
  private rulers!: Rulers;
  private minimap!: Minimap;
  private edges!: EdgeMarkers;
  private status!: Status;

  private sheets: Sheet[] = [];
  private byId = new Map<string, Sheet>();
  private current!: Sheet;

  private cam: Cam = { x: 0, y: 0, z: 1 };
  private overview = false;
  private traveling = false;
  private tween: gsap.core.Tween | null = null;
  private trail: { from: Vec; alpha: number } | null = null;
  private visitedRoutes = new Set<string>();
  private scroll = 0;
  private scrollTarget = 0;
  private nudge = 0;
  private wheelX = 0;
  private wheelXTime = 0;
  private navLock = 0;
  private dirty = true;
  private revealCheck = false;
  private hoverId: string | null = null;
  private pointer = { x: 0, y: 0, inside: false, cx: 0, cy: 0 };
  private stageRect = new DOMRect();
  private drag: { x: number; y: number; camX: number; camY: number; moved: boolean; id: number } | null = null;
  private touch: { x: number; y: number; scroll: number; axis: 'x' | 'y' | null; lastY: number; lastT: number; vy: number; id: number } | null = null;
  private name?: NameProximity;
  private nameActive = false;
  private view!: HudView;

  constructor(private root: HTMLElement) {
    root.innerHTML = chromeHtml();
    this.stage = qs('.stage', root);
    this.world = qs('.world', root);
    this.stage.prepend(this.bg.canvas);
    this.reticleLabel = qs('.reticle__label', root);
    this.whereEl = qs('.where', root);
    this.progressEl = qs('.where__progress i', root);

    for (const def of SHEETS) {
      const el = buildSheet(def);
      el.tabIndex = -1;
      el.inert = true;
      this.world.appendChild(el);
      const sheet: Sheet = {
        def,
        el,
        visited: false,
        hatch: 1,
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

    const nameEl = root.querySelector<HTMLElement>('[data-hero-name]');
    if (nameEl) this.name = new NameProximity(nameEl);
    this.scaleEls = qsa('[data-scale]', root);
    startClock(qsa('[data-clock]', root), site.city, site.timezone);
    bindCopy(root);

    this.rulers = new Rulers(qs<HTMLCanvasElement>('.ruler--top', root), qs<HTMLCanvasElement>('.ruler--left', root));
    this.minimap = new Minimap(
      qs<HTMLCanvasElement>('.minimap__canvas', root),
      (id) => this.go(id),
      new Map(SHEETS.map((s) => [s.id, `${pad(s.num)} — ${s.title}`])),
    );
    this.edges = new EdgeMarkers(qs('.edges', root), SHEETS, (id) => this.go(id));
    this.status = new Status(qs('.status', root));

    const initial = location.pathname === OVERVIEW_PATH ? undefined : sheetFromPath(location.pathname);
    this.current = this.byId.get(initial?.id ?? 'index')!;
    if (!initial && location.pathname !== OVERVIEW_PATH) history.replaceState({}, '', '/');

    this.view = {
      cam: this.cam,
      geo: this.geo,
      currentId: this.current.def.id,
      overview: false,
      traveling: false,
      pointer: this.pointer,
      visited: new Set(),
    };

    this.layout();
    this.bindEvents();
    gsap.ticker.add((_t, delta) => this.frame(Math.min(delta / 1000, 0.05)));
    this.intro(location.pathname === OVERVIEW_PATH);

    document.fonts?.ready.then(() => this.layout());
  }

  /* ================================================================ layout */

  private layout() {
    const els = new Map(this.sheets.map((s) => [s.def.id, s.el]));
    this.geo.compute(this.stage, els);
    this.stageRect = this.stage.getBoundingClientRect();
    const { sw, sh } = this.geo;
    this.bg.resize(sw, sh);
    const ruler = parseFloat(getComputedStyle(this.root).getPropertyValue('--ruler-size')) || 0;
    this.rulers.resize(sw, sh, ruler);
    this.minimap.layout(this.geo);
    this.edges.measure();
    const mm = qs('.minimap', this.root).getBoundingClientRect();
    this.edges.avoid = mm.width
      ? { x: mm.left - this.stageRect.left, y: mm.top - this.stageRect.top, w: mm.width, h: mm.height }
      : null;

    // live bearings in the index and on the contact sheet
    for (const s of SHEETS) {
      const a = this.geo.get(s.id).anchor;
      qsa(`[data-cap="${s.id}"]`).forEach((el) => (el.textContent = fmtBearing(bearing(a.x, a.y))));
      qsa(`[data-dist="${s.id}"]`).forEach((el) => (el.textContent = fmtInt(Math.hypot(a.x, a.y))));
    }
    const c = this.geo.get('contact').anchor;
    const set = (sel: string, v: string) => qsa(sel).forEach((el) => (el.textContent = v));
    set('[data-self-x]', fmtInt(c.x));
    set('[data-self-y]', fmtInt(-c.y));
    set('[data-self-cap]', fmtBearing(bearing(c.x, c.y)));
    set('[data-self-dist]', `${fmtInt(Math.hypot(c.x, c.y))} px`);
    set('[data-self-head]', `X ${fmtInt(c.x)} · Y ${fmtInt(-c.y)}`);

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
      if (this.nameActive && this.name) {
        const inside = this.pointer.inside;
        if (this.name.tick(dt, inside ? this.pointer.cx : null, inside ? this.pointer.cy : null)) {
          /* letters are DOM: nothing else to redraw */
        }
      }
    }
    if (this.bg.pending) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.render();
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

    const v = this.view;
    v.currentId = this.current.def.id;
    v.overview = this.overview;
    v.traveling = this.traveling;
    v.visited = new Set(this.sheets.filter((s) => s.visited).map((s) => s.def.id));

    this.bg.draw({
      cam: this.cam,
      geo: this.geo,
      sheets: this.sheets.map((s) => ({ id: s.def.id, num: s.def.num, title: s.def.title, hatch: s.hatch })),
      currentId: this.current.def.id,
      overview: this.overview,
      hoverId: this.hoverId,
      visitedRoutes: this.visitedRoutes,
      trail: this.trail,
      parallax: reducedMotion.matches ? 0 : 1,
    });
    this.rulers.draw(v);
    this.minimap.draw(v);
    this.edges.update(v);
    this.status.update(v, this.scaleEls);

    if (this.traveling) this.reticleLabel.textContent = `X ${fmtInt(x)}  Y ${fmtInt(-y)}`;
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
    const prev = this.current;
    const fromOverview = this.overview || Math.abs(from.z - 1) > 0.02;

    this.leave(prev);
    this.overview = false;
    this.root.classList.remove('is-overview');
    this.hoverId = null;
    this.tween?.kill();
    this.traveling = true;
    this.root.classList.add('is-traveling');
    this.setWhere('going', target.def);
    this.trail = fromOverview ? null : { from: { x: from.x, y: from.y }, alpha: 1 };

    const done = () => this.arrive(target, prev);

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
      duration = clamp(0.78 + units * 0.3, 0.95, 1.9);
      const dip = clamp(0.1 + units * 0.11, 0.12, 0.5);
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
        this.progressEl.style.transform = `scaleX(${state.t})`;
        this.dirty = true;
      },
      onComplete: done,
    });
  }

  private arrive(target: Sheet, prev: Sheet) {
    this.traveling = false;
    this.tween = null;
    this.root.classList.remove('is-traveling');
    const key = routeKey(prev.def.id, target.def.id);
    if (prev !== target && this.geo.routes.some((r) => r.key === key)) this.visitedRoutes.add(key);
    this.current = target;
    this.scroll = this.scrollTarget = this.nudge = 0;
    const g = this.geo.get(target.def.id);
    Object.assign(this.cam, { x: g.anchor.x, y: g.anchor.y, z: 1 });
    if (this.trail) {
      gsap.to(this.trail, {
        alpha: 0,
        duration: 1,
        delay: 0.15,
        ease: 'power2.out',
        onUpdate: () => (this.dirty = true),
        onComplete: () => (this.trail = null),
      });
    }
    // apply the final camera before measuring what is in view
    this.dirty = false;
    this.render();
    this.enter(target);
    this.dirty = true;
  }

  private enter(s: Sheet) {
    s.el.inert = false;
    const first = !s.visited;
    if (first) {
      s.visited = true;
      gsap.to(s, { hatch: 0, duration: 0.9, ease: 'power2.out', onUpdate: () => (this.dirty = true) });
      const nameEl = s.el.querySelector<HTMLElement>('[data-hero-name]');
      if (nameEl) revealHeroName(nameEl, 0.05);
    }
    this.checkReveals(true);
    this.revealCheck = true;
    s.logs?.start();
    s.sim?.start();
    s.svgs.forEach((svg) => svg.unpauseAnimations());
    this.nameActive = s.def.kind === 'index' && !!this.name;
    this.edges.show(s.def.links);
    this.setWhere('here', s.def);
    qsa('[data-nav]', this.root).forEach((a) => a.classList.toggle('is-active', a.dataset.nav === s.def.id));
    document.title = s.def.kind === 'index' ? `${site.firstName} ${site.lastName} — ${site.role}` : `${s.def.title} — ${site.firstName} ${site.lastName}`;
    if (!s.el.contains(document.activeElement)) s.el.focus({ preventScroll: true });
  }

  private leave(s: Sheet) {
    s.el.inert = true;
    s.logs?.stop();
    s.sim?.stop();
    s.svgs.forEach((svg) => svg.pauseAnimations());
    this.nameActive = false;
    this.edges.hide();
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
        reveal(el, initial ? 0.12 + i * 0.07 : i * 0.06);
        i++;
        return false;
      }
      return true;
    });
  }

  private setWhere(state: 'here' | 'going' | 'map', def?: SheetDef) {
    this.whereEl.dataset.state = state;
    qs('.where__state', this.whereEl).textContent = state === 'going' ? 'En route' : state === 'map' ? 'Vue d’ensemble' : 'Feuille';
    qs('.where__num', this.whereEl).textContent = def ? pad(def.num) : '';
    qs('.where__title', this.whereEl).textContent = def ? def.title : `${SHEETS.length} feuilles`;
    this.progressEl.style.transform = `scaleX(${state === 'going' ? 0 : 1})`;
  }

  /* ============================================================== overview */

  enterOverview(push = true) {
    if (this.overview && !this.traveling) return;
    if (push && location.pathname !== OVERVIEW_PATH) history.pushState({}, '', OVERVIEW_PATH);
    this.closeMenu();
    this.leave(this.current);
    this.overview = true;
    this.root.classList.add('is-overview');
    this.setWhere('map');
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
    const edges = qs('.edges', this.root);
    edges.classList.remove('is-pulse');
    void edges.offsetWidth;
    edges.classList.add('is-pulse');
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
      ? { x: end.x + this.geo.sw * 0.08, y: end.y - this.geo.sh * 0.05, z: 0.62 }
      : { x: lerp(b.x + b.w / 2, end.x, 0.55), y: lerp(b.y + b.h / 2, end.y, 0.55), z: clamp(zFit * 1.9, 0.18, 0.42) };
    Object.assign(this.cam, start);
    this.bg.warm(start, 1);
    this.bg.warm(end, 1);
    this.traveling = true;
    this.root.classList.add('is-traveling');
    this.setWhere('going', this.current.def);
    gsap.to(this.bg, { intro: 1, duration: seen ? 0.6 : 1.1, ease: 'power2.out', onUpdate: () => (this.dirty = true) });

    if (toOverview) {
      this.traveling = false;
      this.root.classList.remove('is-traveling');
      this.enterOverview(false);
      return;
    }

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
        this.progressEl.style.transform = `scaleX(${state.t})`;
        this.dirty = true;
      },
      onComplete: () => this.arrive(this.current, this.current),
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

    // internal links → camera travel
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
      const a = t.closest('a');
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      e.preventDefault();
      if (href === OVERVIEW_PATH) return this.enterOverview();
      const def = sheetFromPath(href);
      if (def) this.go(def.id);
    });

    // pointer tracking (rulers, cursor readout, hero name, overview)
    window.addEventListener('pointermove', (e) => {
      this.pointer.cx = e.clientX;
      this.pointer.cy = e.clientY;
      const r = this.stageRect;
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointer.inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (e.pointerType === 'mouse') this.dirty = true;

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
        const hit = this.pointer.inside ? this.geo.hit(wx, wy, 20 / this.cam.z) : null;
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
      this.dirty = true;
    });

    this.stage.addEventListener('pointerdown', (e) => {
      if (this.overview && !this.traveling && e.button === 0) {
        if ((e.target as Element).closest('.minimap')) return;
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
        else this.bump(0);
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
    const dy = e.clientY - t.y;
    const g = this.geo.get(this.current.def.id);
    if (t.axis === 'x' && Math.abs(dx) > 50) {
      const id = this.neighbourToward(-Math.sign(dx), 0);
      if (id) this.go(id);
    } else if (t.axis === 'y') {
      if (g.maxScroll > 0) {
        this.scrollTarget = clamp(this.scrollTarget - t.vy * 320, 0, g.maxScroll);
      } else if (Math.abs(dy) > 60) {
        const id = this.neighbourToward(0, -Math.sign(dy));
        if (id) this.go(id);
      }
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
        this.cam.x += dir[0] * 240 / this.cam.z * 0.5;
        this.cam.y += dir[1] * 240 / this.cam.z * 0.5;
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
      else this.bump(dir[1] * 18 + dir[0] * 0);
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
        if (r.top < this.stageRect.top + 40 || r.bottom > this.stageRect.bottom - 40)
          this.scrollTarget = clamp(this.scrollTarget + (r.top - this.stageRect.top) - this.geo.sh * 0.4, 0, g.maxScroll);
      });
    }
  }
}
