import { projects, type Project } from '../content';

export type SheetKind = 'index' | 'projects' | 'project' | 'lab' | 'about' | 'contact';

/** Each region of the canvas has its own colour. */
export type Hue = 'orange' | 'blue' | 'violet' | 'red';

export interface SheetDef {
  id: string;
  num: number;
  path: string;
  kind: SheetKind;
  hue: Hue;
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

/*
 * The project selector sits right of the index. The project pages hang on either side
 * of it, one right, one left, and so on, going down in the selector's order.
 */
export const SHEETS: SheetDef[] = [
  { id: 'index', num: 0, path: '/', kind: 'index', hue: 'orange', title: 'Index', sub: 'Point de départ', gx: 0, gy: 0, links: ['projets', 'about', 'lab'] },
  { id: 'projets', num: 1, path: '/projets', kind: 'projects', hue: 'violet', title: 'Projets', sub: 'Choisir un projet', gx: 2.9, gy: -0.1, links: ['index', relay.slug, atlas.slug, ledger.slug, 'contact'] },
  { id: relay.slug, num: 2, path: `/projets/${relay.slug}`, kind: 'project', hue: 'violet', title: relay.name, sub: relay.kind, gx: 4.35, gy: -1.0, links: ['projets', atlas.slug], project: relay },
  { id: atlas.slug, num: 3, path: `/projets/${atlas.slug}`, kind: 'project', hue: 'blue', title: atlas.name, sub: atlas.kind, gx: 1.45, gy: 0.8, links: ['projets', ledger.slug], project: atlas },
  { id: ledger.slug, num: 4, path: `/projets/${ledger.slug}`, kind: 'project', hue: 'red', title: ledger.name, sub: ledger.kind, gx: 4.35, gy: 1.0, links: ['projets', 'contact'], project: ledger },
  { id: 'lab', num: 5, path: '/labo', kind: 'lab', hue: 'blue', title: 'Labo', sub: 'Compétences en marche', gx: -1.42, gy: 1.36, links: ['index', 'about'] },
  { id: 'about', num: 6, path: '/a-propos', kind: 'about', hue: 'violet', title: 'À propos', sub: 'Qui, pourquoi', gx: -1.56, gy: -1.3, links: ['index', 'lab'] },
  { id: 'contact', num: 7, path: '/contact', kind: 'contact', hue: 'orange', title: 'Contact', sub: 'Écrivez-moi', gx: 5.8, gy: 0.3, links: ['projets', ledger.slug] },
];

/** Sheets listed in the navigation (project pages are reached through the selector). */
export const NAV_SHEETS = SHEETS.filter((s) => s.kind !== 'project');
export const PROJECT_SHEETS = SHEETS.filter((s) => s.kind === 'project');

export const LAST_NUM = SHEETS.length - 1;

export const OVERVIEW_PATH = '/carte';

export function sheetFromPath(path: string): SheetDef | undefined {
  const clean = path.replace(/\/+$/, '') || '/';
  return SHEETS.find((s) => s.path === clean);
}
