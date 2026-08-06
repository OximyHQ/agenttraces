import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerPromise = import(new URL("../dist/server/index.js", import.meta.url).href).then(({ default: worker }) => worker);

async function render(path = "/") {
  const worker = await workerPromise;

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the compact AgentTraces landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AgentTraces — Memory for coding agents<\/title>/i);
  assert.match(html, /Give your agent the work that came before\./);
  assert.match(html, /Ask for the work you remember/);
  assert.match(html, /From native session to useful record/);
  assert.match(html, /One record across the agents you use/);
  assert.match(html, /Ask your agent/);
  assert.match(html, /Install AgentTraces for this machine/);
  assert.doesNotMatch(html, /Acme|System Atlas|codex-preview|react-loading-skeleton/i);
});

test("server-renders docs, dashboard, trace, pull-request, team, join, auth, and public-share surfaces", async () => {
  const expectations = [
    ["/docs", /Use AgentTraces from the terminal/],
    ["/docs/teams", /Teams and devices/],
    ["/docs/sources", /Supported agents/],
    ["/dashboard", /Recent agent work/],
    ["/dashboard/traces/tr_01K2X9W4C7Q2", /Work stages/],
    ["/dashboard/pull-requests", /Pull requests and their agent work/],
    ["/dashboard/pull-requests/7", /Agent work behind this pull request/],
    ["/dashboard/team", /Team and devices/],
    ["/join/test-token", /Connect this machine to the team/],
    ["/sign-in", /Claim your traces and continue/],
    ["/t/test-token", /Immutable snapshot/],
    ["/t/connect-trace-search/test-token", /Immutable snapshot/],
  ];
  for (const [path, expected] of expectations) {
    const response = await render(path); assert.equal(response.status, 200, path); assert.match(await response.text(), expected, path);
  }
});

test("keeps the surface small, responsive, accessible, and documented", async () => {
  const [page, installPanel, tabs, css, layout, packageJson, product, design, auth] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/install-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/tabs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../PRODUCT.md", import.meta.url), "utf8"),
    readFile(new URL("../../../DESIGN.md", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
  ]);

  assert.match(installPanel, /role="tablist"/);
  assert.match(installPanel, /aria-selected=/);
  assert.match(installPanel, /aria-controls=/);
  assert.match(installPanel, /tabIndex=/);
  assert.match(installPanel, /onKeyDown=/);
  assert.match(tabs, /ArrowRight/);
  assert.match(page, /THESIS: AgentTraces is a quiet memory layer/);
  assert.match(page, /Team owners choose the team default/);
  assert.match(css, /--frame:\s*848px/);
  assert.match(css, /font-size:\s*14px/);
  assert.match(css, /@media \(max-width:\s*620px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(layout, /@fontsource-variable\/inter/);
  assert.match(packageJson, /@fontsource-variable\/inter/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(packageJson, /better-auth/);
  assert.match(auth, /new Pool/);
  assert.match(auth, /DATABASE_URL/);
  assert.match(product, /<!-- impeccable:product-schema 1 -->/);
  assert.match(product, /The product name is AgentTraces, plural/);
  assert.match(design, /The Quiet Trace Manual/);
});
