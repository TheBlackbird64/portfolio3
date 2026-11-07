import type { Diagram } from '../content';
import { pad } from '../core/util';

const CW = 190; // column width
const RH = 96; // row height
const NW = 140; // node width
const NH = 52; // node height

/** Architecture schematic: orthogonal connectors, animated packets, technical styling. */
export function diagramSvg(d: Diagram, uid: string): string {
  const W = d.cols * CW;
  const H = d.rows * RH;
  const nodes = new Map(d.nodes.map((n) => [n.id, { ...n, cx: n.col * CW + CW / 2, cy: n.row * RH + RH / 2 }]));

  const edges = d.edges
    .map((e, i) => {
      const a = nodes.get(e.from)!;
      const b = nodes.get(e.to)!;
      let path: string;
      let len: number;
      if (a.col === b.col) {
        const dir = Math.sign(b.cy - a.cy);
        const sy = a.cy + (dir * NH) / 2;
        const ey = b.cy - (dir * NH) / 2;
        path = `M${a.cx} ${sy} V${ey}`;
        len = Math.abs(ey - sy);
      } else {
        const dir = Math.sign(b.cx - a.cx);
        const sx = a.cx + (dir * NW) / 2;
        const ex = b.cx - (dir * NW) / 2;
        if (a.row === b.row) {
          path = `M${sx} ${a.cy} H${ex}`;
          len = Math.abs(ex - sx);
        } else {
          const xm = Math.round((sx + ex) / 2);
          path = `M${sx} ${a.cy} H${xm} V${b.cy} H${ex}`;
          len = Math.abs(xm - sx) + Math.abs(b.cy - a.cy) + Math.abs(ex - xm);
        }
      }
      const pid = `${uid}-e${i}`;
      const dur = (len / 70 + 0.6).toFixed(2);
      const packets = [0, 0.5]
        .map(
          (o) =>
            `<circle class="dg-pkt" r="2.6"><animateMotion dur="${dur}s" begin="-${(o * Number(dur)).toFixed(2)}s" repeatCount="indefinite"><mpath href="#${pid}"/></animateMotion></circle>`,
        )
        .join('');
      return `<path id="${pid}" class="dg-edge" d="${path}" marker-end="url(#${uid}-arr)" data-draw/>${packets}`;
    })
    .join('');

  const nodeSvg = d.nodes
    .map((n, i) => {
      const { cx, cy } = nodes.get(n.id)!;
      const x = cx - NW / 2;
      const y = cy - NH / 2;
      const kind = n.kind ?? 'service';
      const extra =
        kind === 'store'
          ? `<path class="dg-store" d="M0 7 H${NW}"/>`
          : kind === 'core'
            ? `<rect class="dg-core-mark" x="${NW - 9}" y="5" width="4" height="4"/>`
            : '';
      return `<g class="dg-node dg-node--${kind}" transform="translate(${x} ${y})">
        <rect class="dg-box" width="${NW}" height="${NH}" data-draw/>
        ${extra}
        <text class="dg-idx" x="${NW - 8}" y="${NH - 8}" text-anchor="end">${pad(i + 1)}</text>
        <text class="dg-label" x="12" y="23">${n.label}</text>
        ${n.sub ? `<text class="dg-sub" x="12" y="39">${n.sub}</text>` : ''}
      </g>`;
    })
    .join('');

  return `<svg class="dg" viewBox="-12 -12 ${W + 24} ${H + 24}" role="img" aria-label="Schéma d’architecture">
    <defs>
      <marker id="${uid}-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path class="dg-arrow" d="M1 1 L9 5 L1 9"/>
      </marker>
    </defs>
    <g class="dg-grid">${Array.from({ length: d.cols + 1 }, (_, i) => `<path d="M${i * CW} -12 V${H + 12}"/>`).join('')}</g>
    ${edges}
    ${nodeSvg}
  </svg>`;
}
