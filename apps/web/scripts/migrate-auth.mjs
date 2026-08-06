import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for auth migrations");

const pool = new Pool({ connectionString, max: 1, statement_timeout: 30_000 });
try {
  const auth = betterAuth({ database: pool, secret: process.env.BETTER_AUTH_SECRET ?? "migration-only-secret-with-at-least-32-characters" });
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  process.stdout.write("Better Auth schema is current.\n");
} finally {
  await pool.end();
}
