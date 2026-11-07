# Portfolio

Un portfolio en une seule page où l'on ne change pas de page : la caméra **voyage sur un grand canvas**
d'une section à l'autre. Chaque région du canvas a sa couleur (orange, violet, bleu, rouge) et des
rectangles abstraits flottent en profondeur dans deux coins opposés de chaque section.

> La première version (thème « plan / cartographie », règles, mini-carte) est conservée sur la branche `v1-carte`.

## Lancer

```bash
npm install
npm run dev
```

Puis ouvrir http://127.0.0.1:5173

## Où modifier quoi

| Quoi | Fichier |
| --- | --- |
| Textes, projets, compétences, liens | `src/content.ts` (les projets actuels sont des **placeholders**) |
| Position des sections sur le canvas, leur couleur (`hue`) et leurs voisins | `src/sheets/registry.ts` (`gx`/`gy` en largeurs/hauteurs d'écran, `links`) |
| Couleurs des thèmes sombre / clair | `src/styles/tokens.css` |
| Composition des rectangles du fond | `src/render/background.ts` (`cluster()`) |
| Mise en page des feuilles | `src/sheets/templates.ts` + `src/styles/sheets.css` |

## Organisation du code

- `src/app.ts` — la caméra : trajets (avec léger dézoom), vue d'ensemble, URLs, clavier / molette / tactile
- `src/core/geometry.ts` — placement des sections sur le canvas
- `src/core/nav.ts` — la navigation fixe, dont les flèches pointent toujours vers leur section
- `src/render/background.ts` — le fond : rectangles animés avec parallaxe, contours de la vue d'ensemble
- `src/sheets/` — gabarits HTML, schémas d'architecture SVG, coloration syntaxique
- `src/fx/` — animations d'apparition, faux logs en direct, simulateur d'équilibreur de charge

## Raccourcis

`← ↑ → ↓` aller vers la section voisine (ou défiler dans un projet) · `M` vue d'ensemble · `0`–`6` aller à une section · `Échap` quitter la vue d'ensemble · `Espace` / `Page ↓` défiler

## Mise en ligne

```bash
npm run build
```

Le site final est dans `dist/`. Comme le site utilise de vraies URLs (`/projets/relay`…), l'hébergeur doit renvoyer
toutes les routes vers `index.html` (règle de réécriture sur Netlify / Vercel, ou copie de `index.html` en `404.html` sur GitHub Pages).
