# Scout — recherche & scoring achat-revente atHome

Mini-app : interface protégée par mot de passe → critères de recherche sauvegardables →
n8n scrape atHome → l'app score les biens (achat-revente) et garde l'historique.

## Architecture

```
[Interface Next.js] --webhook--> [n8n: scraping] --POST /api/ingest--> [Next.js: scoring] 
        |                                                                      |
        +-------------------------- [Postgres Railway] ------------------------+
```

- **Next.js** (ce repo) : login, formulaire de critères, configs sauvegardées, historique, scoring, affichage.
- **n8n** : reçoit le webhook, scrape atHome, renvoie les annonces brutes. (Workflow : `n8n-workflow.json`)
- **Postgres** : tables `configs` et `runs`, créées automatiquement au premier appel.

Le scoring vit **dans l'app** (`src/lib/scoring.ts`) : n8n ne fait que scraper, l'app calcule
verdict GO / NÉGOCIER / PASS + prix d'achat max. Une seule source de vérité.

## Déploiement Railway (≈ 15 min)

1. **Postgres** : dans ton projet Railway, *New → Database → PostgreSQL*. Railway expose `DATABASE_URL`.
2. **L'app** : *New → GitHub Repo* (pousse ce dossier) ou *Deploy from local*. Railway détecte Next.js tout seul.
3. **Variables** du service Next.js (voir `.env.example`) :
   - `APP_PASSWORD` — le mot de passe d'accès
   - `SESSION_SECRET` — chaîne aléatoire (32+ caractères)
   - `DATABASE_URL` — référence celle du plugin Postgres (`${{Postgres.DATABASE_URL}}`)
   - `N8N_WEBHOOK_URL` — l'URL du webhook n8n (étape suivante)
   - `INGEST_SECRET` — chaîne aléatoire, partagée avec n8n
   - `PGSSL` — laisser vide en interne Railway ; mettre `require` si connexion externe SSL
4. **n8n** : importe `n8n-workflow.json`. Note l'URL du webhook (`/webhook/scout-search`)
   et reporte-la dans `N8N_WEBHOOK_URL`. Le workflow renvoie les résultats sur `ingestUrl`
   (fourni automatiquement par l'app) avec `INGEST_SECRET`.

## Le seul point à calibrer : le parsing atHome

Tout le reste fonctionne dès le déploiement. Le node **"Parse annonces (A CALIBRER)"** dans n8n
contient pour l'instant une annonce factice (pour valider le bout-en-bout). À remplacer par
l'extraction réelle :

1. Dans le node, logge le HTML reçu et cherche un blob JSON embarqué
   (`__NEXT_DATA__` ou équivalent) — beaucoup plus robuste que parser le HTML.
2. Mappe chaque annonce vers : `{ id, url, title, price:number, surface:number, commune, cpe, rooms }`.
3. Le CPE est souvent absent de la page de résultats → fetch la fiche détail uniquement pour
   les biens qui passent déjà prix/surface/zone, puis applique le filtre `cpeClasses` / `keywords`.

Rythme conseillé : 1 requête / 2-3 s, en-têtes navigateur réalistes (anti-bot atHome).

## Lancer en local

```bash
npm install
cp .env.example .env.local   # remplis les valeurs
npm run dev                  # http://localhost:3000
```
