/*
 * Tout le contenu du site est ici.
 * Les projets ci-dessous sont des PLACEHOLDERS : remplace-les par les tiens.
 * Le texte accepte <em>…</em> pour les passages en serif italique.
 */

export const site = {
  firstName: 'Gabriel',
  lastName: 'Dunogue',
  initials: 'GD',
  role: 'Développeur back-end',
  speciality: 'Back-end · systèmes distribués',
  city: 'Paris',
  timezone: 'Europe/Paris',
  available: 'Disponible',
  email: 'bonjour@exemple.dev',
  lead: 'Développeur back-end. Je conçois des systèmes <em>qui tiennent la charge</em> — et, de temps en temps, des interfaces qui sortent du cadre.',
  links: [
    { label: 'GitHub', handle: '@pseudo', href: 'https://github.com/' },
    { label: 'LinkedIn', handle: '/in/pseudo', href: 'https://www.linkedin.com/' },
    { label: 'CV', handle: 'PDF · 1 page', href: '#' },
  ],
};

export interface Metric {
  value: number;
  decimals?: number;
  suffix?: string;
  label: string;
}

export interface DiagramNode {
  id: string;
  label: string;
  sub?: string;
  col: number;
  row: number;
  kind?: 'client' | 'service' | 'store' | 'core';
}

export interface DiagramEdge {
  from: string;
  to: string;
}

export interface Diagram {
  cols: number;
  rows: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface Compare {
  label: string;
  before: number;
  after: number;
  unit: string;
}

export interface Project {
  slug: string;
  name: string;
  kind: string;
  tagline: string;
  summary: string;
  year: string;
  role: string;
  duration: string;
  team: string;
  stack: string[];
  metrics: Metric[];
  logs: string[];
  context: string[];
  challenges: { title: string; text: string }[];
  architecture: { intro: string; diagram: Diagram; notes: string[] };
  code: { file: string; lang: 'go' | 'rust' | 'kotlin'; caption: string; source: string };
  results: { intro: string; compare: Compare[] };
  retro: string;
}

export const projects: Project[] = [
  {
    slug: 'relay',
    name: 'Relay',
    kind: 'Broker de messages distribué',
    tagline: 'Un broker de messages distribué, <em>conçu pour ne jamais perdre un octet.</em>',
    summary:
      'Remplacement d’une file historique qui saturait aux heures de pointe par un broker partitionné, répliqué via Raft, avec un journal d’écriture maison et une gestion fine de la contre-pression.',
    year: '2025',
    role: 'Conception & dev. back-end',
    duration: '9 mois',
    team: '3 devs',
    stack: ['Go', 'gRPC', 'Raft', 'PostgreSQL', 'Prometheus'],
    metrics: [
      { value: 1.2, decimals: 1, suffix: ' M', label: 'messages / seconde, soutenus' },
      { value: 4, suffix: ' ms', label: 'latence p99 de bout en bout' },
      { value: 0, label: 'message perdu en 14 mois de prod' },
    ],
    logs: [
      'leader-{p} commit offset={o} batch={b} fsync={f}ms',
      'gw accept stream client=svc-{c} window={w}',
      'raft term={t} append entries={b} follower=A ack',
      'raft term={t} append entries={b} follower=B ack',
      'wal segment-{s} rotate size=256MiB',
      'backpressure client=svc-{c} credit={w} → throttled',
    ],
    context: [
      'L’ancienne file de messages tenait le coup… jusqu’au pic de 18 h. Au-delà de 200 000 messages par seconde, les consommateurs décrochaient, les files gonflaient et il fallait redémarrer des nœuds à la main.',
      'L’objectif : un broker capable d’absorber six fois la charge, sans perte de message, avec un ordre garanti par partition et une exploitation simple pour l’équipe d’astreinte.',
    ],
    challenges: [
      { title: 'Ordre garanti', text: 'Chaque partition a un leader unique élu par Raft ; les écritures sont totalement ordonnées, même pendant une bascule.' },
      { title: 'Durabilité sans lenteur', text: 'Un fsync par message est hors de prix. Les écritures sont regroupées en lots, rendus durables en un seul appel système.' },
      { title: 'Contre-pression', text: 'Un consommateur lent ne doit jamais faire tomber le cluster : un système de crédits ralentit les producteurs à la source.' },
    ],
    architecture: {
      intro: 'Les producteurs parlent gRPC à une passerelle sans état. Chaque partition est un petit groupe Raft dont le leader écrit dans un journal (WAL) avant de répliquer.',
      diagram: {
        cols: 5,
        rows: 3,
        nodes: [
          { id: 'prod', label: 'Producteurs', sub: 'services', col: 0, row: 1, kind: 'client' },
          { id: 'gw', label: 'Gateway', sub: 'gRPC · sans état', col: 1, row: 1 },
          { id: 'lead', label: 'Leader', sub: 'partition n', col: 2, row: 1, kind: 'core' },
          { id: 'fa', label: 'Follower A', sub: 'réplique', col: 3, row: 0 },
          { id: 'wal', label: 'WAL', sub: 'segments 256 Mio', col: 3, row: 1, kind: 'store' },
          { id: 'fb', label: 'Follower B', sub: 'réplique', col: 3, row: 2 },
          { id: 'cons', label: 'Consommateurs', sub: 'groupes', col: 4, row: 1, kind: 'client' },
        ],
        edges: [
          { from: 'prod', to: 'gw' },
          { from: 'gw', to: 'lead' },
          { from: 'lead', to: 'fa' },
          { from: 'lead', to: 'wal' },
          { from: 'lead', to: 'fb' },
          { from: 'wal', to: 'cons' },
        ],
      },
      notes: [
        'La passerelle ne garde aucun état : on peut en ajouter ou en retirer à chaud.',
        'Un message n’est acquitté qu’après écriture sur une majorité de répliques.',
        'Les consommateurs lisent directement les segments du WAL, sans copie.',
      ],
    },
    code: {
      file: 'internal/wal/append.go',
      lang: 'go',
      caption: 'Le fsync groupé : là où se gagne l’essentiel du débit.',
      source: `// Append écrit un lot de messages dans le WAL et ne rend la main
// qu'une fois le lot durable sur disque (fsync groupé).
func (w *WAL) Append(ctx context.Context, batch []Message) (Offset, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	start := w.next
	for _, m := range batch {
		if err := w.enc.Encode(w.next, m); err != nil {
			return 0, fmt.Errorf("wal: encode %d: %w", w.next, err)
		}
		w.next++
	}

	// Un seul fsync pour tout le lot : c'est ici que se gagne le débit.
	if err := w.syncer.Sync(ctx); err != nil {
		w.next = start // rollback logique, le segment sera tronqué
		return 0, err
	}
	return start, nil
}`,
    },
    results: {
      intro: 'Mesures sur le cluster de production, à charge réelle, avant et après la migration.',
      compare: [
        { label: 'Latence p99', before: 38, after: 4, unit: 'ms' },
        { label: 'Nœuds nécessaires', before: 24, after: 9, unit: '' },
        { label: 'Alertes d’astreinte / mois', before: 31, after: 2, unit: '' },
      ],
    },
    retro:
      'Si c’était à refaire, je commencerais par l’outillage de test de pannes. On l’a écrit au milieu du projet, et <em>chaque bug sérieux trouvé ensuite l’a été grâce à lui.</em>',
  },
  {
    slug: 'atlas',
    name: 'Atlas',
    kind: 'Moteur de recherche géospatiale',
    tagline: 'Deux milliards de points sur la carte, <em>et une réponse avant qu’on ait fini de cliquer.</em>',
    summary:
      'Un service de recherche de proximité qui découpe la planète en cellules hexagonales, garde les zones chaudes en cache et répond aux requêtes « autour de moi » en quelques dizaines de millisecondes.',
    year: '2024',
    role: 'Lead back-end',
    duration: '6 mois',
    team: '2 devs',
    stack: ['Rust', 'Axum', 'H3', 'PostGIS', 'Redis'],
    metrics: [
      { value: 2.1, decimals: 1, suffix: ' Md', label: 'points indexés' },
      { value: 38, suffix: ' ms', label: 'p95 pour un rayon de 5 km' },
      { value: 72, suffix: ' %', label: 'de coût d’infrastructure en moins' },
    ],
    logs: [
      'query nearby r={r}m res={s} cells={b} hits={o}',
      'cache hit ratio={h}% shard={c}',
      'ingest batch={b} points dedup={w}',
      'compaction cell-res{s} merged={b}',
      'query nearby r={r}m res={s} cells={b} hits={o}',
    ],
    context: [
      'Les recherches « autour de moi » passaient par des requêtes PostGIS génériques. Correctes, mais lentes dès que la zone était dense, et de plus en plus chères à mesure que la base grossissait.',
      'Il fallait un service dédié : rapide sur les zones denses, prévisible en coût, et capable d’ingérer des millions de nouveaux points par heure.',
    ],
    challenges: [
      { title: 'Découpage du monde', text: 'Grille hexagonale H3 multi-résolution : la taille des cellules s’adapte au rayon demandé.' },
      { title: 'Zones chaudes', text: 'Quelques centaines de cellules concentrent la moitié du trafic : elles vivent en mémoire, le reste sur disque.' },
      { title: 'Ingestion continue', text: 'Les écritures arrivent en flux ; une compaction en tâche de fond garde les cellules compactes.' },
    ],
    architecture: {
      intro: 'L’API calcule l’ensemble des cellules qui couvrent le cercle demandé, les lit en parallèle depuis le cache, puis filtre au mètre près.',
      diagram: {
        cols: 5,
        rows: 3,
        nodes: [
          { id: 'cli', label: 'Clients', sub: 'apps mobiles', col: 0, row: 1, kind: 'client' },
          { id: 'api', label: 'API Axum', sub: 'Rust', col: 1, row: 1 },
          { id: 'plan', label: 'Planner H3', sub: 'couverture', col: 2, row: 1, kind: 'core' },
          { id: 'hot', label: 'Cache chaud', sub: 'Redis', col: 3, row: 0, kind: 'store' },
          { id: 'cold', label: 'PostGIS', sub: 'cellules froides', col: 3, row: 2, kind: 'store' },
          { id: 'ing', label: 'Ingestion', sub: 'flux', col: 4, row: 2 },
          { id: 'cmp', label: 'Compaction', sub: 'tâche de fond', col: 4, row: 0 },
        ],
        edges: [
          { from: 'cli', to: 'api' },
          { from: 'api', to: 'plan' },
          { from: 'plan', to: 'hot' },
          { from: 'plan', to: 'cold' },
          { from: 'ing', to: 'cold' },
          { from: 'cmp', to: 'hot' },
        ],
      },
      notes: [
        'La résolution H3 est choisie selon le rayon : peu de grosses cellules ou beaucoup de petites.',
        'Les cellules sont lues par paquets de 64, en parallèle.',
        'Le filtrage exact ne se fait qu’à la toute fin, sur un petit ensemble.',
      ],
    },
    code: {
      file: 'src/query/nearby.rs',
      lang: 'rust',
      caption: 'Ne lire que les cellules qui touchent le cercle — tout le reste en découle.',
      source: `/// Renvoie les points dans un rayon donné, en ne lisant
/// que les cellules H3 qui intersectent le cercle.
pub async fn nearby(&self, center: LatLng, radius_m: f64) -> Result<Vec<Point>, AtlasError> {
    let res = self.resolution_for(radius_m);
    let origin = center.to_cell(res);
    let ring = origin.grid_disk::<Vec<_>>(self.k_for(radius_m, res));

    let mut hits = Vec::with_capacity(256);
    for chunk in ring.chunks(64) {
        let cells = self.cache.get_many(chunk).await?;
        hits.extend(
            cells.into_iter()
                .flatten()
                .filter(|p| p.distance_m(&center) <= radius_m),
        );
    }
    hits.sort_unstable_by(|a, b| a.dist_cmp(b, &center));
    Ok(hits)
}`,
    },
    results: {
      intro: 'Comparaison avec l’ancienne approche PostGIS seule, sur le même jeu de requêtes rejoué.',
      compare: [
        { label: 'Latence p95 (5 km)', before: 410, after: 38, unit: 'ms' },
        { label: 'Coût mensuel', before: 100, after: 28, unit: '%' },
        { label: 'Temps d’ingestion / Mpts', before: 95, after: 11, unit: 's' },
      ],
    },
    retro:
      'La plus grosse victoire n’est pas venue du code Rust, mais d’un tableau Excel : <em>regarder où tombaient vraiment les requêtes</em> a changé toute l’architecture du cache.',
  },
  {
    slug: 'ledger',
    name: 'Ledger',
    kind: 'API de paiement idempotente',
    tagline: 'Un client peut réessayer dix fois : <em>on ne débitera qu’une seule fois.</em>',
    summary:
      'Refonte d’une API de paiement autour de l’event sourcing et des clés d’idempotence, pour que les pannes réseau, les doubles clics et les réessais automatiques ne coûtent plus jamais rien à personne.',
    year: '2023',
    role: 'Dev. back-end',
    duration: '1 an',
    team: '5 devs',
    stack: ['Kotlin', 'Kafka', 'PostgreSQL', 'Debezium', 'Kubernetes'],
    metrics: [
      { value: 99.99, decimals: 2, suffix: ' %', label: 'de disponibilité sur 12 mois' },
      { value: 0, label: 'double débit depuis la mise en prod' },
      { value: 3, suffix: '×', label: 'plus de débit à matériel égal' },
    ],
    logs: [
      'charge key={k} account=acc_{c} amount={w}.00 → accepted',
      'charge key={k} replay → cached result',
      'event ChargeRequested v={o} stream=acc_{c}',
      'outbox relay published={b} lag={f}ms',
      'projection balances offset={o} ok',
    ],
    context: [
      'Quelques doubles débits par semaine : rares, mais à chaque fois un client mécontent, un remboursement manuel et une enquête de plusieurs heures dans les logs.',
      'La cause : des réessais réseau qui recréaient des opérations déjà faites. Il fallait rendre chaque opération idempotente, et pouvoir rejouer l’historique complet d’un compte.',
    ],
    challenges: [
      { title: 'Idempotence', text: 'Chaque requête porte une clé ; la même clé renvoie toujours le même résultat, sans ré-exécuter.' },
      { title: 'Historique complet', text: 'L’état d’un compte est la somme de ses événements : on peut tout rejouer, tout auditer.' },
      { title: 'Publication fiable', text: 'Pattern outbox + Debezium : un événement en base est forcément publié dans Kafka.' },
    ],
    architecture: {
      intro: 'Les commandes passent par l’API, qui vérifie la clé d’idempotence et écrit l’événement dans la même transaction. Debezium publie ensuite le journal dans Kafka.',
      diagram: {
        cols: 5,
        rows: 3,
        nodes: [
          { id: 'cli', label: 'Clients', sub: 'web · mobile', col: 0, row: 1, kind: 'client' },
          { id: 'api', label: 'API', sub: 'Kotlin', col: 1, row: 1 },
          { id: 'idem', label: 'Idempotence', sub: 'clés + empreintes', col: 2, row: 0, kind: 'store' },
          { id: 'store', label: 'Event store', sub: 'PostgreSQL', col: 2, row: 1, kind: 'core' },
          { id: 'cdc', label: 'Debezium', sub: 'outbox', col: 3, row: 1 },
          { id: 'kafka', label: 'Kafka', sub: 'événements', col: 4, row: 1, kind: 'store' },
          { id: 'proj', label: 'Projections', sub: 'soldes', col: 4, row: 2 },
        ],
        edges: [
          { from: 'cli', to: 'api' },
          { from: 'api', to: 'idem' },
          { from: 'api', to: 'store' },
          { from: 'store', to: 'cdc' },
          { from: 'cdc', to: 'kafka' },
          { from: 'kafka', to: 'proj' },
        ],
      },
      notes: [
        'Clé d’idempotence et événement sont écrits dans la même transaction.',
        'Une empreinte du contenu détecte une clé réutilisée pour une autre opération.',
        'Les soldes sont des projections : on peut les reconstruire à tout moment.',
      ],
    },
    code: {
      file: 'payments/ChargeService.kt',
      lang: 'kotlin',
      caption: 'Même clé, même effet — quel que soit le nombre de réessais.',
      source: `// Une même clé d'idempotence = un seul effet, même si le client réessaie 10 fois.
suspend fun charge(cmd: ChargeCommand): ChargeResult =
    db.transaction {
        val existing = idempotency.find(cmd.key)
        if (existing != null) {
            require(existing.fingerprint == cmd.fingerprint()) {
                "Clé réutilisée avec un contenu différent"
            }
            return@transaction existing.result
        }

        val event = ChargeRequested(cmd.accountId, cmd.amount, cmd.key)
        events.append(cmd.accountId, event, expectedVersion = cmd.version)
        val result = ChargeResult.Accepted(event.id)

        idempotency.save(cmd.key, cmd.fingerprint(), result)
        result
    }`,
    },
    results: {
      intro: 'Sur les douze mois qui ont suivi la mise en production, comparés aux douze précédents.',
      compare: [
        { label: 'Doubles débits', before: 140, after: 0, unit: '' },
        { label: 'Temps moyen d’enquête', before: 180, after: 15, unit: 'min' },
        { label: 'Latence p99', before: 220, after: 95, unit: 'ms' },
      ],
    },
    retro:
      'L’event sourcing a un coût : plus de concepts, plus de code. Je le referais pour ce domaine, mais <em>je ne le mettrais plus partout par réflexe.</em>',
  },
];

export const about = {
  statement:
    'J’aime les systèmes <em>qui ne tombent pas</em>, les logs <em>qui disent la vérité</em>, et les interfaces qui donnent envie de cliquer.',
  bio: [
    'Je suis développeur back-end : API, bases de données, files de messages, tout ce qui tourne quand personne ne regarde. Mon terrain de jeu, ce sont les systèmes qui doivent tenir la charge et rester lisibles pour l’équipe qui les opère.',
    'À côté, j’ai un faible pour les interfaces qui sortent de l’ordinaire — ce site en est la preuve. Je pense qu’un bon back-end et une bonne interface partagent la même chose : on ne remarque leur qualité que lorsqu’elle manque.',
  ],
  principles: [
    { title: 'Mesurer avant d’optimiser', text: 'Un profil vaut mieux que trois intuitions.' },
    { title: 'L’idempotence n’est pas une option', text: 'Le réseau finira toujours par réessayer à votre place.' },
    { title: 'Les logs sont une interface', text: 'Quelqu’un les lira à 3 h du matin. Écrivez pour cette personne.' },
  ],
  path: [
    { year: '2019', title: 'Premières lignes', text: 'Licence informatique' },
    { year: '2021', title: 'Stage', text: 'API & intégrations' },
    { year: '2022', title: 'Dev back-end', text: 'Paiement · Kotlin' },
    { year: '2024', title: 'Lead back-end', text: 'Géospatial · Rust' },
    { year: '2026', title: 'Aujourd’hui', text: 'Systèmes distribués' },
  ],
};

export const skills = [
  { name: 'Go', domain: 'Langage', level: 5 },
  { name: 'Rust', domain: 'Langage', level: 4 },
  { name: 'Kotlin / JVM', domain: 'Langage', level: 4 },
  { name: 'PostgreSQL', domain: 'Données', level: 5 },
  { name: 'Kafka', domain: 'Messages', level: 4 },
  { name: 'Redis', domain: 'Données', level: 4 },
  { name: 'gRPC / REST', domain: 'API', level: 5 },
  { name: 'Kubernetes', domain: 'Infra', level: 3 },
  { name: 'Observabilité', domain: 'Exploitation', level: 4 },
  { name: 'TypeScript', domain: 'Langage', level: 3 },
];
