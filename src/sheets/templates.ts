import { about, projects, site, skills, type Compare } from '../content';
import { ARROW, pad } from '../core/util';
import { diagramSvg } from './diagram';
import { highlight } from './highlight';
import { SHEETS, type SheetDef } from './registry';

const head = (def: SheetDef, right = '') => `
<header class="sheet-head">
  <span class="sheet-head__num">${pad(def.num)}</span>
  <span class="sheet-head__title">${def.kind === 'project' ? `Projet — ${def.title}` : def.title}</span>
  <span class="sheet-head__right">${right}</span>
</header>`;

const live = (label: string) => `<span class="live"><span class="live__dot" aria-hidden="true"></span>${label}</span>`;

const nameLine = (word: string, cls = '') =>
  `<span class="hero-name__line ${cls}" aria-hidden="true"><span class="hero-name__mask">${[...word]
    .map((c) => `<span class="ch">${c}</span>`)
    .join('')}</span></span>`;

/* ------------------------------------------------------------------ index */

function indexSheet(def: SheetDef) {
  const list = SHEETS.filter((s) => s.kind === 'project')
    .map((s, i) => {
      const p = projects[i];
      return `
      <li><a class="work__row" href="${s.path}" style="--accent: var(--${s.hue})">
        <span class="work__num">${pad(s.num)}</span>
        <span class="work__title">${s.title}</span>
        <span class="work__kind">${p.kind}</span>
        <span class="work__year">${p.year}</span>
      </a></li>`;
    })
    .join('');

  return `
  ${head(def, `${live(site.available)}<span data-clock>${site.city} — --:--</span>`)}
  <div class="index">
    <p class="kicker index__kicker" data-reveal>${site.role} · ${site.city}</p>
    <h1 class="hero-name" data-hero-name aria-label="${site.firstName} ${site.lastName}">
      ${nameLine(site.firstName)}${nameLine(site.lastName, 'hero-name__line--indent')}
    </h1>
    <div class="index__intro">
      <p class="lead" data-reveal="lines">${site.lead}</p>
      <div class="index__cta" data-reveal>
        <a class="btn btn--accent" href="${SHEETS[1].path}">Voir les projets ${ARROW}</a>
      </div>
    </div>
    <nav class="index__work" aria-label="Projets sélectionnés" data-reveal>
      <div class="work__head">Projets sélectionnés</div>
      <ol class="work">${list}</ol>
    </nav>
  </div>`;
}

/* ---------------------------------------------------------------- project */

const fmtNum = (n: number, decimals = 0) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function compareRow(c: Compare) {
  const max = Math.max(c.before, c.after, 1);
  const unit = c.unit ? (c.unit === '%' ? ' %' : ` ${c.unit}`) : '';
  const delta = c.before > 0 ? `−${Math.round((1 - c.after / c.before) * 100)} %` : '';
  return `
  <div class="cmp" data-reveal="bars">
    <div class="cmp__label">${c.label}</div>
    <div class="cmp__rows">
      <div class="cmp__row"><span class="cmp__tag">avant</span><span class="cmp__track"><span class="cmp__bar" style="--w:${(c.before / max) * 100}%"></span></span><span class="cmp__val">${fmtNum(c.before)}${unit}</span></div>
      <div class="cmp__row cmp__row--after"><span class="cmp__tag">après</span><span class="cmp__track"><span class="cmp__bar" style="--w:${Math.max((c.after / max) * 100, 0.6)}%"></span></span><span class="cmp__val">${fmtNum(c.after)}${unit}</span></div>
    </div>
    <div class="cmp__delta">${delta}</div>
  </div>`;
}

const section = (n: number, label: string, body: string, cls = '') => `
  <section class="case ${cls}">
    <h3 class="case__label" data-reveal><span>${pad(n)}</span>${label}</h3>
    <div class="case__body">${body}</div>
  </section>`;

function projectSheet(def: SheetDef) {
  const p = def.project!;
  const next = SHEETS[def.num + 1];

  const metrics = p.metrics
    .map(
      (m) => `
      <div class="metric" data-reveal>
        <div class="metric__value"><span data-count="${m.value}" data-decimals="${m.decimals ?? 0}">${fmtNum(0, m.decimals)}</span>${m.suffix ? `<span class="metric__suffix">${m.suffix}</span>` : ''}</div>
        <div class="metric__label">${m.label}</div>
      </div>`,
    )
    .join('');

  return `
  ${head(def, `${p.year} · ${p.duration}`)}
  <div class="proj-hero">
    <p class="kicker" data-reveal>${p.kind}</p>
    <h2 class="proj-title">${p.name}</h2>
    <p class="proj-tagline" data-reveal="lines">${p.tagline}</p>
    <div class="proj-hero__side" data-reveal>
      <p class="proj-summary">${p.summary}</p>
      <div class="logbox" data-logs>
        <div class="logbox__head"><span>${p.slug}.log</span>${live('live')}</div>
        <ol class="logbox__lines" aria-hidden="true"></ol>
      </div>
    </div>
  </div>
  <dl class="specs" data-reveal>
    <div><dt>Rôle</dt><dd>${p.role}</dd></div>
    <div><dt>Année</dt><dd>${p.year}</dd></div>
    <div><dt>Durée</dt><dd>${p.duration}</dd></div>
    <div><dt>Équipe</dt><dd>${p.team}</dd></div>
    <div class="specs__stack"><dt>Stack</dt><dd>${p.stack.map((s) => `<span class="chip">${s}</span>`).join('')}</dd></div>
  </dl>
  <div class="metrics">${metrics}</div>

  ${section(1, 'Contexte', p.context.map((t) => `<p data-reveal>${t}</p>`).join(''))}
  ${section(
    2,
    'Défis',
    `<ol class="challenges">${p.challenges
      .map((c, i) => `<li data-reveal><span class="challenges__idx">${'ABC'[i]}</span><h4>${c.title}</h4><p>${c.text}</p></li>`)
      .join('')}</ol>`,
  )}
  ${section(
    3,
    'Architecture',
    `<p data-reveal>${p.architecture.intro}</p>
     <figure class="diagram" data-hscroll data-reveal="draw">${diagramSvg(p.architecture.diagram, def.id)}</figure>
     <ol class="notes">${p.architecture.notes.map((n, i) => `<li data-reveal><span>${i + 1}</span>${n}</li>`).join('')}</ol>`,
  )}
  ${section(
    4,
    'Extrait',
    `<figure class="code" data-reveal>
       <figcaption class="code__head"><span class="code__file">${p.code.file}</span><span class="code__lang">${p.code.lang}</span></figcaption>
       <pre class="code__pre" data-hscroll><code>${highlight(p.code.source, p.code.lang)}</code></pre>
     </figure>
     <p class="code__caption" data-reveal>${p.code.caption}</p>`,
  )}
  ${section(5, 'Résultats', `<p data-reveal>${p.results.intro}</p><div class="compare">${p.results.compare.map(compareRow).join('')}</div>`)}
  ${section(6, 'Rétrospective', `<p class="retro" data-reveal="lines">${p.retro}</p>`)}

  <a class="next" href="${next.path}" data-reveal style="--accent: var(--${next.hue})">
    <span class="next__label">${next.kind === 'project' ? 'Projet suivant' : 'Ensuite'}</span>
    <span class="next__title">${next.title}<span class="next__arrow">${ARROW}</span></span>
    <span class="next__sub">${next.sub}</span>
  </a>`;
}

/* -------------------------------------------------------------------- lab */

function labSheet(def: SheetDef) {
  const rows = skills
    .map(
      (s) =>
        `<tr><td>${s.name}</td><td>${s.domain}</td><td><span class="lvl" data-l="${s.level}" aria-label="${s.level} sur 5">${'<i class="on"></i>'.repeat(s.level)}${'<i></i>'.repeat(5 - s.level)}</span></td></tr>`,
    )
    .join('');

  return `
  ${head(def)}
  <div class="lab">
    <div class="lab__intro">
      <h2 class="display">Labo</h2>
      <p class="statement" data-reveal="lines">Une liste de technos ne prouve rien. <em>Un système qui tourne, si.</em></p>
    </div>
    <div class="lab__grid">
      <figure class="sim" data-reveal data-sim>
        <figcaption class="sim__head"><span>Équilibreur de charge — simulation</span><span class="sim__hint">Cliquez un serveur pour le couper</span></figcaption>
        <div class="sim__stage"><canvas class="sim__canvas" aria-label="Simulation d’un équilibreur de charge"></canvas></div>
        <div class="sim__controls">
          <label class="sim__ctl"><span>Débit</span><input type="range" min="5" max="120" value="36" data-sim-rate /><output data-sim-rate-out>36 req/s</output></label>
          <div class="seg" role="radiogroup" aria-label="Algorithme de répartition">
            <button type="button" role="radio" aria-checked="true" data-algo="rr">Round-robin</button>
            <button type="button" role="radio" aria-checked="false" data-algo="lc">Moins de connexions</button>
          </div>
          <button type="button" class="btn btn--ghost btn--sm" data-sim-chaos>Chaos</button>
        </div>
        <div class="sim__stats">
          <div><span>Débit</span><b data-stat="tput">0</b><i>req/s</i></div>
          <div><span>p50</span><b data-stat="p50">0</b><i>ms</i></div>
          <div><span>p99</span><b data-stat="p99">0</b><i>ms</i></div>
          <div><span>Erreurs</span><b data-stat="err">0</b><i>%</i></div>
          <div class="sim__spark-wrap"><span>p99 · 30 s</span><canvas class="sim__spark" data-spark></canvas></div>
        </div>
      </figure>
      <div class="skills" data-reveal>
        <div class="skills__title">Compétences</div>
        <table class="skills__table">
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ about */

function aboutSheet(def: SheetDef) {
  return `
  ${head(def)}
  <div class="about">
    <div class="about__top">
      <h2 class="display">À propos</h2>
      <p class="statement statement--lg" data-reveal="lines">${about.statement}</p>
    </div>
    <figure class="portrait" data-reveal>
      <div class="portrait__frame"><span class="portrait__label">Photo à venir</span></div>
    </figure>
    <div class="about__bio">${about.bio.map((p) => `<p data-reveal>${p}</p>`).join('')}</div>
    <div class="about__principles">
      <div class="label" data-reveal>Principes</div>
      <ol class="principles">${about.principles
        .map((p, i) => `<li data-reveal><span class="principles__n">${pad(i + 1)}</span><div><h4>${p.title}</h4><p>${p.text}</p></div></li>`)
        .join('')}</ol>
    </div>
    <div class="route" data-reveal="route">
      <div class="label">Parcours</div>
      <ol class="route__list">${about.path
        .map((s) => `<li><span class="route__year">${s.year}</span><span class="route__dot" aria-hidden="true"></span><b>${s.title}</b><span>${s.text}</span></li>`)
        .join('')}</ol>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- contact */

function contactSheet(def: SheetDef) {
  return `
  ${head(def)}
  <div class="contact">
    <h2 class="display display--xl">Contact</h2>
    <p class="statement" data-reveal="lines">Un projet, une question, un poste ? <em>Écrivez-moi.</em></p>
    <div class="contact__grid">
      <div class="contact__col" data-reveal>
        <div class="label">Écrire</div>
        <a class="mail" href="mailto:${site.email}">${site.email}</a>
        <button type="button" class="btn btn--ghost btn--sm" data-copy="${site.email}">Copier l’adresse</button>
      </div>
      <div class="contact__col" data-reveal>
        <div class="label">Ailleurs</div>
        <ul class="links">${site.links
          .map((l) => `<li><a href="${l.href}" target="_blank" rel="noopener"><span>${l.label}</span><span class="links__handle">${l.handle}</span>${ARROW}</a></li>`)
          .join('')}</ul>
      </div>
      <div class="contact__col" data-reveal>
        <div class="label">Disponibilité</div>
        <p class="avail">${live(site.available)}</p>
        <p class="avail__meta"><span data-clock>${site.city} — --:--</span><br />Réponse sous 48 h</p>
        <a class="back" href="/"><span class="back__arrow">${ARROW}</span>Retour au début</a>
      </div>
    </div>
  </div>`;
}

const BUILDERS = { index: indexSheet, project: projectSheet, lab: labSheet, about: aboutSheet, contact: contactSheet };

export function buildSheet(def: SheetDef): HTMLElement {
  const el = document.createElement('section');
  el.className = `sheet sheet--${def.kind}`;
  el.id = `sheet-${def.id}`;
  el.dataset.sheet = def.id;
  el.style.setProperty('--accent', `var(--${def.hue})`);
  el.setAttribute('aria-label', `${pad(def.num)} — ${def.title}`);
  el.innerHTML = `<div class="sheet__inner">${BUILDERS[def.kind](def)}</div>`;
  return el;
}
