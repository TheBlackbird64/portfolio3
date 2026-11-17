import { gsap } from 'gsap';
import { pad, qs, qsa, reducedMotion } from '../core/util';
import type { Hue } from '../sheets/registry';

/*
 * Project selector: one project per screen, and the screen never scrolls. Each step
 * sends a slanted band across the whole screen (bottom to top going forward, top to
 * bottom going back). The next project is revealed behind the band, and its parts are
 * redrawn one by one as the band passes over them.
 */

/** How long the band takes to cross the screen (s). */
const SWEEP = 0.8;
/** Thickness of the band at full speed (mid-course), as a share of the screen height. */
const BAND = 0.09;
/** How far the outgoing project drifts away while it is covered (px). */
const DRIFT = 60;
/** Vertical drop of the band across the screen width (its slant), as a share of the screen width. */
const SLANT = 0.11;
/** A wheel gesture is over once the events stop for this long (ms): trackpad inertia stays one step. */
const GESTURE_GAP = 220;

interface Slide {
  el: HTMLElement;
  hue: Hue;
  parts: HTMLElement[];
}

export class Picker {
  index = 0;
  private slides: Slide[];
  private band: HTMLElement;
  private buttons: HTMLButtonElement[];
  private count: HTMLElement | null;
  private busy = false;
  private tween: gsap.core.Tween | null = null;
  private finish: (() => void) | null = null;
  private drawn = false;
  private wheelAcc = 0;
  private wheelLast = 0;
  private gestureUsed = false;

  constructor(
    private root: HTMLElement,
    private onChange: (index: number, hue: Hue) => void,
  ) {
    this.slides = qsa('[data-slide]', root).map((el) => ({ el, hue: el.dataset.hue as Hue, parts: qsa('[data-redraw]', el) }));
    this.band = qs('.picker__band', root);
    this.buttons = qsa<HTMLButtonElement>('[data-pick]', root);
    this.count = root.closest('.sheet')?.querySelector<HTMLElement>('[data-picker-count]') ?? null;
    // nothing is drawn until the first visit
    for (const s of this.slides) this.hide(s);
    root.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-pick]');
      if (b) this.go(Number(b.dataset.pick));
    });
  }

  get hue() {
    return this.slides[this.index].hue;
  }

  get size() {
    return this.slides.length;
  }

  /** Called when the camera arrives on the selector. */
  enter() {
    if (this.drawn) return;
    this.drawn = true;
    this.sweep(null, this.slides[this.index], 1);
  }

  /** Shows a project without any transition (e.g. when coming back from its page). */
  set(i: number) {
    if (i < 0 || i >= this.size) return;
    // settle any sweep still running
    if (this.tween) {
      this.tween.kill();
      this.finish?.();
    }
    if (i === this.index) return;
    const from = this.slides[this.index];
    const to = this.slides[i];
    from.el.classList.remove('is-active');
    this.deactivate(from);
    this.index = i;
    this.activate(to);
    if (this.drawn) this.show(to);
  }

  /** One step forward (1) or back (-1). Returns false at either end. */
  step(dir: number): boolean {
    const i = this.index + dir;
    if (i < 0 || i >= this.size) return false;
    this.go(i);
    return true;
  }

  /** Wheel input. Returns false when pushing past either end (the caller then bumps). */
  wheel(dy: number): boolean {
    const now = performance.now();
    if (now - this.wheelLast > GESTURE_GAP) {
      this.wheelAcc = 0;
      this.gestureUsed = false;
    }
    this.wheelLast = now;
    if (this.busy || this.gestureUsed) return true;
    this.wheelAcc += dy;
    if (Math.abs(this.wheelAcc) < 24) return true;
    this.gestureUsed = true;
    return this.step(Math.sign(this.wheelAcc));
  }

  go(i: number) {
    if (this.busy || i === this.index || i < 0 || i >= this.size) return;
    const from = this.slides[this.index];
    const to = this.slides[i];
    const dir = i > this.index ? 1 : -1;
    this.index = i;
    this.activate(to);
    if (!this.drawn) {
      this.deactivate(from);
      return;
    }
    this.sweep(from, to, dir);
  }

  /* ------------------------------------------------------------- internals */

  private activate(s: Slide) {
    s.el.classList.add('is-active');
    s.el.removeAttribute('aria-hidden');
    s.el.inert = false;
    this.buttons.forEach((b, k) => b.toggleAttribute('aria-current', k === this.index));
    if (this.count) this.count.textContent = `${pad(this.index + 1)} / ${pad(this.size)}`;
    this.root.style.setProperty('--accent', `var(--${s.hue})`);
    this.onChange(this.index, s.hue);
  }

  private deactivate(s: Slide) {
    s.el.classList.remove('is-active', 'is-front');
    s.el.setAttribute('aria-hidden', 'true');
    s.el.inert = true;
    s.el.style.clipPath = '';
    s.el.style.transform = '';
    s.el.style.opacity = '';
  }

  private hide(s: Slide) {
    gsap.killTweensOf(s.parts);
    gsap.set(s.parts, { autoAlpha: 0, y: 0 });
    const outline = s.el.querySelector<SVGRectElement>('.slide__card > .trace rect');
    if (outline) gsap.set(outline, { strokeDashoffset: 1 });
  }

  private show(s: Slide) {
    gsap.killTweensOf(s.parts);
    gsap.set(s.parts, { autoAlpha: 1, y: 0, clearProps: 'transform,clipPath' });
    const outline = s.el.querySelector<SVGRectElement>('.slide__card > .trace rect');
    if (outline) gsap.set(outline, { strokeDashoffset: 0 });
  }

  /** Redraws one part of a slide, the moment the band uncovers it. */
  private redraw(el: HTMLElement, dir: number) {
    if (el.classList.contains('slide__title')) {
      // the title is unmasked in the band's direction, rising into place
      // (the mask stays generous on the sides so descenders and the dot are never cut)
      const hidden = dir > 0 ? 'inset(100% -10% -40% -10%)' : 'inset(-20% -10% 100% -10%)';
      gsap.fromTo(
        el,
        { autoAlpha: 1, clipPath: hidden, y: 40 * dir },
        { clipPath: 'inset(-20% -10% -40% -10%)', y: 0, duration: 0.7, ease: 'expo.out', clearProps: 'transform,clipPath' },
      );
      return;
    }
    gsap.fromTo(el, { autoAlpha: 0, y: 22 * dir }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'expo.out', clearProps: 'transform' });
    if (el.dataset.redraw === 'card') {
      const outline = el.querySelector<SVGRectElement>(':scope > .trace rect');
      if (outline) gsap.fromTo(outline, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.85, ease: 'power3.inOut' });
      gsap.fromTo(
        el.querySelectorAll('.status > div, .status__cta'),
        { autoAlpha: 0, y: 12 * dir },
        { autoAlpha: 1, y: 0, duration: 0.5, ease: 'expo.out', stagger: 0.045 * dir, clearProps: 'transform' },
      );
    }
  }

  /**
   * The band crosses the screen; `to` is uncovered behind it while `from` stays put
   * underneath. With no `from` (first visit), the band simply draws the slide in.
   */
  private sweep(from: Slide | null, to: Slide, dir: number) {
    this.hide(to);
    to.el.classList.add('is-front');

    if (reducedMotion.matches) {
      if (from) this.deactivate(from);
      to.el.classList.remove('is-front');
      this.show(to);
      to.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
      return;
    }

    this.busy = true;
    // everything is measured in the band's frame: the whole screen around the sheet
    const box = this.band.getBoundingClientRect();
    const W = box.width;
    const H = box.height;
    const T = H * BAND;
    const S = Math.round(W * SLANT);
    const slideBox = to.el.getBoundingClientRect();
    const oL = slideBox.left - box.left;
    const oT = slideBox.top - box.top;
    const sw = slideBox.width;
    /** Height of the reveal edge at a given x, for an edge position y (right end). */
    const edge = (y: number, x: number) => y + S * (1 - x / W);
    const parts = to.parts.map((el) => {
      const r = el.getBoundingClientRect();
      return { el, x: r.left - box.left + r.width / 2, y: r.top - box.top + Math.min(r.height / 2, 60), done: false };
    });

    // going forward the band rises from below the screen to above it; going back, the reverse
    // (with room for the band and the line running ahead of it)
    const lead = T * 0.9;
    const y0 = dir > 0 ? H + T + lead : -S - T - lead;
    const y1 = dir > 0 ? -S : H;
    const state = { p: 0 };
    const big = 4000;
    this.band.style.setProperty('--band', `var(--${to.hue})`);
    this.band.classList.add('is-on');

    /** One slanted strip of the band, from offset a to offset b off the edge (in the direction of travel). */
    const strip = (y: number, a: number, b: number) => {
      const l = edge(y, 0);
      const r = edge(y, W);
      const k = -dir;
      return `0 ${l + k * a}px, ${W}px ${r + k * a}px, ${W}px ${r + k * b}px, 0 ${l + k * b}px`;
    };

    const update = () => {
      const p = state.p;
      const y = y0 + (y1 - y0) * p;
      // the band swells at full speed and thins out as it starts and stops
      const t = T * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, p * 1.1)));
      const line = Math.max(2, t * 0.07);
      // two strips in one polygon: the band on the edge, and a thin line running ahead of it
      this.band.style.clipPath = `polygon(${strip(y, 0, t)}, ${strip(y, t + lead * 0.55, t + lead * 0.55 + line)})`;

      const sl = edge(y, oL) - oT;
      const sr = edge(y, oL + sw) - oT;
      const below = (dy: number) => `polygon(0 ${sl - dy}px, ${sw}px ${sr - dy}px, ${sw}px ${big}px, 0 ${big}px)`;
      const above = (dy: number) => `polygon(0 ${-big}px, ${sw}px ${-big}px, ${sw}px ${sr - dy}px, 0 ${sl - dy}px)`;
      // the new slide shows on the side the band has passed, the old one only on the other,
      // drifting away and dimming as it goes
      to.el.style.clipPath = dir > 0 ? below(0) : above(0);
      if (from) {
        const drift = -dir * DRIFT * p;
        from.el.style.transform = `translateY(${drift}px)`;
        from.el.style.opacity = String(1 - 0.55 * p);
        from.el.style.clipPath = dir > 0 ? above(drift) : below(drift);
      }
      for (const q of parts) {
        if (q.done) continue;
        const e = edge(y, q.x);
        if (dir > 0 ? e <= q.y : e >= q.y) {
          q.done = true;
          this.redraw(q.el, dir);
        }
      }
    };
    update();

    this.finish = () => {
      for (const p of parts) if (!p.done) this.show(to);
      this.band.classList.remove('is-on');
      this.band.style.clipPath = '';
      to.el.style.clipPath = '';
      to.el.classList.remove('is-front');
      if (from) this.deactivate(from);
      this.busy = false;
      this.tween = null;
      this.finish = null;
    };
    this.tween = gsap.to(state, {
      p: 1,
      duration: SWEEP,
      ease: 'power3.inOut',
      onUpdate: update,
      onComplete: () => {
        for (const p of parts) if (!p.done) this.redraw(p.el, dir);
        parts.forEach((p) => (p.done = true));
        this.finish?.();
      },
    });
  }
}
