# CLAUDE.md — BBIscout

Contexte persistant du projet. Lu automatiquement au début de chaque session Claude Code.
Dernière mise à jour : 12/06/2026.

---

## 1. Le projet en une minute

**BBIscout** (ex-Scout, ex-BBInvest) est l'outil interne de Vincent (Korr, Luxembourg) pour son client **BBI / Brouwers Bureau Immobilier** : scraping d'atHome.lu + scoring automatique de biens en stratégie **achat – rénovation – revente** à Luxembourg-Ville. Utilisé à deux : **Vincent** et **Jamie**, chacun à distance.

- App : `https://scout-production-8d09.up.railway.app/` — **ouverte volontairement, sans mot de passe** (décision actée, toute l'auth a été supprimée du repo).
- Déploiement : **Railway**, automatique à chaque push sur la branche principale.
- Nom affiché : « BBIscout » (onglet), « SCOUT » dans la barre (logo Brouwers + texte, cliquable → accueil).

## 2. Architecture & stack

```
[Next.js 14 App Router (src/)] --POST webhook--> [n8n : scraping atHome]
        ^                                              |
        |  POST /api/ingest (secret)                   v
        +------------------ [n8n renvoie les biens bruts]
        |
   [PostgreSQL Railway]  (scoring + persistance côté app, JAMAIS côté n8n)
```

- **Next.js 14.2**, App Router, tout sous `src/`. Pas de lib UI : CSS maison (`globals.css`), police Inter, palette blanc / `#111111` / vert `#0cbd8e`.
- **PostgreSQL** Railway (service séparé), schéma auto-créé/migré par `ensureSchema()` dans `src/lib/db.ts` (migrations idempotentes, `ADD COLUMN IF NOT EXISTS`).
- **n8n** sur Railway (`https://n8n-production-8929d.up.railway.app`), Postgres embarqué dans le même service, volume `n8n-volume` monté sur `/home/node/.n8n` — agrandi à 5 GB le 11/06 après saturation (voir §9).
- Le scoring vit **dans l'app** (`src/lib/scoring.ts`). n8n ne fait que scraper. Une seule source de vérité.

### Variables d'environnement (service Next.js Railway)
- `DATABASE_URL` — référence le plugin Postgres
- `N8N_WEBHOOK_URL` — `https://n8n-production-8929d.up.railway.app/webhook/scout-search` (⚠️ lié au PATH du webhook, pas à l'ID du workflow — ne jamais changer le path sans mettre à jour cette variable)
- `INGEST_SECRET` — partagé app ↔ n8n, vérifié par `/api/ingest`
- `CRON_SECRET` — header `x-cron-secret` exigé par `/api/cron/run-all` (valeur dans Railway)
- `PGSSL` — vide (connexion interne Railway)
- `APP_PASSWORD` / `SESSION_SECRET` — **obsolètes** (auth supprimée), peuvent être retirées

## 3. Workflows n8n (état au 11/06/2026)

| Workflow | ID | État | Rôle |
|---|---|---|---|
| **BBIscout — atHome scraper (photos)** | `zoFcSerIzOatlKTM` | **ACTIF** ✅ | Le scraper en production. Webhook path `scout-search`. |
| BBInvest — atHome scraper | `iwHOAiQKAUeleOoo` | désactivé | Ancien scraper, backup temporaire, à supprimer. |
| BBInvest — Veille quotidienne | `K8JFePsRgBcj62ZW` | ACTIF | Schedule 7h → POST `/api/cron/run-all` avec le header secret. |
| DEBUG 1 à 4 (shape atHome, CDN…) | divers | jetables | Diagnostics du 11/06 — à supprimer dans l'UI n8n. |

### Scraper (`zoFcSerIzOatlKTM`) — 5 nodes
`Webhook depuis app` → `Scrape SRP (toutes pages)` (Code, pagination MAX_PAGES=50, délai 700 ms, extraction `__INITIAL_STATE__`, filtres vendu/neuf, **collectPhotos**) → `GET fiche detail` (1 req/2,5 s) → `Extrait CPE + filtre` → `Agrege resultats` → `POST vers app` (`/api/ingest`).

### Photos — le pattern atHome (vérifié le 11/06)
- `a.media` dans `state.search.list[]` est une **STRING JSON** : `{"items":[{"type":"photo","uri":"/44/a8/98/xxx.jpg","order":n}]}` — il faut `JSON.parse`.
- URIs **relatives**. URL complète = `https://i1.static.athome.eu/images/annonces2/image_` + uri (segment littéral `image_`, vérifié sur la fiche détail). Max 6 photos/bien, triées par `order`, filtrées `type === 'photo'`.

### Pratiques MCP n8n (IMPORTANT, a changé le 11/06)
- ⚠️ **`update_workflow` est cassé** depuis la montée de version n8n : il exige un paramètre `operations` (array) au lieu du code SDK. **Contournement éprouvé** : `validate_workflow` → `create_workflow_from_code` (nouveau workflow, même webhook path) → `unpublish_workflow` (ancien) → `publish_workflow` (nouveau). Le path porte l'URL, donc `N8N_WEBHOOK_URL` reste valable. *(Le schéma MCP peut re-changer — retester `update_workflow` avant de conclure.)*
- `executionMode: "manual"` exécute le **draft** ; `"production"` la version **publiée**. Tester en manual avant de basculer.
- Diagnostic : `get_execution(includeData: true, nodeNames: [...], truncateData: 1-2)`.
- Pour inspecter un shape inconnu (ex. JSON atHome) : créer un **workflow jetable** manualTrigger + Code plutôt que toucher au scraper.
- Le sandbox Code n8n n'a pas `URLSearchParams` ; query strings à la main ; regex avec double échappement ; `neverError: true` masque les erreurs HTTP.
- Les exécutions se sérialisent en file : un gros scrape bloque les suivantes.
- `n8n-workflow.json` dans le repo est **OBSOLÈTE** (pré-pagination, pré-photos). Toujours `get_workflow_details` sur le live.

## 4. Schéma de base de données

Tout est créé/migré par `ensureSchema()` (`src/lib/db.ts`) au premier appel. Tables :

- **configs** — recherches sauvegardées : `id, name, criteria JSONB, scoring JSONB, watch_enabled BOOL, created_at, updated_at`.
- **runs** — historique des recherches : `id, config_id (FK SET NULL), config_name, status (running|done|error), count, results JSONB` (biens scorés complets, photos incluses), `stats JSONB, is_watch BOOL, error, started_at, finished_at`.
- **zones** — hiérarchie Luxembourg-Ville + 26 quartiers : `id, parent_id, label, loc_code (L9-/L10-), q_code` (token atHome OBLIGATOIRE pour que `loc=` soit respecté), `resale_eur_per_m2` (prix calibré ; ville = prix par défaut). Seed automatique.
- **listings** — référentiel des biens (PK = id atHome) : prix, prev_price, surface, commune, rooms, title, url, cpe, `photos JSONB` (max 6 URLs), first_seen, last_seen, `tracked BOOL, tracked_at`, `follow_status` (`to_contact|contacted|visit|offer|won|lost`). L'upsert d'ingest ne touche JAMAIS tracked/tracked_at/first_seen, et n'écrase jamais des photos existantes par un tableau vide.
- **listing_snapshots** — historique de prix : une ligne quand bien nouveau OU prix changé. Alimente sparkline + liste datée dans Suivis.
- **findings** — flux d'ÉVÉNEMENTS de veille (id SERIAL, un par occurrence) : `kind ('new'|'price_drop')`, verdict, margin_pct, price, prev_price, config_name, run_id (FK SET NULL), found_at. Capturés à l'ingest **uniquement sur les runs is_watch**, pour les biens GO/NÉGOCIER. Toute baisse de prix compte (pas seulement bascule de verdict).
- **listing_notes** — suivi collaboratif S7, append-only : `listing_id, author, kind ('note'|'status'), body, created_at`. `kind='status'` journalise les changements de statut (body = clé interne du statut).

## 5. Modèle de scoring

Paramètres par config (`scoring`) : travaux €/m² HT, TVA travaux (non récupérable, 17 %), frais acquisition (8 %), frais revente (3 %), marge brute cible (15 %). Prix de revente €/m² : **par quartier** (page « Prix de revente »), résolu via `quartierSlug(commune)` → `zones`, défaut = prix de la ville.

Formules (`src/lib/scoring.ts`, marge BRUTE, pas d'IS) :
- `resaleValue = surface × resalePerM2` ; `worksCost = surface × works × (1+TVA)` ; `acquisitionCost = price × notaryPct` ; `resaleCost = resaleValue × agencyPct`
- `totalInvested = price + acquisitionCost + worksCost` ; `netProfit = (resaleValue − resaleCost) − totalInvested` ; `marginPct = netProfit / totalInvested`
- `maxBuyPrice = ((resaleNet/(1+cible)) − worksCost) / (1+notaryPct)`

**Verdicts** : stockés `GO | NEGOCIER | PASS` en base (runs.results, findings) — **ne jamais migrer ces valeurs**. Affichés **OK / Négocier / KO** via mapping UI. Seuils : OK = marge ≥ cible ; Négocier = ≥ moitié de la cible ; KO = en dessous. Légende visible au-dessus des résultats.

## 6. Fonctionnalités livrées (S1 → S8)

1. **Recherche & configs** : formulaire complet (type, ZonePicker « Tout Lux-Ville » L9 ou multi-quartiers L10, surfaces, prix, CPE avec toggle « toutes », toggle neuf), sauvegarde, relance, suppression. Bouton « Voir » dépliant toutes les hypothèses d'une config.
2. **Scraping paginé** complet (jusqu'à 50 pages), stats de run affichées (total atHome, pages, exclus vendus/neufs, alerte cap).
3. **Résultats** : tableau scoré trié par marge, colonnes Prix (delta ↓/↑), m², CPE, Prix de revente, Marge, Verdict ; dépliant `.expand-btn` 30×30 avec détail du calcul complet (dont prix d'achat max) + bande de photos 150×112 fixes (`object-fit: cover`, scroll horizontal, clic = ouvre, onError = masque).
4. **Suivis (★)** : re-scoring à la volée (DEFAULT_SCORING + prix zone, **sans verdict** — décision Vincent), delta prix, sparkline + historique de prix daté, photos, badge « inactif ? » si >30 j.
5. **Veille auto** : toggle « Veille » par config → `/api/cron/run-all` (protégé `x-cron-secret`) déclenché chaque matin 7h par le workflow n8n Schedule. Runs marqués `is_watch`.
6. **Nouveautés (✨)** : flux paginé (30/page) des événements de veille — « ✨ Nouveau » et « ↓ baisse (montant) » — avec bouton « ☆ Suivre ».
7. **Suivi collaboratif (S7)** : identité légère localStorage (`scout_me` = Vincent|Jamie, sélecteur 👤, bandeau de choix au 1er passage) ; statut de pipeline (select dans la ligne) journalisé ; fil de remarques signées dans le dépliant ; colonne Activité (💬 n + aperçu dernière note) ; badge vert sur ★ Suivis au dashboard si activité d'autrui non vue (`scout_seen_{me}` localStorage vs `GET /api/listings/notes?latest=1`).
8. **Photos (S8)** : extraites par le scraper (cf. §3), persistées dans `listings.photos`, affichées dans les dépliants Résultats + Suivis.
9. **UI/branding** : topbar grid 3 colonnes (logo Brouwers SVG + « SCOUT » style h1, cliquable, hover vert sans soulignement / titre centré / nav droite), prix au format `250.000 €` (regex manuelle, pas Intl), « Dernières recherches » repliées par défaut avec compteur, types de biens en français, titre onglet « BBIscout ».

## 7. Arborescence du repo (rôle de chaque fichier)

```
src/
  lib/
    db.ts          — pool pg + ensureSchema (TOUTES les migrations)
    scoring.ts     — types Listing/Scored + scoreListing + DEFAULT_SCORING
    trigger.ts     — triggerRun (crée le run, enrichit qTokens, fire-and-forget webhook) + resolveBase
    types.ts       — Criteria, ConfigRow, Zone, ZoneTree, RunStats
    zones.ts       — getZoneTree, quartierSlug, getZonePriceMap, resolveResalePerM2, setZonePrices
  app/
    layout.tsx     — titre « BBIscout »
    globals.css    — TOUT le style (palette, topbar, .expand-btn, .photo-strip, toggles, verdicts…)
    page.tsx       — DASHBOARD (configs + Voir + veille + badge activité + runs repliables)
    runs/[id]/page.tsx   — résultats d'un run (polling, légende verdicts, photos)
    tracked/page.tsx     — Suivis (S7 complet + photos + historique prix)
    nouveautes/page.tsx  — flux des findings
    search/new/page.tsx  — formulaire nouvelle recherche (+ ZonePicker.tsx à côté)
    settings/page.tsx    — prix de revente par quartier
    api/
      ingest/route.ts          — réception n8n : upsert listings (+photos), snapshots, scoring, findings
      trigger/route.ts         — lancement manuel d'un run
      cron/run-all/route.ts    — veille (toutes les configs watch_enabled)
      configs/route.ts, configs/[id]/route.ts, configs/watch/route.ts
      runs/route.ts            — GET liste / GET ?id=
      listings/route.ts        — GET tracked enrichi (re-score, history, notes, photos)
      listings/track/route.ts  — ★ on/off
      listings/status/route.ts — statut pipeline (+ journalisation)
      listings/notes/route.ts  — GET fil / GET ?latest=1 / POST remarque
      zones/route.ts, zone-prices/route.ts
public/brouwers-logo.svg — injecté via .brand-home::before (130×54)
```

⚠️ **5 fichiers `page.tsx` homonymes** — toujours vérifier le chemin complet avant d'éditer.

## 8. Pièges connus (NE PAS REFAIRE)

1. **Tout middleware Next.js va dans `src/`**, jamais à la racine — silencieusement ignoré sinon quand le projet a un dossier `src/`.
2. **`export const dynamic = "force-dynamic"`** obligatoire sur toute route GET qui touche la DB, sinon prerender au build → DNS fail Railway.
3. **Try-catch + réponse JSON d'erreur** dans toutes les routes API, sinon « Chargement… » infini côté client.
4. **Chemins de fichiers jamais supposés** (`listing` vs `listings`, homonymies `page.tsx`) — lire le repo avant d'éditer.
5. **Disque n8n** : l'historique d'exécutions sature le volume (scrapes paginés = HTML entiers stockés). Si saturation : agrandir le volume **puis « Redeploy »** (un « Restart » ne remonte pas le volume redimensionné). Prévention : `EXECUTIONS_DATA_PRUNE=true` + `EXECUTIONS_DATA_MAX_AGE=168` sur le service n8n.
6. **Photos atHome** : ne jamais supposer le shape — `media` est une string JSON, URIs relatives, préfixe CDN à vérifier sur le site (méthode : workflow debug jetable, cf. §3).
7. **Railway** : build raté = nouveau commit requis (pas de bouton Redeploy sur un build échoué). D'où : **toujours `npm run build` en local avant de push**.
8. Le snapshot `runs.results` reçoit automatiquement tout champ runtime du Listing (spread `{...l}`) — pratique mais surveiller la taille.

## 9. Infra / ops — points de vigilance

- **n8n volume** : 5 GB depuis le 11/06. ⚠️ Vérifier que `EXECUTIONS_DATA_PRUNE=true` et `EXECUTIONS_DATA_MAX_AGE=168` sont posées sur le service n8n.
- **Postgres app** : croissance dominée par `runs.results` (~1 Mo/jour avec veille). Purge des runs > 60 jours au backlog.
- **Webhook** : path `scout-search` = contrat entre l'app et n8n. Le changer = mettre à jour `N8N_WEBHOOK_URL`.
- Ancien scraper `iwHOAiQKAUeleOoo` + 4 workflows DEBUG : à supprimer dans l'UI n8n.

## 10. Conventions de travail avec Vincent (STRICTES)

- **Vincent ne tape aucune commande.** Claude exécute lui-même build, git, npm, etc. Ne jamais demander à Vincent de lancer quelque chose dans un terminal.
- **`npm run build` doit passer avant tout commit.** Jamais de push avec un build cassé (Railway déploie automatiquement).
- **Un commit par batch de features** — pas d'états partiels. Messages de commit clairs, en français.
- **Propal validée avant de coder les gros morceaux** ; décisions tranchées et justifiées brièvement plutôt que listes d'options ; ne poser que les questions bloquantes.
- **Honnêteté directe sur les erreurs** — reconnaître explicitement, pas d'itérations en aveugle.
- Communication en **français concis**, sans hedging ni jargon.
- **Vérifier l'état réel** (code du repo, exécutions n8n, workflows live) plutôt que supposer.
- Quand une leçon durable émerge en session, **la consigner dans ce CLAUDE.md** (avec accord de Vincent).

## 11. Backlog priorisé

**Batch 1 — prochain (validé par Vincent) :**
1. **Lightbox photos** : clic sur vignette → overlay plein écran dans la page (fond sombre, flèches ‹ ›, fermeture clic/Échap), composant PhotoStrip partagé Résultats + Suivis. Plus de nouvel onglet.
2. **Suppression d'un run** : bouton ✕ par ligne dans « Dernières recherches » + `DELETE /api/runs?id=` (confirm avant). FK déjà propres (`findings.run_id SET NULL`).

**À RÉGLER (demandé par Vincent le 13/06) — runs n8n bloqués en « running » :**
0. Un run reste « running · 0 bien » indéfiniment quand n8n reçoit le webhook mais ne POSTe jamais le résultat à `/api/ingest` (exécution n8n plantée sur un nœud avant le POST, ou 0 résultat sans fin propre). L'app n'a **aucun timeout** (`trigger.ts` est fire-and-forget). Cas constaté : veille du 13/06 12h00 (≠ collision avec le relevé, qui était `done` 14h avant — théorie file d'attente écartée). À faire : (a) **garde-fou** = un run sans réponse > ~30 min passe auto en `error` (dans `ensureSchema`/cron) ; (b) éventuellement **décaler le relevé** plus tôt la nuit ; (c) inspecter l'exécution coincée dans l'UI n8n pour la cause exacte (outils MCP n8n = approbation manuelle requise, bloqués en session). Palliatif immédiat : bouton ✕ sur le run.

**Ops à confirmer :**
3. Variables de purge n8n posées (cf. §9).
4. Suppression de l'ancien scraper + 4 workflows DEBUG dans l'UI n8n.

**Plus tard :**
5. Purge auto des runs > 60 jours (dans ensureSchema ou le cron).
6. Nettoyage variables Railway obsolètes (`APP_PASSWORD`, `SESSION_SECRET`).
7. LLM enrichment des descriptions d'annonces (Haiku) — non cadré.
8. Élargissement hors Luxembourg-Ville (nouvelles zones : INSERT dans `zones` avec loc_code + q_code).
9. Immotop.lu comme 2ᵉ scraper — **écarté** par Vincent, ne pas relancer sauf demande.

## 12. Comment tester

- **Build local** : `npm run build` — obligatoire avant chaque commit.
- **Run réel** : dashboard → « Relancer » sur une config → la page de résultats se rafraîchit toute seule.
- **Veille** : passe automatiquement à 7h ; le workflow `K8JFePsRgBcj62ZW` peut aussi être exécuté à la main dans l'UI n8n.
- **Scraper isolé** (sans polluer la base) : exécuter `zoFcSerIzOatlKTM` via MCP avec `runId` bidon (999xxx), `ingestSecret` bidon et `ingestUrl: https://example.com/noop` — le scrape tourne, le POST final échoue exprès (405 attendu), et `get_execution` sur le node « Scrape SRP (toutes pages) » montre les biens + photos.
