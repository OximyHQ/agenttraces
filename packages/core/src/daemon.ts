import { stableId } from "./parsers/base.js";
import type { ScanOptions } from "./collector.js";
import { LocalCollector } from "./collector.js";
import type { AgentTracesStore } from "./store.js";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { dirname } from "node:path";

export class AgentTracesDaemon {
  readonly collector: LocalCollector;
  private stopped = false;

  constructor(readonly store: AgentTracesStore, userHome: string) {
    this.collector = new LocalCollector(store, userHome);
  }

  runOnce(options: ScanOptions = {}) {
    if (this.stopped) throw new Error("Daemon is stopped");
    const results = this.collector.scan(options);
    const envelopes = results.flatMap((result) => result.envelopes);
    const receipt = envelopes.length
      ? this.store.enqueue(`batch_${stableId(envelopes[0]?.event_id, envelopes.at(-1)?.event_id, envelopes.length)}`, envelopes)
      : null;
    const worker = this.store.processPending();
    return { detection: this.collector.detect(), results, receipt, worker };
  }

  async upload(endpoint: string, options: ScanOptions = {}) {
    if (this.stopped) throw new Error("Daemon is stopped");
    const results = this.collector.scan({ ...options, dryRun: true });
    const envelopes = results.flatMap((result) => result.envelopes);
    const batchId = `batch_${stableId(envelopes[0]?.event_id, envelopes.at(-1)?.event_id, envelopes.length)}`;
    const payload = Buffer.from(JSON.stringify({ batchId, envelopes }));
    const signature = this.store.crypto.sign(payload.toString("base64"));
    const installation = this.store.installation();
    await this.register(endpoint);
    if (!envelopes.length) return { results, receipt: null };
    const namespaceId = this.store.setting("cloud.active_namespace_id") || this.store.setting("cloud.namespace_id");
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip", "x-agenttraces-signature": signature, "x-agenttraces-device-id": installation.deviceId, ...(namespaceId ? { "x-agenttraces-namespace-id": namespaceId } : {}) }, body: gzipSync(payload) });
    if (!response.ok) throw new Error(`Ingest failed: ${response.status} ${await response.text()}`);
    const receipt = await response.json();
    if (envelopes.length) this.collector.scan({ ...options, dryRun: false });
    return { results, receipt };
  }

  async register(endpoint: string) {
    const deviceId = this.store.installation().deviceId;
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/devices/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, publicKey: this.store.crypto.publicKeyPem, name: process.env.USER ?? "local-device" }),
    });
    if (!response.ok) throw new Error(`Device registration failed: ${response.status} ${await response.text()}`);
    const registration = await response.json() as { accessToken?: string; namespaceId?: string };
    if (registration.accessToken) this.store.setSetting("cloud.access_token", registration.accessToken);
    if (registration.namespaceId) this.store.setSetting("cloud.namespace_id", registration.namespaceId);
    return registration;
  }

  async backfill(endpoint: string, options: ScanOptions & { maxPages?: number } = {}) {
    const pages: unknown[] = []; const maxPages = Math.min(options.maxPages ?? 10_000, 10_000);
    for (let page = 0; page < maxPages; page++) {
      const result = await this.upload(endpoint, { ...options, fromBeginning: page === 0 });
      pages.push(result); const accepted = Number((result.receipt as { accepted?: number } | null)?.accepted ?? 0);
      if (!accepted) return { complete: true, pages: pages.length };
    }
    return { complete: false, pages: pages.length, reason: "page_limit" };
  }

  async runLoop(options: ScanOptions & { endpoint?: string; intervalMs?: number; signal?: AbortSignal; onCycle?: (result: unknown) => void } = {}) {
    const { endpoint, intervalMs = 300_000, signal, onCycle, ...scan } = options;
    const cycles: unknown[] = [];
    while (!this.stopped && !signal?.aborted) {
      try {
        const result = endpoint ? await this.upload(endpoint, scan) : this.runOnce(scan);
        cycles.push(result); onCycle?.(result);
      } catch (error) {
        const result = { error: error instanceof Error ? error.message : String(error), retrying: true };
        cycles.push(result); onCycle?.(result);
      }
      if (!this.stopped && !signal?.aborted) {
        try { await delay(intervalMs, undefined, { signal }); } catch { break; }
      }
    }
    return { stopped: true, cycles: cycles.length };
  }

  async runWatching(options: ScanOptions & { endpoint?: string; reconcileMs?: number; debounceMs?: number; signal?: AbortSignal; onCycle?: (result: unknown) => void } = {}) {
    const { endpoint, reconcileMs = 300_000, debounceMs = 750, signal, onCycle, ...scan } = options;
    const changed = new Set<string>(); const watchers: FSWatcher[] = []; let timer: NodeJS.Timeout | undefined;
    const flush = async () => {
      timer = undefined; if (!changed.size || signal?.aborted || this.stopped) return;
      const paths = [...changed]; changed.clear();
      try { const result = endpoint ? await this.upload(endpoint, { ...scan, changedPaths: paths }) : this.runOnce({ ...scan, changedPaths: paths }); onCycle?.(result); }
      catch (error) { onCycle?.({ error: error instanceof Error ? error.message : String(error), retrying: true }); }
    };
    const schedule = (path: string) => { changed.add(path); if (timer) clearTimeout(timer); timer = setTimeout(() => void flush(), debounceMs); };
    for (const detection of this.collector.detect()) for (const configured of detection.paths) {
      const target = existsSync(configured) ? configured : dirname(configured); if (!existsSync(target)) continue;
      try {
        const recursive = statSync(target).isDirectory() && (process.platform === "darwin" || process.platform === "win32");
        watchers.push(watch(target, { recursive }, (_event, filename) => schedule(filename ? `${target}/${filename}` : target)));
      } catch (error) { onCycle?.({ warning: `watch_failed:${target}`, error: error instanceof Error ? error.message : String(error) }); }
    }
    const reconcile = setInterval(() => { void (endpoint ? this.upload(endpoint, scan) : Promise.resolve(this.runOnce(scan))).then(onCycle).catch((error) => onCycle?.({ error: error instanceof Error ? error.message : String(error), retrying: true })); }, reconcileMs);
    await new Promise<void>((resolve) => { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", () => resolve(), { once: true }); });
    if (timer) clearTimeout(timer); clearInterval(reconcile); for (const watcher of watchers) watcher.close();
    return { stopped: true, watchers: watchers.length };
  }

  stop() { this.stopped = true; }
}
