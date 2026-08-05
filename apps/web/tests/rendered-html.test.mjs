import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
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

test("server-renders the AgentTraces system atlas", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AgentTraces — System Atlas<\/title>/i);
  assert.match(html, /Give every agent the work that came before\./);
  assert.match(html, /One system, four critical paths/);
  assert.match(html, /All system components/);
  assert.match(html, /Every product surface/);
  assert.match(html, /The dashboard is an evidence browser/);
  assert.match(html, /How the repository holds together/);
  assert.match(html, /Illustrative interface · synthetic trace data/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps the atlas product-specific, responsive, and documented", async () => {
  const [page, css, layout, packageJson, product, design] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../PRODUCT.md", import.meta.url), "utf8"),
    readFile(new URL("../../../DESIGN.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const architectureLayers/);
  assert.match(page, /const surfaceGroups/);
  assert.match(page, /const repoEntries/);
  assert.match(page, /prepare.*confirm|confirmation-gated/is);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(layout, /AgentTraces — System Atlas/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(product, /<!-- impeccable:product-schema 1 -->/);
  assert.match(product, /The product name is AgentTraces, plural/);
  assert.match(design, /The Running Systems Manual/);
});
