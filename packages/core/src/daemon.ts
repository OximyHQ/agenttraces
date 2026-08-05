import { stableId } from "./parsers/base.js";
import type { ScanOptions } from "./collector.js";
import { LocalCollector } from "./collector.js";
import type { AgentTracesStore } from "./store.js";
import { setTimeout as delay } from "node:timers/promises";

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
    const payload = JSON.stringify({ batchId, envelopes });
    const signature = this.store.crypto.sign(Buffer.from(payload).toString("base64"));
    const installation = this.store.installation();
    await this.register(endpoint);
    const response = await fetch(`${endpoint}/v1/ingest`, { method: "POST", headers: { "content-type": "application/json", "x-agenttraces-signature": signature, "x-agenttraces-device-id": installation.deviceId }, body: payload });
    if (!response.ok) throw new Error(`Ingest failed: ${response.status} ${await response.text()}`);
    const receipt = await response.json();
    if (envelopes.length) this.collector.scan({ ...options, dryRun: false });
    return { results, receipt };
  }

  async register(endpoint: string) {
    const deviceId = this.store.installation().deviceId;
    const response = await fetch(`${endpoint}/v1/devices/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, publicKey: this.store.crypto.publicKeyPem, name: process.env.USER ?? "local-device" }),
    });
    if (!response.ok) throw new Error(`Device registration failed: ${response.status} ${await response.text()}`);
    return response.json();
  }

  async runLoop(options: ScanOptions & { endpoint?: string; intervalMs?: number; signal?: AbortSignal; onCycle?: (result: unknown) => void } = {}) {
    const { endpoint, intervalMs = 5_000, signal, onCycle, ...scan } = options;
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

  stop() { this.stopped = true; }
}
