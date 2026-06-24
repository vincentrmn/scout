# CLAUDE.md — Sextant (BBI estimator)

Contexte persistant du projet. Lu au début de chaque session Claude Code.
Brouillon initial rédigé le 16/06/2026 depuis la session BBIscout (fork du moteur).

> **Nom de travail : Sextant.** Alternatives : Aplomb, Étalon, Vitruve. (À trancher par Vincent.)

---

## 0. Lis ça d'abord — l'honnêteté méthodologique (NON négociable)

**Sextant estime le prix AFFICHÉ d'un bien à partir d'annonces. Ce n'est PAS un valuateur de prix signé.**

- Les annonces (atHome/Immotop) = **prix demandés**, supérieurs au prix de vente réel.
- La **valeur** (prix signé) ne se lit que dans les **actes notariés** → **Observatoire de l'Habitat** (data.public.lu).
- **Le cœur de l'outil = croiser les comparables affichés avec la référence Observatoire (signée) par commune, et montrer l'écart + la distribution.** Pas un chiffre magique : un **faisceau d'indices** que l'agent (Shawna) interprète.
- Les maisons + les petites communes ont **peu/pas de comparables homogènes** → l'estimation y est **indicative**, jamais une valeur ferme. **Toujours afficher la confiance et le nombre de comps.** Mieux vaut « pas assez de données » qu'un faux prix.
- Leçon héritée de BBIscout (vécue, pas théorique) : les données Immotop sont sales (flag `isNew` non fiable → des neufs classés « rénové » ; pas de CPE accessible). **Ne jamais laisser des annonces non vérifiées piloter un chiffre sans garde-fou prix vs Observatoire.**

Si tu construis un « prix moyen des annonces » sans ce recadrage, tu construis un outil qui ment. Ne le fais pas.

## 1. Le projet en une minute

**Sextant** = outil interne d'**estimation / contexte marché** pour **Shawna** (agente), qui fait beaucoup d'estimations de biens pour ses clients. On configure une recherche (commune, type, surface, chambres, prix…), on scrape **atHome + Immotop**, et on dresse un **tableau de comparables** enrichi d'une **lecture marché** (comparatif Observatoire, moyennes, distribution, décote affiché→signé).

Différent de **BBIscout** (qui cherche des deals achat-rénovation-revente à Lux-Ville). Sextant : **toute la géographie luxembourgeoise, maisons + appartements, pas de scoring de flip**, focus estimation.

## 2. Ce qu'on réutilise de BBIscout (le fork)

~70 % de la plomberie vient de BBIscout (repo `vincentrmn/scout`). À **copier puis dépouiller** :
- **Scrapers n8n** : atHome (SRP + fiche détail CPE) et Immotop (api-next `search-list/listings`). Voir `docs/immotop-source2-etude.md` de BBIscout pour le contrat d'API Immotop complet.
- **Dédup cross-source** (`lib/dedup.ts`) : lat/lng <150 m + surface ±2 + prix ±3 %, jamais de fusion intra-source. À garder tel quel.
- **Ingest** (upsert listings, snapshots, dédup), **Postgres Railway**, **Next 14 App Router**, **CSS maison**.
- **Observatoire** (`lib/observatoire.ts`, data.public.lu) : à **étendre à toutes les communes**.

À **JETER** : tout le scoring de flip (travaux/marge/verdict/maxBuyPrice), les playlists, le suivi collaboratif, la veille de deals, la page Marché vélocité (sauf si réutile plus tard).

## 3. Différences clés vs BBIscout

| | BBIscout | Sextant |
|---|---|---|
| Géo | Lux-Ville (26 quartiers) | **Toutes les communes du Luxembourg** |
| Type | Apparts | **Maisons + appartements** |
| Filtres | type, zone, surface, prix, CPE | + **chambres, salles de bain, terrain, etc.** (tout ce qu'atHome filtre) |
| Sortie | tableau scoré (marge, verdict) | **tableau de comparables + interprétation marché** |
| Immotop | couverture + Nouveautés | **couverture des comparables** (mais pas pour un chiffre officiel — données sales) |
| But | trouver des deals | **estimer / contextualiser une valeur** |

⚠️ **Filtres = uniquement ce qu'atHome expose dans son SRP.** Ne pas inventer de filtres non scrappables. (Immotop a moins de filtres fins ; certains critères ne s'appliqueront qu'à atHome — l'assumer dans l'UI, comme le filtre CPE/état de BBIscout.)

## 4. Géographie — le gros chantier d'extension

- **atHome** : les `loc_code`/`q_code` n'existent que pour Lux-Ville dans BBIscout. Pour toutes les communes, il faut **construire la table `zones` nationale** (chaque commune = un `loc_code` L… + son `q_code` token atHome, obligatoire pour que `loc=` soit respecté). Méthode : inspecter le SRP atHome d'une commune pour récupérer son token. **Gros travail de seed.** (Le Luxembourg compte ~100 communes.)
- **Immotop** : geo via `/api-next/geography/autocomplete/?query=<commune>` → `idComune` (type 2) + chaîne parente `fkRegione`/`idProvincia`. Le contrat est dans `docs/immotop-source2-etude.md`. Il faut mapper chaque commune → ses ids Immotop.
- **Observatoire** : data.public.lu publie des stats **par commune** (prix annoncés + prix de vente). **C'est l'actif central de Sextant** — l'étendre de Lux-Ville à toutes les communes est prioritaire.

## 5. Méthodologie d'estimation (le produit)

Pour une recherche (commune + critères), produire :
1. **Le tableau des comparables** (atHome + Immotop dédupliqués) : prix, €/m², surface, chambres, CPE (atHome), état, lien.
2. **La distribution** : min / P25 / médiane / P75 / max des €/m² (et des prix absolus pour les maisons, où le €/m² est trompeur à cause du terrain).
3. **Le comparatif Observatoire** : prix annoncé moyen commune (affiché) + **prix de vente signé** (notarial) → **l'écart affiché→signé** réel de la commune.
4. **Une fourchette d'estimation** = comparables (médiane/percentile selon le type) × décote affiché→signé locale, **bornée et accompagnée d'une note de confiance** (nb de comps, dispersion, présence de données notariales).
5. **Garde-fous hérités** : plafonner les comparables aberrants vs la réf Observatoire (un comp >> réf = neuf/luxe). Sur les maisons, **ne pas raisonner au m² seul** (terrain). Distinguer affiché vs signé partout.

**Le livrable n'est pas un nombre, c'est un tableau interprété + une fourchette honnête.**

## 6. Pièges connus (hérités de BBIscout — NE PAS REFAIRE)

1. **Immotop `isNew` non fiable** → des neufs se déguisent en « rénové » (état « Ottimo/Ristrutturato » = excellent OU rénové). **Filtrer par PRIX vs Observatoire**, pas par flags.
2. **Pas de CPE Immotop** (fiche derrière mur anti-bot 403, api détail 500). Le CPE n'existe que côté atHome (via fiche détail). Pour un comp « ancien garanti », **CPE C-F = jamais un neuf** (un neuf est A/B).
3. **Affiché ≠ signé** : toujours appliquer/afficher la décote Observatoire.
4. **Maisons** : €/m² trompeur (terrain), comparables hétérogènes → confiance faible, raisonner en prix absolu + fourchette large.
5. **atHome fiche détail** = 1 req/2,5 s → un scrape national large peut être très long ; cadrer (pagination, filtres serveur, garde-fou timeout `reapStaleRuns`).
6. **Immotop sérialise les exécutions n8n** : un gros scrape bloque les suivants.

## 7. Stack & infra (cible, calquée sur BBIscout)

- **Next.js 14 App Router** sous `src/`, CSS maison, Postgres Railway (`ensureSchema()` idempotent), n8n Railway pour les scrapers (webhooks dédiés).
- Déploiement Railway auto sur push `main`. `npm run build` doit passer avant tout commit.
- Variables : `DATABASE_URL`, `N8N_WEBHOOK_URL` (atHome), `N8N_IMMOTOP_WEBHOOK_URL`, `INGEST_SECRET`, `ANTHROPIC_API_KEY` (classification état atHome, optionnel), `PUBLIC_APP_URL`.

## 8. Backlog / phases proposées

- **Phase 0 — Étude** : valider la faisabilité du seed géo national atHome (tokens `q_code` par commune) + le périmètre Observatoire par commune. **Avant de coder** (méthode BBIscout : étude réelle d'abord).
- **Phase 1 — MVP 1 commune** : recherche atHome+Immotop sur UNE commune, tableau de comparables + distribution. Valider le shape.
- **Phase 2 — Couche Observatoire** : comparatif affiché/signé + fourchette d'estimation + confiance.
- **Phase 3 — Généralisation** : toutes communes, maisons, filtres étendus.
- **Phase 4 — Polish** : export (PDF estimation pour le client de Shawna ?), historique des estimations.

## 9. Conventions de travail (reprises de BBIscout)

- **Vincent ne tape aucune commande.** Claude exécute build/git/n8n lui-même.
- **`npm run build` passe avant tout commit.** Jamais de push cassé.
- **Étude + tests réels AVANT de coder les gros morceaux** (le seed géo, le scraping national : on mesure d'abord).
- Branche dédiée → build → commit → PR squash-merge `main` (Railway déploie). Prévenir Vincent quand un batch est fini.
- **Honnêteté directe** sur les limites (surtout : ne jamais survendre la précision d'estimation).
- Français concis, décisions tranchées et justifiées, ne poser que les questions bloquantes.
- Ne pas écrire l'identifiant de modèle dans les commits/PR/code.

## 10. La question à se reposer en permanence

*« Est-ce que ce chiffre, je le mettrais devant le client de Shawna ? »* Si la donnée est trop sale ou trop sparse pour ça → afficher la fourchette + la confiance basse, pas un faux prix précis. **La crédibilité de l'outil tient à ça.**
