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

// Cree les tables au premier appel, une seule fois par process.
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

      // S3 — stats du run (totalAtHome, pages, exclusions, capped) remontees par n8n.
      await pool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS stats JSONB;`);

      await pool.query(`CREATE INDEX IF NOT EXISTS runs_started_idx ON runs (started_at DESC);`);

      // -------------------------------------------------------------------
      // Zones (S2) : villes (parent_id NULL, loc_code = code "tout ville")
      // et quartiers (parent_id = id ville, loc_code = code quartier).
      // S2.1 : q_code (token atHome). S4 : resale_eur_per_m2 (prix de revente).
      // -------------------------------------------------------------------
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

      // Migrations idempotentes (installations deja deployees).
      await pool.query(`ALTER TABLE zones ADD COLUMN IF NOT EXISTS q_code TEXT;`);
      // S4 — prix de revente cible au m2, par zone. NULL sur un quartier = herite
      // du prix de sa ville (parent). Porte par la ville = prix par defaut.
      await pool.query(`ALTER TABLE zones ADD COLUMN IF NOT EXISTS resale_eur_per_m2 NUMERIC;`);

      const { rows } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM zones`
      );

      if (rows[0].n === 0) {
        // Seed initial : Luxembourg-Ville + 26 quartiers, avec leur q_code atHome.
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
        // Backfill idempotent du q_code (installations S2.0).
        await pool.query(`
          UPDATE zones SET q_code = src.q FROM (VALUES
            ('lux-ville',      '33e38b1b'),
            ('beggen',         '119ebefe'),
            ('belair',         'f37c45a0'),
            ('bonnevoie',      'fd3cdbc5'),
            ('centre-ville',   'a95e09da'),
            ('cents',          '4d568d61'),
            ('cessange',       'a7f77075'),
            ('clausen',        'b4ebf238'),
            ('dommeldange',    'f20d2a31'),
            ('eich',           'c02c656a'),
            ('gare',           '08ecb2d2'),
            ('gasperich',      '5c12d5b4'),
            ('grund',          'c09d83fb'),
            ('hamm',           'd0270c69'),
            ('hollerich',      '025ab94b'),
            ('kirchberg',      'dea70e87'),
            ('kohlenberg',     'fece382b'),
            ('limpertsberg',   'a2d9b00c'),
            ('merl',           '6ee95216'),
            ('muhlenbach',     '67c33ee9'),
            ('neudorf',        '77eec8cb'),
            ('pfaffenthal',    '7eed7bed'),
            ('pulvermuhle',    'f29b2f97'),
            ('rollingergrund', 'f9c49c4e'),
            ('verlorenkost',   'afa0f7d6'),
            ('weimershof',     'c683adc1'),
            ('weimerskirch',   'fa0760ad')
          ) AS src(id, q)
          WHERE zones.id = src.id
            AND (zones.q_code IS NULL OR zones.q_code <> src.q);
        `);
      }

      // S4 — prix de revente par defaut (porte par la ville Luxembourg-Ville).
      // Pose une seule fois ; ne reecrit jamais une valeur deja calibree.
      await pool.query(
        `UPDATE zones SET resale_eur_per_m2 = 11000
         WHERE id = 'lux-ville' AND resale_eur_per_m2 IS NULL;`
      );

      // -------------------------------------------------------------------
      // S5 — Listings : persistance cross-run des biens scrapes.
      // Cle primaire = id atHome (stable). Ne touche pas tracked/first_seen
      // lors des upserts ; seul /api/listings/track modifie tracked.
      // -------------------------------------------------------------------
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
    })();
  }
  return global._bbinvestSchema;
}
