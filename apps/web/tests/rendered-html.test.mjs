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

test("server-renders the compact AgentTraces landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AgentTraces — Memory for coding agents<\/title>/i);
  assert.match(html, /Give your agent the work that came before\./);
  assert.match(html, /Find past work in one sentence/);
  assert.match(html, /A trace is evidence, not another chat transcript/);
  assert.match(html, /Capture once, retrieve wherever you work/);
  assert.match(html, /Seven local collectors, one trace model/);
  assert.match(html, /collector coverage, not a promise of full product support/);
  assert.match(html, /Illustrative interface · synthetic trace data/);
  assert.doesNotMatch(html, /Acme|System Atlas|codex-preview|react-loading-skeleton/i);
});

test("keeps the surface small, responsive, accessible, and documented", async () => {
  const [page, css, layout, packageJson, product, design] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../PRODUCT.md", import.meta.url), "utf8"),
    readFile(new URL("../../../DESIGN.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /role="tablist"/);
  assert.match(page, /aria-selected=/);
  assert.match(page, /THESIS: AgentTraces is a quiet memory layer/);
  assert.match(page, /Personal traces are private by default/);
  assert.match(css, /--frame: 848px/);
  assert.match(css, /font-size: 14px/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(layout, /@fontsource-variable\/inter/);
  assert.match(packageJson, /@fontsource-variable\/inter/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(product, /<!-- impeccable:product-schema 1 -->/);
  assert.match(product, /The product name is AgentTraces, plural/);
  assert.match(design, /The Quiet Trace Manual/);
});
