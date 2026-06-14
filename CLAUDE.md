# CLAUDE.md — BBIscout

Contexte persistant du projet. Lu automatiquement au début de chaque session Claude Code.
Dernière mise à jour : 14/06/2026 (refonte complète, état S1 → S13).

---

## 1. Le projet en une minute

**BBIscout** (ex-Scout, ex-BBInvest) est l'outil interne de Vincent (Korr, Luxembourg) pour son client **BBI / Brouwers Bureau Immobilier** : scraping d'atHome.lu + scoring automatique de biens en stratégie **achat – rénovation – revente** à Luxembourg-Ville. Utilisé à deux : **Vincent** et **Jamie**, chacun à distance.

- App : `https://scout-production-8d09.up.railway.app/` — **ouverte volontairement, sans mot de passe** (décision actée, toute l'auth a été supprimée du repo).
- Déploiement : **Railway**, automatique à chaque push sur la branche principale (`main`).
- Nom affiché : « BBIscout » (onglet), « SCOUT » dans la barre (logo Brouwers + texte, cliquable → accueil).

## 2. Architecture & stack

```
[Next.js 14 App Router (src/)] --POST webhook--> [n8n : scraping atHome]
        ^                                              |
        |  POST /api/ingest (secret)                   v
        +------------------ [n8n renvoie les biens bruts]
        |
   [PostgreSQL Railway]  (scoring + persistance côté app, JAMAIS côté n8n)
        |
   [API Anthropic — Claude Haiku]  (classification d'état des comps, à l'ingest survey)
```

- **Next.js 14.2**, App Router, tout sous `src/`. Pas de lib UI : CSS maison (`globals.css`), police Inter, palette blanc / `#111111` / vert `#0cbd8e`. Tokens CSS : `--ink #111`, `--ink-soft #6b7270`, `--line #e6e8e7`, `--paper-2 #f4f6f5`, `--green #0cbd8e`, `--green-ink #07875f`, `--green-soft #e3f7f0`.
- **PostgreSQL** Railway (service séparé), schéma auto-créé/migré par `ensureSchema()` dans `src/lib/db.ts` (migrations idempotentes, `ADD COLUMN IF NOT EXISTS`).
- **n8n** sur Railway (`https://n8n-production-8929d.up.railway.app`), Postgres embarqué dans le même service, volume `n8n-volume` monté sur `/home/node/.n8n` — agrandi à 5 GB le 11/06.
- Le scoring vit **dans l'app** (`src/lib/scoring.ts`). n8n ne fait que scraper. Une seule source de vérité.
- **LLM** : classification de l'état des comps (rénové/habitable/à rénover) via `claude-haiku-4-5` (`src/lib/classify.ts`), à l'ingest des runs survey uniquement. Best-effort (un échec laisse `etat` NULL).

### Variables d'environnement (service Next.js Railway)
- `DATABASE_URL` — référence le plugin Postgres
- `N8N_WEBHOOK_URL` — `https://n8n-production-8929d.up.railway.app/webhook/scout-search` (⚠️ lié au PATH du webhook, pas à l'ID du workflow — ne jamais changer le path sans mettre à jour cette variable)
- `INGEST_SECRET` — partagé app ↔ n8n, vérifié par `/api/ingest`
- `CRON_SECRET` — header `x-cron-secret` exigé par `/api/cron/run-all` et `/api/cron/market-survey`
- `ANTHROPIC_API_KEY` — classification LLM des comps (Haiku). Absente => classification désactivée proprement.
- `PGSSL` — vide (connexion interne Railway)
- `PUBLIC_APP_URL` — origine publique (fallback pour l'`ingestUrl` envoyé à n8n)
- `APP_PASSWORD` / `SESSION_SECRET` — **obsolètes** (auth supprimée), peuvent être retirées

## 3. Workflows n8n (état au 14/06/2026)

| Workflow | ID | État | Rôle |
|---|---|---|---|
| **BBIscout — atHome scraper (photos)** | `zoFcSerIzOatlKTM` | **ACTIF** ✅ | Le scraper en production. Webhook path `scout-search`. |
| BBInvest — Veille quotidienne | `K8JFePsRgBcj62ZW` | ACTIF | Schedule 7h → POST `/api/cron/run-all` (header secret). |
| BBIscout — Survey hebdo | `TS9BvPEZfBVI8pKI` | ACTIF | Schedule lundi 06:00 → POST `/api/cron/market-survey` (relevé de marché S12). |
| BBInvest — atHome scraper | `iwHOAiQKAUeleOoo` | désactivé | Ancien scraper, backup, à supprimer. |
| DEBUG 1 à 4 | divers | jetables | Diagnostics du 11/06 — à supprimer dans l'UI n8n. |

### Scraper (`zoFcSerIzOatlKTM`) — 5 nodes
`Webhook depuis app` → `Scrape SRP (toutes pages)` (Code, pagination MAX_PAGES=50, délai 700 ms, extraction `__INITIAL_STATE__`, filtres vendu/neuf, **collectPhotos**, collectGeo, collectDescription) → `GET fiche detail` (1 req/2,5 s) → `Extrait CPE + filtre` → `Agrege resultats` → `POST vers app` (`/api/ingest`).
- **S13 `includeNoCpe`** : si `criteria.includeNoCpe` est vrai, `pickEnergy()` retourne null → **pas de `energy_class` dans l'URL SRP**, donc atHome renvoie aussi les biens sans note de CPE. Le nœud `Extrait CPE + filtre` garde déjà `CPE ∈ classes OU CPE vide`, donc rien d'autre à changer. Tradeoff : scrape toutes les notes puis filtre (plus lent).

### Photos — le pattern atHome (vérifié le 11/06)
- `a.media` dans `state.search.list[]` est une **STRING JSON** : `{"items":[{"type":"photo","uri":"/44/a8/98/xxx.jpg","order":n}]}` — il faut `JSON.parse`.
- URIs **relatives**. URL complète = `https://i1.static.athome.eu/images/annonces2/image_` + uri (segment littéral `image_`). Max 6 photos/bien, triées par `order`, filtrées `type === 'photo'`.

### Géo — le pattern atHome (S10)
- `a.geo` : `lat`, `lon` (→ lng), `streetAddress`, `cityName` (→ commune). Pas toujours de rue.

### Pratiques MCP n8n (IMPORTANT)
- ✅ **`update_workflow` fonctionne** (vérifié 13/06) avec un tableau `operations`. Pour patcher un nœud Code : `setNodeParameter(nodeName, path:"/jsCode", value: <code complet>)`. ⚠️ **Ça modifie le DRAFT** : il faut ensuite **`publish_workflow(workflowId)`** pour basculer la version active (sinon le webhook continue d'exécuter l'ancien code publié). Vérifier `activeVersionId` avant/après. *(L'ancien contournement `create_workflow_from_code` + unpublish/publish reste valable si `update_workflow` recasse.)*
- `executionMode: "manual"` exécute le **draft** ; `"production"` la version **publiée**. Tester en manual avant de basculer.
- Diagnostic : `get_execution(includeData: true, nodeNames: [...], truncateData: 1-2)`.
- Pour inspecter un shape inconnu (ex. JSON atHome) : créer un **workflow jetable** manualTrigger + Code plutôt que toucher au scraper.
- Le sandbox Code n8n n'a pas `URLSearchParams` ; query strings à la main ; regex avec double échappement ; `neverError: true` masque les erreurs HTTP.
- Les exécutions se **sérialisent en file** : un gros scrape bloque les suivants.
- `n8n-workflow.json` dans le repo est **OBSOLÈTE**. Toujours `get_workflow_details` sur le live.

## 4. Schéma de base de données

Tout est créé/migré par `ensureSchema()` (`src/lib/db.ts`) au premier appel. Tables :

- **configs** — recherches sauvegardées : `id, name, criteria JSONB, scoring JSONB, watch_enabled BOOL, created_at, updated_at`.
- **runs** — historique des recherches : `id, config_id (FK SET NULL), config_name, status (running|done|error), count, results JSONB` (biens scorés complets, photos incluses), `stats JSONB, scoring JSONB` (capture des hypothèses au lancement), `is_watch BOOL, is_survey BOOL, error, started_at, finished_at`.
- **zones** — hiérarchie Luxembourg-Ville + 26 quartiers : `id, parent_id, label, loc_code (L9-/L10-), q_code` (token atHome OBLIGATOIRE pour que `loc=` soit respecté), `resale_eur_per_m2` (prix calibré ; ville = prix par défaut), `announced_eur_per_m2` (réf. Observatoire affichée par quartier, S12), `sort_order`. Seed automatique.
- **listings** — référentiel des biens (PK = id atHome) : prix, prev_price, surface, commune, rooms, title, url, cpe, `photos JSONB` (max 6 URLs), first_seen, last_seen, `tracked BOOL, tracked_at`, `follow_status` (`to_contact|contacted|visit|offer|won|lost`), `search_scoring JSONB` (hypothèses figées au moment du suivi), `analysis_scoring JSONB` (essai de rentabilité S9), `lat, lng, address` (S10). L'upsert d'ingest ne touche JAMAIS tracked/tracked_at/first_seen, n'écrase jamais des photos existantes par un tableau vide, ni des coordonnées connues par null.
- **listing_snapshots** — historique de prix : une ligne quand bien nouveau OU prix changé (`listing_id, price, seen_at`). Alimente sparkline + liste datée.
- **findings** — flux d'ÉVÉNEMENTS de veille (id SERIAL) : `kind ('new'|'price_drop')`, verdict, margin_pct, price, prev_price, config_name, run_id (FK SET NULL), found_at. Capturés à l'ingest **uniquement sur les runs is_watch**, pour les biens GO/NÉGOCIER.
- **listing_notes** — suivi collaboratif S7, append-only : `id, listing_id, author, kind ('note'|'status'), body, created_at`. `kind='status'` journalise les changements de statut.
- **playlists** (S11) — listes de biens : `id, name, rules JSONB, created_at, updated_at`. `rules` = filtres (playlist « intelligente ») ou vide (playlist manuelle).
- **playlist_items** (S11) — `playlist_id (FK CASCADE), listing_id (FK CASCADE), kind`, PK (playlist_id, listing_id).
- **market_samples** (S12) — comps terrain issus des runs survey : `id, listing_id, quartier_slug, price, surface, price_m2, cpe, description, etat ('renove'|'habitable'|'a_renover'), etat_confidence, url, observed_at`. Fenêtre 12 sem. glissante. Classés par LLM.
- **observatoire_data** (S12) — données Observatoire de l'Habitat (actes notariés ville) : `id, dataset, period, value_eur_m2, resource_modified, fetched_at`, UNIQUE(dataset, period). Alimente la décote affiché→signé.
- **price_proposals** (S12) — propositions de prix de revente par quartier (ET ville) à valider : `id, quartier_slug, proposed_eur_m2, current_eur_m2, calc JSONB` (détail complet : comps, percentiles, décote, confiance, formule), `status ('pending'|'accepted'|'dismissed'), created_at, decided_at`.

## 5. Modèle de scoring

Paramètres par config (`scoring`) : travaux €/m² HT, TVA travaux (non récupérable, 17 %), frais acquisition (8 %), frais revente (3 %), marge brute cible (15 %). Prix de revente €/m² : **par quartier** (page « Prix de revente »), résolu via `quartierSlug(commune)` → `zones`, défaut = prix de la ville.

Formules (`src/lib/scoring.ts`, marge BRUTE, pas d'IS) :
- `resaleValue = surface × resalePerM2` ; `worksCost = surface × works × (1+TVA)` ; `acquisitionCost = price × notaryPct` ; `resaleCost = resaleValue × agencyPct`
- `totalInvested = price + acquisitionCost + worksCost` ; `netProfit = (resaleValue − resaleCost) − totalInvested` ; `marginPct = netProfit / totalInvested`
- `maxBuyPrice = ((resaleNet/(1+cible)) − worksCost) / (1+notaryPct)`

**Verdicts** : stockés `GO | NEGOCIER | PASS` en base (runs.results, findings) — **ne jamais migrer ces valeurs**. Affichés **OK / Négocier / KO** via mapping UI. Seuils : OK = marge ≥ cible ; Négocier = ≥ moitié de la cible ; KO = en dessous.

### Calculateur de prix de revente par quartier (S12) — `src/lib/proposals.ts`
- **Comps** : `market_samples` 12 sem., 30–70 m², CPE C–F (ou vide), dédupliqués par `listing_id`.
- **Prix affiché cible** (du plus fiable au plus large) : médiane des rénovés (≥ 8 rénovés) → P75 quartier (≥ 12 comps) → **réf. Observatoire** du quartier (`announced_eur_per_m2`) → cluster de quartiers voisins (`CLUSTERS`) → P75 ville (dernier recours).
- **Décote affiché → signé** (`src/lib/observatoire.ts`) : médiane des affichés / valeur signée Observatoire, bornée **[4 %, 12 %]**, fallback prudent **6,5 %** signalé tant qu'on n'a pas la donnée notariale.
- **Proposition** = cible × (1 − décote), arrondie aux 50 € inférieurs. Créée `pending` si |proposé − actuel| ≥ 2 %. La **ville** (parent) reçoit aussi une proposition (réf Observatoire ville × décote) → un prix « ville » unique à valider.
- **Note de confiance 0–100** = `base(niveau) × taille(n) × dispersion × décote`. base : médiane rénové 95 · P75 quartier 80 · réf Observatoire/cluster 60 · ville 40. taille pénalise si peu de comps ; dispersion pénalise un étalement large ; décote ×1 si mesurée, ×0,85 si fallback. **Jamais 100.** Badges : ≥80 Élevée · 60–79 Bonne · 45–59 Modérée · <45 Faible.
- **Classement IA** (`src/lib/classify.ts`) : titre+description envoyés à Claude Haiku → `etat` (rénové R / habitable H / à rénover A) + `etat_confidence`. À l'ingest des runs survey, séquentiel ~5 req/s, best-effort.

## 6. Fonctionnalités livrées (S1 → S13)

1. **Recherche & configs** : formulaire complet (type, ZonePicker « Tout Lux-Ville » L9 ou multi-quartiers L10, surfaces, prix, CPE avec toggle « toutes » + **S13 « inclure les biens sans note de CPE »**, toggle neuf), sauvegarde, relance, suppression. Bouton « Voir ».
2. **Scraping paginé** complet (jusqu'à 50 pages), stats de run affichées.
3. **Résultats** : tableau scoré trié par marge ; dépliant détail du calcul + photos. **S13 — réconciliation des exclusions** : dépliant « Pourquoi N biens exclus ? » ventilant chaque bien manquant (vendus / neufs / hors critères CPE-type-doublons / données incomplètes) ; `runs.stats` enrichi à l'ingest de `countReceived` + `countIncomplete`.
4. **Suivis (★)** : re-scoring à la volée. **S9** : `baseline = search_scoring ?? défaut` ; **le prix de revente est toujours lu en direct sur la zone** (source de vérité unique), même pour les biens déjà suivis ; les autres hypothèses restent figées. Panneau d'analyse (`AnalysisPanel`, `analysis_scoring`) pour tester une rentabilité. Delta prix, sparkline, historique daté, photos, badge inactif.
5. **Veille auto** : toggle « Veille » par config → `/api/cron/run-all` (7h via n8n Schedule). Runs `is_watch`.
6. **Nouveautés (✨)** : flux paginé des findings.
7. **Suivi collaboratif (S7)** : identité légère (`scout_me` = Vincent|Jamie), statut de pipeline journalisé, fil de remarques signées, colonne Activité, badge d'activité non vue.
8. **Photos (S8)** : extraites par le scraper, persistées, **lightbox plein écran** (`PhotoStrip`, partagé Résultats + Suivis).
9. **Carte (S10)** : `lat/lng/address` scrapés ; page `/carte` + `PropertyMap` ; statut de localisation (exact/athome/quartier via centroïdes `QUARTIER_CENTROIDS`). `/api/imgproxy` pour les images.
10. **Filtres & playlists Suivis (S11)** : `TrackedFilters` + `trackedFilter.ts` (filtrage complet) ; playlists manuelles ou par règles (`PlaylistEditor`, `playlist.ts`) ; export **PDF** (photos + chiffres + carte + lien Maps) et **Excel** (`exportTracked.ts`, `ExportIcons`).
11. **Prix de revente par quartier (S12/S13)** : page `/settings` — saisie manuelle prioritaire + propositions calculées (quartiers ET ville) avec badge de confiance, Appliquer/Ignorer, **« ✓ Appliqué » conserve le détail consultable**, dépliant méthode/équation/distribution/comparables, tuto intégré clair (définitions cluster, réf Observatoire vs P75 ville, R/H/A), rappel ⏰ trimestriel des données Observatoire (`OBSERVATOIRE_REF_DATE`). Régénération des propositions **à la fin de l'ingest du relevé** (comps frais), pas dans le cron.
12. **UI/branding** : topbar grid 3 colonnes (logo Brouwers, « SCOUT » cliquable), `NavMenu` (menu déroulant mobile), prix au format `250.000 €` (regex manuelle), types en français, onglet « BBIscout ».

## 7. Arborescence du repo (rôle de chaque fichier)

```
src/
  lib/
    db.ts            — pool pg + ensureSchema (TOUTES les migrations) + reapStaleRuns
    scoring.ts       — types Listing/Scored + scoreListing + DEFAULT_SCORING
    trigger.ts       — triggerRun + triggerSurveyRun (fire-and-forget webhook) + resolveBase
    types.ts         — Criteria (dont includeNoCpe), ConfigRow, Zone, ZoneTree, RunStats
    zones.ts         — getZoneTree, quartierSlug (+ SLUG_ALIASES), getZonePriceMap, resolveResalePerM2, resolveCentroid, QUARTIER_CENTROIDS, setZonePrices
    proposals.ts     — S12 : computeQuartier, computeConfidence, CLUSTERS, generateProposals
    observatoire.ts  — S12 : fetchActesVille (data.public.lu), getDecote, FALLBACK_DECOTE
    classify.ts      — S12 : classifyEtat (Claude Haiku), hasAnthropicKey
    address.ts       — realAddress (rue fiable ou non)
    playlist.ts      — S11 : logique playlists
    trackedFilter.ts — S11 : filtrage des suivis
    exportTracked.ts — S11 : export PDF / Excel
  components/
    NavMenu, PhotoStrip, AnalysisPanel, TrackedFilters, PlaylistEditor,
    PropertyMap, ExportIcons
  app/
    layout.tsx, globals.css (TOUT le style)
    page.tsx              — DASHBOARD (configs + Voir + veille + badges + runs repliables)
    runs/[id]/page.tsx    — résultats d'un run (polling, légende, photos, exclusions)
    tracked/page.tsx      — Suivis (S7 + S9 + S10 + S11)
    nouveautes/page.tsx   — flux des findings
    carte/page.tsx        — carte des biens (S10)
    search/new/page.tsx   — formulaire (+ ZonePicker.tsx)
    settings/page.tsx     — prix de revente par quartier (S12/S13)
    api/
      ingest/route.ts            — réception n8n : upsert, snapshots, scoring, findings, market_samples + regen propositions (survey)
      trigger/route.ts           — lancement manuel
      cron/run-all/route.ts      — veille (+ reapStaleRuns)
      cron/market-survey/route.ts— relevé hebdo (survey + fetchActesVille)
      configs/*, configs/[id], configs/watch
      runs/route.ts              — GET liste / GET ?id / DELETE ?id (+ reapStaleRuns)
      listings/route.ts          — GET tracked enrichi (re-score, history, notes, photos, geo, matchedConfigIds)
      listings/track, status, notes, analysis
      playlists/route.ts, playlists/items/route.ts
      proposals/route.ts (GET/POST accept|dismiss), proposals/recalc/route.ts
      findings/route.ts
      zones/route.ts, zone-prices/route.ts, imgproxy/route.ts
public/brouwers-logo.svg
```

⚠️ **5 fichiers `page.tsx` homonymes** — toujours vérifier le chemin complet avant d'éditer.

## 8. Pièges connus (NE PAS REFAIRE)

1. **Tout middleware Next.js va dans `src/`**, jamais à la racine.
2. **`export const dynamic = "force-dynamic"`** obligatoire sur toute route GET qui touche la DB (sinon prerender au build → DNS fail Railway).
3. **Try-catch + réponse JSON d'erreur** dans toutes les routes API (sinon « Chargement… » infini côté client).
4. **Chemins de fichiers jamais supposés** (`listing` vs `listings`, homonymies `page.tsx`).
5. **Disque n8n** : l'historique d'exécutions sature le volume. Si saturation : agrandir le volume **puis « Redeploy »** (pas « Restart »). Prévention : `EXECUTIONS_DATA_PRUNE=true` + `EXECUTIONS_DATA_MAX_AGE=168`.
6. **Photos atHome** : `media` = string JSON, URIs relatives, préfixe CDN `image_`.
7. **Railway** : build raté = nouveau commit requis. **Toujours `npm run build` en local avant de push.**
8. Le snapshot `runs.results` reçoit tout champ runtime du Listing (spread) — surveiller la taille.
9. **n8n : publier après édition** — `update_workflow`/`setNodeParameter` modifie le DRAFT ; sans `publish_workflow`, le webhook tourne sur l'ancienne version.
10. **Mapping commune → zone** : atHome peut renvoyer un libellé qui ne matche pas l'id de zone (ex. « Cloche d'Or » ≠ `gasperich`). Aliases dans `SLUG_ALIASES` (`zones.ts`).
11. **Régénération des propositions** : APRÈS l'ingest du relevé (comps frais), pas dans le cron (le scrape est asynchrone, fire-and-forget).

## 9. Infra / ops — points de vigilance

- **n8n volume** : 5 GB depuis le 11/06. Vérifier `EXECUTIONS_DATA_PRUNE=true` + `EXECUTIONS_DATA_MAX_AGE=168`.
- **Postgres app** : croissance dominée par `runs.results` (~1 Mo/jour) et `market_samples`. Purge des runs > 60 jours au backlog.
- **Webhook** : path `scout-search` = contrat app ↔ n8n. Le changer = mettre à jour `N8N_WEBHOOK_URL`.
- **Données Observatoire par quartier** (`zones.announced_eur_per_m2`) : maj **manuelle** (Vincent envoie le fichier, Claude réimporte). À chaque réimport, **bumper `OBSERVATOIRE_REF_DATE`** dans `src/app/settings/page.tsx` → rappel ⏰ au-delà de 3 mois. La décote (`observatoire.ts`) est, elle, auto-fetchée depuis data.public.lu.
- **Garde-fou runs** : `reapStaleRuns()` (`db.ts`) bascule en `error` tout run « running » > 45 min (n8n fire-and-forget sans timeout). Appelé sur `GET /api/runs` et le cron veille.
- Ancien scraper `iwHOAiQKAUeleOoo` + 4 workflows DEBUG : à supprimer dans l'UI n8n.

## 10. Conventions de travail avec Vincent (STRICTES)

- **Vincent ne tape aucune commande.** Claude exécute lui-même build, git, npm, n8n, etc.
- **`npm run build` doit passer avant tout commit.** Jamais de push avec un build cassé.
- **Un commit par batch de features** — pas d'états partiels. Messages clairs, en français.
- **Workflow de livraison** : développer sur la branche dédiée, build, commit, **PR → main, squash-merge** (Railway déploie). Vincent a demandé de **merger sans demander** pour les batchs de features en cours ; le **prévenir quand tout est fini**. Rebase sur `origin/main` avant chaque PR (les squash-merge précédents font diverger la branche → `git rebase origin/main` puis `push --force-with-lease`).
- **Propal validée avant de coder les gros morceaux** ; décisions tranchées et justifiées brièvement ; ne poser que les questions bloquantes.
- **Honnêteté directe sur les erreurs** — reconnaître explicitement (ex. théorie « collision de file n8n » écartée par les horaires).
- Communication en **français concis**, sans hedging ni jargon.
- **Vérifier l'état réel** (code du repo, exécutions/workflows n8n live) plutôt que supposer.
- **Identité modèle** : ne jamais écrire l'identifiant de modèle dans un commit/PR/code.
- Quand une leçon durable émerge, **la consigner ici** (avec accord de Vincent).

## 11. Backlog priorisé

**🔭 PROCHAINE SESSION (validée) — Immotop.lu comme 2ᵉ source (cf. §13).**
Démarrage par une **étude complète + tests** (mesure du recouvrement, validation de l'empreinte anti-doublons) **AVANT de coder**.

**À RÉGLER — runs n8n bloqués en « running » :**
- Garde-fou timeout **livré** (`reapStaleRuns`, §9). Reste : **inspecter l'exécution n8n coincée** (cause racine) + éventuellement décaler le relevé plus tôt la nuit. (Le cas du 13/06 12h n'était PAS une collision de file : le relevé était `done` 14 h avant.)

**Mis de côté / à reprendre sur demande (« next steps ? ») :**
- **Motif d'exclusion par bien (étage n8n)** : aujourd'hui agrégat. Le motif bien par bien (CPE/type) impose que le scraper **émette les biens écartés avec leur raison** (modif workflow n8n). Côté app, prévoir un champ pour les recevoir.

**Ops à confirmer :**
- Variables de purge n8n posées (§9).
- Suppression de l'ancien scraper + 4 workflows DEBUG dans l'UI n8n.

**Plus tard :**
- Purge auto des runs > 60 jours (ensureSchema ou cron).
- Nettoyage variables Railway obsolètes (`APP_PASSWORD`, `SESSION_SECRET`).
- LLM enrichment des descriptions d'annonces (Haiku) — non cadré.
- Élargissement hors Luxembourg-Ville (INSERT dans `zones` avec loc_code + q_code).

## 12. Comment tester

- **Build local** : `npm run build` — obligatoire avant chaque commit.
- **Run réel** : dashboard → « Relancer » → la page de résultats se rafraîchit seule.
- **Veille** : 7h auto ; workflow `K8JFePsRgBcj62ZW` exécutable à la main.
- **Survey / propositions** : workflow `TS9BvPEZfBVI8pKI` (lundi 6h) ou bouton « ↻ Recalculer » dans `/settings` (recalcule sur le dernier scrape, **ne scrape pas**).
- **Scraper isolé** (sans polluer la base) : exécuter `zoFcSerIzOatlKTM` via MCP avec `runId` bidon (999xxx), `ingestSecret` bidon, `ingestUrl: https://example.com/noop` — le POST final échoue exprès (405 attendu), et `get_execution` sur « Scrape SRP » montre les biens + photos.

## 13. Immotop.lu (2ᵉ source) — stratégie & plan de la prochaine session

**Objectif** : ajouter immotop.lu comme 2ᵉ scraper, SANS compter deux fois le même bien physique (listé sur les deux sites, ou par plusieurs agences).

**Règle de doublon (Vincent)** : **surface + prix identiques + localisation = doublon.**

**Stratégie proposée (à affiner par l'étude)** :
- **Empreinte canonique** par bien, indépendante de la source : `quartier_slug` (ou commune normalisée) + `round(surface)` + `price` (+ éventuellement `rooms`). Tolérance à étudier : surface ±1 m², prix exact ou ±1–2 % (une même annonce peut être relistée à un prix légèrement différent, ou après une baisse).
- **Champ `source`** sur `listings` (`athome` | `immotop`) + conservation des deux URLs/ids quand un doublon est détecté. Choisir l'enregistrement **le plus riche** (photos, description, CPE, géo).
- **Dédup à l'ingest** : à la réception d'un bien (quelle que soit la source), calculer l'empreinte ; si un bien actif correspond, fusionner au lieu de créer un doublon. Index/colonne d'empreinte pour la recherche rapide.
- **Architecture** : 2ᵉ workflow n8n (immotop) → même `/api/ingest` avec un tag `source`, OU chemin d'ingest dédié. Dédup centralisée côté app.

**Cas limites à tester** : même bien à prix différent (baisse sur un site), surfaces arrondies différemment entre sites, plusieurs agences pour un même bien, biens sans prix/surface (déjà filtrés). 

**Méthode imposée** : la session démarre par une **étude du shape immotop + des tests de recouvrement réels** (échantillon des deux sources, mesure précision/rappel de l'empreinte) **avant d'écrire la moindre ligne de prod.**
