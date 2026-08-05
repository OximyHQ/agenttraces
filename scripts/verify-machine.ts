import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTracesStore, LocalCollector, ParserRegistry, SOURCE_NAMES } from "../packages/core/src/index.js";

const state = mkdtempSync(join(tmpdir(), "agenttraces-machine-verify-"));
const store = new AgentTracesStore(`${state}/verify.db`, state); const collector = new LocalCollector(store, homedir()); const registry = new ParserRegistry();
try {
  const detected = new Map(collector.detect().map((item) => [item.source, item.detected]));
  const sources = SOURCE_NAMES.map((source) => {
    if (!detected.get(source)) return { source, installed: false, capture: "not_installed", artifactsRead: 0, normalizedRecords: 0, diagnostics: 0 };
    const result = collector.scan({ sources: [source], fromBeginning: true, dryRun: true, maxEvents: 2, maxReadBytes: 2 * 1024 * 1024, maxEventBytes: 1024 * 1024, gitSnapshot: undefined })[0]!;
    let normalizedRecords = 0; let parserFailures = 0;
    for (const item of result.envelopes) {
      const parsed = registry.parse(item); if (parsed.success) normalizedRecords += parsed.records.length; else parserFailures++;
    }
    return { source, installed: true, capture: result.envelopes.length || result.files || result.databases ? "bounded_read_completed" : "detected_no_matching_artifacts", artifactsRead: result.envelopes.length, normalizedRecords, parserFailures, diagnostics: result.errors.length };
  });
  const report = { safeMode: { readOnlySourceData: true, dryRun: true, rawContentPrinted: false, maxEventsPerSource: 2, maxReadBytes: 2 * 1024 * 1024 }, parserInventory: registry.inventory(), sources };
  console.log(JSON.stringify(report, null, 2));
  if (sources.some((item) => "parserFailures" in item && item.parserFailures > 0)) process.exitCode = 1;
} finally { store.close(); rmSync(state, { recursive: true, force: true }); }
