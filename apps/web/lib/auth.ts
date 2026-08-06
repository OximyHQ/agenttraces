import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import * as schema from "@/db/schema";

export function getAuth() {
  const bindings = env as unknown as Record<string, string | undefined>;
  const githubClientId = bindings.GITHUB_CLIENT_ID ?? process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = bindings.GITHUB_CLIENT_SECRET ?? process.env.GITHUB_CLIENT_SECRET;
  const secret = bindings.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? (process.env.NODE_ENV === "development" ? "agenttraces-local-development-secret-change-me" : undefined);
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
  return betterAuth({
    appName: "AgentTraces",
    baseURL: bindings.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL,
    secret,
    database: drizzleAdapter(getDb(), { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    socialProviders: githubClientId && githubClientSecret ? { github: { clientId: githubClientId, clientSecret: githubClientSecret } } : {},
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  });
}
