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
      await pool.query(`CREATE INDEX IF NOT EXISTS runs_started_idx ON runs (started_at DESC);`);

      // -------------------------------------------------------------------
      // Zones (S2) : villes (parent_id NULL, loc_code = code "tout ville")
      // et quartiers (parent_id = id ville, loc_code = code quartier).
      // Seedees au premier demarrage si la table est vide. Pour reseeder
      // depuis zero : TRUNCATE zones; et relance.
      // -------------------------------------------------------------------
      await pool.query(`
        CREATE TABLE IF NOT EXISTS zones (
          id          TEXT        PRIMARY KEY,
          parent_id   TEXT        REFERENCES zones(id) ON DELETE CASCADE,
          label       TEXT        NOT NULL,
          loc_code    TEXT        NOT NULL,
          sort_order  INT         NOT NULL DEFAULT 0,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      const { rows } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM zones`
      );

      if (rows[0].n === 0) {
        // Luxembourg-Ville + 26 quartiers selon la nomenclature atHome
        // (qui differe legerement des 24 quartiers officiels VDL :
        //  Bonnevoie fusionnee, Verlorenkost & Kohlenberg separes,
        //  Neudorf/Weimershof separes, Centre-Ville au lieu de Ville-Haute).
        await pool.query(`
          INSERT INTO zones (id, parent_id, label, loc_code, sort_order) VALUES
            ('lux-ville',      NULL,        'Luxembourg-Ville',           'L9-luxembourg',              0),
            ('beggen',         'lux-ville', 'Beggen',                     'L10-beggen',                 1),
            ('belair',         'lux-ville', 'Belair',                     'L10-belair',                 2),
            ('bonnevoie',      'lux-ville', 'Bonnevoie',                  'L10-bonnevoie',              3),
            ('centre-ville',   'lux-ville', 'Centre-Ville',               'L10-centre-ville',           4),
            ('cents',          'lux-ville', 'Cents',                      'L10-cents',                  5),
            ('cessange',       'lux-ville', 'Cessange',                   'L10-cessange',               6),
            ('clausen',        'lux-ville', 'Clausen',                    'L10-clausen',                7),
            ('dommeldange',    'lux-ville', 'Dommeldange',                'L10-dommeldange',            8),
            ('eich',           'lux-ville', 'Eich',                       'L10-eich',                   9),
            ('gare',           'lux-ville', 'Gare',                       'L10-gare',                  10),
            ('gasperich',      'lux-ville', 'Gasperich / Cloche d''Or',   'L10-gasperich-cloche-d-or', 11),
            ('grund',          'lux-ville', 'Grund',                      'L10-grund',                 12),
            ('hamm',           'lux-ville', 'Hamm',                       'L10-hamm',                  13),
            ('hollerich',      'lux-ville', 'Hollerich',                  'L10-hollerich',             14),
            ('kirchberg',      'lux-ville', 'Kirchberg',                  'L10-kirchberg',             15),
            ('kohlenberg',     'lux-ville', 'Kohlenberg',                 'L10-kohlenberg',            16),
            ('limpertsberg',   'lux-ville', 'Limpertsberg',               'L10-limpertsberg',          17),
            ('merl',           'lux-ville', 'Merl',                       'L10-merl',                  18),
            ('muhlenbach',     'lux-ville', 'Mühlenbach',                 'L10-muhlenbach',            19),
            ('neudorf',        'lux-ville', 'Neudorf',                    'L10-neudorf',               20),
            ('pfaffenthal',    'lux-ville', 'Pfaffenthal',                'L10-pfaffenthal',           21),
            ('pulvermuhle',    'lux-ville', 'Pulvermühle',                'L10-pulvermuehle',          22),
            ('rollingergrund', 'lux-ville', 'Rollingergrund',             'L10-rollingergrund',        23),
            ('verlorenkost',   'lux-ville', 'Verlorenkost',               'L10-verlorenkost',          24),
            ('weimershof',     'lux-ville', 'Weimershof',                 'L10-weimershof',            25),
            ('weimerskirch',   'lux-ville', 'Weimerskirch',               'L10-weimerskirch',          26)
        `);
      }
    })();
  }
  return global._bbinvestSchema;
}
