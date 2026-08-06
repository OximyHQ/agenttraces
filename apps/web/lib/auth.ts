import { betterAuth } from "better-auth";
import { Pool } from "pg";

const globalForAuth = globalThis as typeof globalThis & { agentTracesAuthPool?: Pool };

function authPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return globalForAuth.agentTracesAuthPool ??= new Pool({
    connectionString,
    max: Number(process.env.AUTH_PG_POOL_MAX ?? 5),
    statement_timeout: 15_000,
  });
}

export function getAuth() {
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const secret = process.env.BETTER_AUTH_SECRET ?? (process.env.NODE_ENV === "development" ? "agenttraces-local-development-secret-change-me" : undefined);
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
  return betterAuth({
    appName: "AgentTraces",
    baseURL: process.env.BETTER_AUTH_URL,
    secret,
    database: authPool(),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    socialProviders: githubClientId && githubClientSecret ? { github: { clientId: githubClientId, clientSecret: githubClientSecret } } : {},
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    advanced: {
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
      useSecureCookies: process.env.NODE_ENV === "production",
    },
  });
}
