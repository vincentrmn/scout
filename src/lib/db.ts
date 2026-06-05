import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _scoutPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var _scoutSchema: Promise<void> | undefined;
}

export const pool =
  global._scoutPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") global._scoutPool = pool;

// Cree les tables au premier appel, une seule fois par process.
export function ensureSchema(): Promise<void> {
  if (!global._scoutSchema) {
    global._scoutSchema = (async () => {
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
    })();
  }
  return global._scoutSchema;
}
