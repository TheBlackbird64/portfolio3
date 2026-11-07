import { projects, type Project } from '../content';

export type SheetKind = 'index' | 'project' | 'lab' | 'about' | 'contact';

export interface SheetDef {
  id: string;
  num: number;
  path: string;
  kind: SheetKind;
  /** Label used in the HUD, markers and the map. */
  title: string;
  /** Short descriptor shown next to the title. */
  sub: string;
  /**
   * Position of the sheet's slot on the canvas, in stage units
   * (1 = one stage width / height). Angles are intentionally irregular.
   */
  gx: number;
  gy: number;
  /** Neighbours: drawn as routes on the canvas and offered as edge markers. */
  links: string[];
  project?: Project;
}

const [relay, atlas, ledger] = projects;

export const SHEETS: SheetDef[] = [
  { id: 'index', num: 0, path: '/', kind: 'index', title: 'Index', sub: 'Point de départ', gx: 0, gy: 0, links: ['relay', 'about', 'lab'] },
  { id: relay.slug, num: 1, path: `/projets/${relay.slug}`, kind: 'project', title: relay.name, sub: relay.kind, gx: 1.46, gy: -0.56, links: ['index', atlas.slug], project: relay },
  { id: atlas.slug, num: 2, path: `/projets/${atlas.slug}`, kind: 'project', title: atlas.name, sub: atlas.kind, gx: 2.9, gy: -1.42, links: [relay.slug, ledger.slug], project: atlas },
  { id: ledger.slug, num: 3, path: `/projets/${ledger.slug}`, kind: 'project', title: ledger.name, sub: ledger.kind, gx: 4.32, gy: -0.82, links: [atlas.slug, 'contact'], project: ledger },
  { id: 'lab', num: 4, path: '/labo', kind: 'lab', title: 'Labo', sub: 'Compétences en marche', gx: -1.42, gy: 1.36, links: ['index', 'about'] },
  { id: 'about', num: 5, path: '/a-propos', kind: 'about', title: 'À propos', sub: 'Qui, pourquoi', gx: -1.56, gy: -1.3, links: ['index', 'lab'] },
  { id: 'contact', num: 6, path: '/contact', kind: 'contact', title: 'Coordonnées', sub: 'Me contacter', gx: 5.76, gy: 0.5, links: [ledger.slug] },
];

export const LAST_NUM = SHEETS.length - 1;

export const OVERVIEW_PATH = '/carte';

export function sheetFromPath(path: string): SheetDef | undefined {
  const clean = path.replace(/\/+$/, '') || '/';
  return SHEETS.find((s) => s.path === clean);
}
