import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _bbinvestPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var _bbinvestSchema: Promise<void> | undefined;
}

export const pool =
  global._bbinvestPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") global._bbinvestPool = pool;

export function ensureSchema(): Promise<void> {
  if (!global._bbinvestSchema) {
    global._bbinvestSchema = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS configs (
          id          SERIAL PRIMARY KEY,
          name        TEXT NOT NULL,
          criteria    JSONB NOT NULL,
          scoring     JSONB NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      // S6 Phase 2 — veille auto chaque matin.
      await pool.query(
        `ALTER TABLE configs ADD COLUMN IF NOT EXISTS watch_enabled BOOLEAN NOT NULL DEFAULT false;`
      );

      await pool.query(`
        CREATE TABLE IF NOT EXISTS runs (
          id          SERIAL PRIMARY KEY,
          config_id   INTEGER REFERENCES configs(id) ON DELETE SET NULL,
          config_name TEXT,
          status      TEXT NOT NULL DEFAULT 'running',
          count       INTEGER NOT NULL DEFAULT 0,
          results     JSONB NOT NULL DEFAULT '[]',
          error       TEXT,
          started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          finished_at TIMESTAMPTZ
        );
      `);
      await pool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS stats JSONB;`);
      // S6 Phase 2 — run issu de la veille planifiee (=> source des Nouveautes).
      await pool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_watch BOOLEAN NOT NULL DEFAULT false;`);
      // S9 — snapshot des hypotheses de scoring du run (pour capture au suivi).
      await pool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS scoring JSONB;`);
      await pool.query(`CREATE INDEX IF NOT EXISTS runs_started_idx ON runs (started_at DESC);`);

      // Zones (S2/S4)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS zones (
          id          TEXT        PRIMARY KEY,
          parent_id   TEXT        REFERENCES zones(id) ON DELETE CASCADE,
          label       TEXT        NOT NULL,
          loc_code    TEXT        NOT NULL,
          q_code      TEXT,
          sort_order  INT         NOT NULL DEFAULT 0,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(`ALTER TABLE zones ADD COLUMN IF NOT EXISTS q_code TEXT;`);
      await pool.query(`ALTER TABLE zones ADD COLUMN IF NOT EXISTS resale_eur_per_m2 NUMERIC;`);

      const { rows } = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM zones`);
      if (rows[0].n === 0) {
        await pool.query(`
          INSERT INTO zones (id, parent_id, label, loc_code, q_code, sort_order) VALUES
            ('lux-ville',      NULL,        'Luxembourg-Ville',           'L9-luxembourg',              '33e38b1b',  0),
            ('beggen',         'lux-ville', 'Beggen',                     'L10-beggen',                 '119ebefe',  1),
            ('belair',         'lux-ville', 'Belair',                     'L10-belair',                 'f37c45a0',  2),
            ('bonnevoie',      'lux-ville', 'Bonnevoie',                  'L10-bonnevoie',              'fd3cdbc5',  3),
            ('centre-ville',   'lux-ville', 'Centre-Ville',               'L10-centre-ville',           'a95e09da',  4),
            ('cents',          'lux-ville', 'Cents',                      'L10-cents',                  '4d568d61',  5),
            ('cessange',       'lux-ville', 'Cessange',                   'L10-cessange',               'a7f77075',  6),
            ('clausen',        'lux-ville', 'Clausen',                    'L10-clausen',                'b4ebf238',  7),
            ('dommeldange',    'lux-ville', 'Dommeldange',                'L10-dommeldange',            'f20d2a31',  8),
            ('eich',           'lux-ville', 'Eich',                       'L10-eich',                   'c02c656a',  9),
            ('gare',           'lux-ville', 'Gare',                       'L10-gare',                   '08ecb2d2', 10),
            ('gasperich',      'lux-ville', 'Gasperich / Cloche d''Or',   'L10-gasperich-cloche-d-or',  '5c12d5b4', 11),
            ('grund',          'lux-ville', 'Grund',                      'L10-grund',                  'c09d83fb', 12),
            ('hamm',           'lux-ville', 'Hamm',                       'L10-hamm',                   'd0270c69', 13),
            ('hollerich',      'lux-ville', 'Hollerich',                  'L10-hollerich',              '025ab94b', 14),
            ('kirchberg',      'lux-ville', 'Kirchberg',                  'L10-kirchberg',              'dea70e87', 15),
            ('kohlenberg',     'lux-ville', 'Kohlenberg',                 'L10-kohlenberg',             'fece382b', 16),
            ('limpertsberg',   'lux-ville', 'Limpertsberg',               'L10-limpertsberg',           'a2d9b00c', 17),
            ('merl',           'lux-ville', 'Merl',                       'L10-merl',                   '6ee95216', 18),
            ('muhlenbach',     'lux-ville', 'Mühlenbach',                 'L10-muhlenbach',             '67c33ee9', 19),
            ('neudorf',        'lux-ville', 'Neudorf',                    'L10-neudorf',                '77eec8cb', 20),
            ('pfaffenthal',    'lux-ville', 'Pfaffenthal',                'L10-pfaffenthal',            '7eed7bed', 21),
            ('pulvermuhle',    'lux-ville', 'Pulvermühle',                'L10-pulvermuehle',           'f29b2f97', 22),
            ('rollingergrund', 'lux-ville', 'Rollingergrund',             'L10-rollingergrund',         'f9c49c4e', 23),
            ('verlorenkost',   'lux-ville', 'Verlorenkost',               'L10-verlorenkost',           'afa0f7d6', 24),
            ('weimershof',     'lux-ville', 'Weimershof',                 'L10-weimershof',             'c683adc1', 25),
            ('weimerskirch',   'lux-ville', 'Weimerskirch',               'L10-weimerskirch',           'fa0760ad', 26)
        `);
      } else {
        await pool.query(`
          UPDATE zones SET q_code = src.q FROM (VALUES
            ('lux-ville','33e38b1b'),('beggen','119ebefe'),('belair','f37c45a0'),('bonnevoie','fd3cdbc5'),
            ('centre-ville','a95e09da'),('cents','4d568d61'),('cessange','a7f77075'),('clausen','b4ebf238'),
            ('dommeldange','f20d2a31'),('eich','c02c656a'),('gare','08ecb2d2'),('gasperich','5c12d5b4'),
            ('grund','c09d83fb'),('hamm','d0270c69'),('hollerich','025ab94b'),('kirchberg','dea70e87'),
            ('kohlenberg','fece382b'),('limpertsberg','a2d9b00c'),('merl','6ee95216'),('muhlenbach','67c33ee9'),
            ('neudorf','77eec8cb'),('pfaffenthal','7eed7bed'),('pulvermuhle','f29b2f97'),('rollingergrund','f9c49c4e'),
            ('verlorenkost','afa0f7d6'),('weimershof','c683adc1'),('weimerskirch','fa0760ad')
          ) AS src(id, q)
          WHERE zones.id = src.id AND (zones.q_code IS NULL OR zones.q_code <> src.q);
        `);
      }
      await pool.query(
        `UPDATE zones SET resale_eur_per_m2 = 11000 WHERE id = 'lux-ville' AND resale_eur_per_m2 IS NULL;`
      );

      // S12 — Référence officielle prix AFFICHÉ €/m² par quartier (Observatoire
      // de l'Habitat / VdL, base prix annoncés 2025). Sert de repli prioritaire
      // et de cross-check dans les propositions. (Grund exclu : effectif * trop faible.)
      await pool.query(`ALTER TABLE zones ADD COLUMN IF NOT EXISTS announced_eur_per_m2 NUMERIC;`);
      await pool.query(`
        UPDATE zones SET announced_eur_per_m2 = src.v FROM (VALUES
          ('lux-ville', 12362), ('beggen', 10124), ('belair', 14273), ('bonnevoie', 10560),
          ('cents', 8892), ('cessange', 10900), ('clausen', 9960), ('dommeldange', 9990),
          ('eich', 11182), ('gare', 10829), ('gasperich', 12289), ('hamm', 10559),
          ('hollerich', 11406), ('kirchberg', 11407), ('limpertsberg', 11977), ('merl', 11768),
          ('muhlenbach', 11695), ('neudorf', 13601), ('pfaffenthal', 9665), ('pulvermuhle', 10296),
          ('rollingergrund', 11014), ('centre-ville', 11743), ('weimerskirch', 10062)
        ) AS src(id, v) WHERE zones.id = src.id;
      `);

      // S5 — Listings
      await pool.query(`
        CREATE TABLE IF NOT EXISTS listings (
          id          TEXT PRIMARY KEY,
          price       INTEGER,
          prev_price  INTEGER,
          surface     NUMERIC,
          commune     TEXT,
          rooms       INTEGER,
          title       TEXT,
          url         TEXT,
          cpe         TEXT,
          first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
          tracked     BOOLEAN NOT NULL DEFAULT false,
          tracked_at  TIMESTAMPTZ
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS listings_tracked_idx ON listings (tracked) WHERE tracked = true;`
      );

      // S7 — Suivi collaboratif : statut de pipeline par bien suivi.
      // 'to_contact' | 'contacted' | 'visit' | 'offer' | 'won' | 'lost'
      await pool.query(
        `ALTER TABLE listings ADD COLUMN IF NOT EXISTS follow_status TEXT NOT NULL DEFAULT 'to_contact';`
      );

      // S8 — Photos de l'annonce (URLs atHome, max 6, extraites par n8n).
      await pool.query(
        `ALTER TABLE listings ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]';`
      );
      await pool.query(`UPDATE listings SET photos = '[]'::jsonb WHERE photos IS NULL;`);

      // S9 — Suivis : hypotheses de la recherche d'origine (capturees au suivi)
      // + essai de rentabilite persiste (override). Forme commune :
      //   { worksEurPerM2, worksVatPct, notaryPct, resaleAgencyPct, targetMarginPct, resalePerM2 }
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS search_scoring JSONB;`);
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS analysis_scoring JSONB;`);

      // S10 — Géolocalisation (carte) : coordonnées précises atHome + adresse.
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;`);
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;`);
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS address TEXT;`);

      // S6 Phase 1 — Historique de prix
      await pool.query(`
        CREATE TABLE IF NOT EXISTS listing_snapshots (
          id          SERIAL PRIMARY KEY,
          listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          price       INTEGER NOT NULL,
          seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS listing_snapshots_listing_idx ON listing_snapshots (listing_id, seen_at);`
      );

      // S6 Phase 3 — Nouveautes (evenements de veille)
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'findings')
             AND NOT EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_name = 'findings' AND column_name = 'kind'
             )
          THEN
            DROP TABLE findings;
          END IF;
        END $$;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS findings (
          id          SERIAL PRIMARY KEY,
          listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          run_id      INTEGER REFERENCES runs(id) ON DELETE SET NULL,
          config_name TEXT,
          kind        TEXT NOT NULL,
          verdict     TEXT,
          margin_pct  NUMERIC,
          price       INTEGER,
          prev_price  INTEGER,
          found_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS findings_found_idx ON findings (found_at DESC);`);

      // -------------------------------------------------------------------
      // S7 — Suivi collaboratif : fil de remarques + journal des statuts.
      //   kind = 'note'   -> remarque ecrite (body = texte)
      //   kind = 'status' -> changement de statut (body = nouveau statut, cle interne)
      // Append-only => aucune collision possible entre Vincent et Jamie.
      // -------------------------------------------------------------------
      await pool.query(`
        CREATE TABLE IF NOT EXISTS listing_notes (
          id          SERIAL PRIMARY KEY,
          listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          author      TEXT NOT NULL,
          kind        TEXT NOT NULL DEFAULT 'note',
          body        TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS listing_notes_listing_idx ON listing_notes (listing_id, created_at);`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS listing_notes_created_idx ON listing_notes (created_at DESC);`
      );

      // -------------------------------------------------------------------
      // S11 — Playlists de biens suivis.
      //   rules JSONB = { cpe[], communes[], configIds[], match: 'all'|'any' }
      //   -> remplissage AUTO des biens suivis qui matchent.
      // playlist_items = surcharges MANUELLES :
      //   kind='include' (épingler hors règles) | 'exclude' (retirer un match).
      // -------------------------------------------------------------------
      await pool.query(`
        CREATE TABLE IF NOT EXISTS playlists (
          id          SERIAL PRIMARY KEY,
          name        TEXT NOT NULL,
          rules       JSONB NOT NULL DEFAULT '{}',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS playlist_items (
          playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          listing_id  TEXT    NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
          kind        TEXT    NOT NULL,
          PRIMARY KEY (playlist_id, listing_id)
        );
      `);

      // -------------------------------------------------------------------
      // S12 — Calculateur de prix de revente par quartier.
      // -------------------------------------------------------------------
      // Run de relevé de marché (alimente market_samples, pas les Nouveautés).
      await pool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_survey BOOLEAN NOT NULL DEFAULT false;`);

      // Comps terrain : annonces anciennes ville, classées par LLM (etat).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_samples (
          id              SERIAL PRIMARY KEY,
          listing_id      TEXT,
          quartier_slug   TEXT,
          price           INTEGER,
          surface         NUMERIC,
          price_m2        NUMERIC,
          cpe             TEXT,
          description     TEXT,
          etat            TEXT,
          etat_confidence NUMERIC,
          url             TEXT,
          observed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS market_samples_quartier_idx ON market_samples (quartier_slug, observed_at);`
      );

      // Données Observatoire de l'Habitat (actes notariés ville).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS observatoire_data (
          id                SERIAL PRIMARY KEY,
          dataset           TEXT NOT NULL,
          period            TEXT NOT NULL,
          value_eur_m2      NUMERIC,
          resource_modified TIMESTAMPTZ,
          fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (dataset, period)
        );
      `);

      // Propositions de prix de revente par quartier (à valider à la main).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS price_proposals (
          id              SERIAL PRIMARY KEY,
          quartier_slug   TEXT NOT NULL,
          proposed_eur_m2 INTEGER,
          current_eur_m2  INTEGER,
          calc            JSONB,
          status          TEXT NOT NULL DEFAULT 'pending',
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          decided_at      TIMESTAMPTZ
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS price_proposals_status_idx ON price_proposals (status);`);

      // -------------------------------------------------------------------
      // S14 — Immotop.lu, 2e source (pipeline PARALLÈLE et isolé).
      //   source     = portail d'origine du bien ('athome' par défaut | 'immotop').
      //   alt_source / alt_id / alt_url = 2e annonce du MÊME bien physique
      //     détectée par dédup géographique (cf. lib/dedup.ts). On conserve les
      //     deux références ; l'enregistrement reste celui de la source primaire.
      // Tout est additif : les biens atHome existants gardent source='athome'.
      // -------------------------------------------------------------------
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'athome';`);
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS alt_source TEXT;`);
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS alt_id TEXT;`);
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS alt_url TEXT;`);
      // Index de pré-filtrage de la dédup (candidats par prix ; surface/géo affinés en JS).
      await pool.query(
        `CREATE INDEX IF NOT EXISTS listings_dedup_idx ON listings (price) WHERE lat IS NOT NULL AND lng IS NOT NULL;`
      );
      // market_samples : provenance du comp (évite le double-comptage cross-source).
      await pool.query(`ALTER TABLE market_samples ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'athome';`);
      // S14 — état de rénovation lu directement chez immotop (ga4Condition) :
      // 'a_renover' | 'habitable' | 'renove'. NULL pour atHome (pas de donnée).
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS etat TEXT;`);

      // -------------------------------------------------------------------
      // S15 — Vélocité de marché : capture des biens passés « vendus » (signal
      // explicite isSoldProperty d'atHome, jeté jusqu'ici au scraping) pour
      // mesurer durée de vente + décote affiché→vente par quartier.
      //   market_status = 'active' | 'sold'
      //   sold_at  = 1re fois où on voit le bien marqué vendu (figé)
      //   sold_price = prix au moment de la vente
      // -------------------------------------------------------------------
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS market_status TEXT NOT NULL DEFAULT 'active';`);
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;`);
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_price INTEGER;`);
      await pool.query(`CREATE INDEX IF NOT EXISTS listings_sold_idx ON listings (sold_at DESC) WHERE market_status = 'sold';`);

      // S16 — « disparu » : un bien vu dans les relevés larges puis absent (≥3 j)
      // est présumé parti (vendu/retiré). Alimente Marché aussi pour Immotop
      // (qui n'a pas de flag vendu). gone_at = dernière fois où on l'a vu.
      await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS gone_at TIMESTAMPTZ;`);
      await pool.query(`CREATE INDEX IF NOT EXISTS listings_gone_idx ON listings (gone_at DESC) WHERE market_status = 'gone';`);

      // S16 — Réglages applicatifs (clé -> JSONB). Porte la « config Nouveautés ».
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key        TEXT PRIMARY KEY,
          value      JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      // S16 — reset unique du 1er balayage « disparus » (trop large : il avait
      // marqué « parti » des biens encore en ligne, pas re-scrapés depuis que
      // les relevés quotidiens existent). Le nouveau balayage (conservateur)
      // re-marquera correctement au fil des jours.
      {
        const seen = await pool.query(`SELECT 1 FROM app_settings WHERE key='gone_reset_s16b'`);
        if (!seen.rows.length) {
          await pool.query(`UPDATE listings SET market_status='active', gone_at=NULL WHERE market_status='gone'`);
          await pool.query(`INSERT INTO app_settings (key, value) VALUES ('gone_reset_s16b', 'true'::jsonb) ON CONFLICT (key) DO NOTHING`);
        }
      }

      // S15 — Nommage cohérent des runs techniques (relevés). Idempotent.
      await pool.query(`UPDATE runs SET config_name='Relevé de marché — atHome' WHERE config_name='Relevé de marché';`);
      await pool.query(`UPDATE runs SET config_name='Relevé de marché — Immotop' WHERE config_name='Immotop — relevé';`);
      // Run du scraper immotop (parallèle au survey ; n'alimente pas les runs atHome).
      await pool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_immotop BOOLEAN NOT NULL DEFAULT false;`);
      // S14 — recherche multi-sources : nb de sources dont on attend encore le POST.
      //   NULL  => run mono-source historique (atHome) : finalisé au 1er POST (inchangé).
      //   >=1   => run multi-sources : chaque POST fusionne ses biens + décrémente ;
      //            le run passe 'done' quand le compteur atteint 0.
      await pool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS sources_pending INTEGER;`);
    })();
  }
  return global._bbinvestSchema;
}

/**
 * Garde-fou : le webhook n8n est fire-and-forget (cf. trigger.ts) et l'app n'a
 * aucun timeout. Si n8n ne POSTe jamais le résultat (exécution plantée avant le
 * POST, ou file bloquée), le run reste « running » à vie. On bascule en erreur
 * tout run resté « running » plus de 45 min (au-delà de tout scrape légitime,
 * survey comprise). Idempotent, sans effet sur les runs terminés.
 */
/**
 * S16 — Marque « parti » (gone) les biens vus récemment dans les relevés puis
 * disparus. Fenêtre CONSERVATRICE pour éviter les faux positifs :
 *   - absent depuis ≥ 4 jours (plusieurs relevés quotidiens manqués),
 *   - mais vu il y a ≤ 18 jours (donc activement scrapé récemment — on ne touche
 *     pas aux vieux biens du référentiel d'avant les relevés quotidiens),
 *   - dans la bande couverte par les 2 relevés (surface 20–100).
 */
export async function reapGoneListings(): Promise<void> {
  await pool.query(
    `UPDATE listings
        SET market_status = 'gone', gone_at = last_seen
      WHERE market_status = 'active'
        AND last_seen < now() - interval '4 days'
        AND last_seen > now() - interval '18 days'
        AND surface BETWEEN 20 AND 100`
  );
}

export async function reapStaleRuns(): Promise<void> {
  await pool.query(
    `UPDATE runs
       SET status = 'error',
           error = 'Délai dépassé : aucune réponse du scraper (n8n) après 45 min. Le run a été clôturé automatiquement.',
           finished_at = now()
     WHERE status = 'running'
       AND started_at < now() - interval '45 minutes'`
  );
}
