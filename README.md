# Portfolio — la carte

Un portfolio en une seule page où l'on ne change pas de page : la caméra **voyage sur un grand canvas**
(un « plan » technique) d'une feuille à l'autre.

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
| Position des feuilles sur la carte et leurs voisins | `src/sheets/registry.ts` (`gx`/`gy` en largeurs/hauteurs d'écran, `links`) |
| Couleurs des thèmes sombre / clair | `src/styles/tokens.css` |
| Mise en page des feuilles | `src/sheets/templates.ts` + `src/styles/sheets.css` |

## Organisation du code

- `src/app.ts` — la caméra : trajets (avec léger dézoom), vue d'ensemble, URLs, clavier / molette / tactile
- `src/core/geometry.ts` — placement des feuilles sur le canvas, calcul des routes
- `src/render/` — le fond en canvas : grille, courbes de niveau procédurales (parallaxe), routes cotées, hachures des zones inexplorées
- `src/hud/` — règles graduées, mini-carte, repères de bord, barre d'état
- `src/sheets/` — gabarits HTML, schémas d'architecture SVG, coloration syntaxique
- `src/fx/` — animations d'apparition, faux logs en direct, simulateur d'équilibreur de charge

## Raccourcis

`← ↑ → ↓` aller vers la feuille voisine (ou défiler dans un projet) · `M` vue d'ensemble · `0`–`6` aller à une feuille · `Échap` quitter la carte · `Espace` / `Page ↓` défiler

## Mise en ligne

```bash
npm run build
```

Le site final est dans `dist/`. Comme le site utilise de vraies URLs (`/projets/relay`…), l'hébergeur doit renvoyer
toutes les routes vers `index.html` (règle de réécriture sur Netlify / Vercel, ou copie de `index.html` en `404.html` sur GitHub Pages).
