import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { reducedMotion } from '../core/util';

gsap.registerPlugin(SplitText);

const fmt = (n: number, decimals: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function countUp(el: HTMLElement, delay: number) {
  const target = parseFloat(el.dataset.count ?? '0');
  const decimals = parseInt(el.dataset.decimals ?? '0', 10);
  if (reducedMotion.matches) {
    el.textContent = fmt(target, decimals);
    return;
  }
  // zero is more telling when you watch it fall
  const o = { v: target === 0 ? 100 : 0 };
  el.textContent = fmt(o.v, decimals);
  gsap.to(o, {
    v: target,
    duration: target === 0 ? 1.4 : 1.8,
    delay,
    ease: 'expo.out',
    onUpdate: () => (el.textContent = fmt(decimals ? o.v : Math.round(o.v), decimals)),
  });
}

function drawSvg(el: HTMLElement, delay: number) {
  gsap.set(el, { opacity: 1 });
  const strokes = Array.from(el.querySelectorAll<SVGGeometryElement>('[data-draw]'));
  const boxes = strokes.filter((s) => s.tagName === 'rect');
  const edges = strokes.filter((s) => s.tagName === 'path');
  for (const s of strokes) {
    const len = s.getTotalLength();
    s.style.strokeDasharray = `${len}`;
    s.style.strokeDashoffset = `${len}`;
  }
  const tl = gsap.timeline({ delay });
  tl.to(boxes, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut', stagger: 0.06, clearProps: 'strokeDasharray,strokeDashoffset' });
  tl.from(el.querySelectorAll('.dg-node text, .dg-store, .dg-core-mark'), { opacity: 0, duration: 0.5, stagger: 0.02 }, 0.35);
  tl.to(edges, { strokeDashoffset: 0, duration: 0.7, ease: 'power2.inOut', stagger: 0.08, clearProps: 'strokeDasharray,strokeDashoffset' }, 0.5);
  tl.from(el.querySelectorAll('.dg-pkt, .dg-arrow'), { opacity: 0, duration: 0.6 }, '-=0.3');
}

function bars(el: HTMLElement, delay: number) {
  gsap.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out', delay, clearProps: 'transform' });
  gsap.from(el.querySelectorAll('.cmp__bar'), { scaleX: 0, duration: 1.3, ease: 'expo.out', stagger: 0.14, delay: delay + 0.15 });
  gsap.from(el.querySelectorAll('.cmp__delta'), { opacity: 0, x: -8, duration: 0.8, ease: 'expo.out', delay: delay + 0.6 });
}

function route(el: HTMLElement, delay: number) {
  gsap.set(el, { opacity: 1 });
  const list = el.querySelector('.route__list');
  const items = el.querySelectorAll('.route__list li');
  gsap.fromTo(list, { '--draw': 0 }, { '--draw': 1, duration: 1.6, ease: 'power3.inOut', delay });
  gsap.from(items, { opacity: 0, y: 10, duration: 0.7, ease: 'expo.out', stagger: 0.16, delay: delay + 0.2 });
}

function lines(el: HTMLElement, delay: number) {
  gsap.set(el, { opacity: 1 });
  const split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'split-line' });
  gsap.from(split.lines, {
    yPercent: 110,
    duration: 1.1,
    ease: 'expo.out',
    stagger: 0.09,
    delay,
    onComplete: () => split.revert(),
  });
}

/** Reveals one element according to its data-reveal flavour. Idempotent. */
export function reveal(el: HTMLElement, delay = 0) {
  if (el.classList.contains('is-in')) return;
  el.classList.add('is-in');
  const counters = el.querySelectorAll<HTMLElement>('[data-count]');
  if (reducedMotion.matches) {
    counters.forEach((c) => countUp(c, 0));
    return;
  }
  switch (el.dataset.reveal) {
    case 'lines':
      lines(el, delay);
      break;
    case 'draw':
      drawSvg(el, delay);
      break;
    case 'bars':
      bars(el, delay);
      break;
    case 'route':
      route(el, delay);
      break;
    default:
      gsap.fromTo(el, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 1, ease: 'expo.out', delay, clearProps: 'transform,opacity' });
  }
  counters.forEach((c) => countUp(c, delay + 0.1));
}

export function revealHeroName(el: HTMLElement, delay = 0) {
  if (el.classList.contains('is-in')) return;
  el.classList.add('is-in');
  if (reducedMotion.matches) return;
  gsap.fromTo(
    el.querySelectorAll('.ch'),
    { yPercent: 160 },
    { yPercent: 0, duration: 1.3, ease: 'expo.out', stagger: 0.045, delay },
  );
}
