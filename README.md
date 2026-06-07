# BBInvest — recherche & scoring achat-revente atHome

Mini-app : interface protégée par mot de passe → critères de recherche sauvegardables →
n8n scrape atHome → l'app score les biens (achat-revente) et garde l'historique.

> Anciennement « Scout » durant le Sprint 1. Renommée BBInvest au Sprint 2.

## Architecture

```
[Interface Next.js] --webhook--> [n8n: scraping] --POST /api/ingest--> [Next.js: scoring]
        |                                                                      |
        +-------------------------- [Postgres Railway] ------------------------+
```

- **Next.js** (ce repo) : login, formulaire de critères, configs sauvegardées, historique, scoring, affichage.
- **n8n** : reçoit le webhook, scrape atHome, renvoie les annonces brutes. Workflow live : `BBInvest — atHome scraper` (ID `iwHOAiQKAUeleOoo`). Snapshot dans `n8n-workflow.json`.
- **Postgres** : tables `configs`, `runs`, `zones`, créées automatiquement au premier appel.

Le scoring vit **dans l'app** (`src/lib/scoring.ts`) : n8n ne fait que scraper, l'app calcule
verdict GO / NÉGOCIER / PASS + prix d'achat max. Une seule source de vérité.

## Nouveau Sprint 2 — sélection de localisation

La sélection des zones se fait via un composant `ZonePicker` :
- Toggle « Tout Luxembourg-Ville » (utilise le code atHome `L9-luxembourg`).
- Sinon, sélection multi-quartiers parmi les 26 codes `L10-*` exposés par atHome.

La table `zones` (hiérarchique : villes → quartiers) est seedée automatiquement au premier
démarrage avec Luxembourg-Ville + ses 26 quartiers. Pour ajouter une zone plus tard sans
redéployer :
```sql
INSERT INTO zones (id, parent_id, label, loc_code, sort_order)
VALUES ('mon-id', 'lux-ville', 'Mon Quartier', 'L10-mon-code', 99);
```

Le critère stocké côté config s'appelle `criteria.locCodes` (tableau de codes loc atHome).
Le workflow n8n accepte plusieurs codes séparés par virgule dans le param `loc=`, donc une
seule requête SRP suffit même avec 26 quartiers cochés.

## Déploiement Railway (≈ 15 min, premier setup)

1. **Postgres** : dans ton projet Railway, *New → Database → PostgreSQL*. Railway expose `DATABASE_URL`.
2. **L'app** : *New → GitHub Repo* (pousse ce dossier) ou *Deploy from local*. Railway détecte Next.js tout seul.
3. **Variables** du service Next.js (voir `.env.example`) :
   - `APP_PASSWORD` — le mot de passe d'accès
   - `SESSION_SECRET` — chaîne aléatoire (32+ caractères)
   - `DATABASE_URL` — référence celle du plugin Postgres (`${{Postgres.DATABASE_URL}}`)
   - `N8N_WEBHOOK_URL` — l'URL du webhook n8n (path historique `scout-search` conservé)
   - `INGEST_SECRET` — chaîne aléatoire, partagée avec n8n
   - `PGSSL` — laisser vide en interne Railway ; mettre `require` si connexion externe SSL
4. **n8n** : le workflow live est déjà à jour. Snapshot dans `n8n-workflow.json` pour réimport
   éventuel. Le webhook reste à `/webhook/scout-search` (renommage du path = optionnel et
   impliquerait de mettre à jour `N8N_WEBHOOK_URL`).

## Lancer en local

```bash
npm install
cp .env.example .env.local   # remplis les valeurs
npm run dev                  # http://localhost:3000
```
