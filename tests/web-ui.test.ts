import assert from "node:assert/strict";
import test from "node:test";
import { mapEvent } from "../apps/web/lib/agenttraces-api.js";
import { tabKeyIndex } from "../apps/web/lib/tabs.js";

test("maps API-shaped semantic events without losing their kind or label", () => {
  const events = [
    { id: "reason", kind: "reasoning", timestamp: "2026-08-06T10:00:00Z", content: "Considering the index." },
    { id: "usage", kind: "usage", timestamp: "2026-08-06T10:01:00Z", input: { inputTokens: 42 } },
    { id: "life", kind: "lifecycle", timestamp: "2026-08-06T10:02:00Z", operation_status: "succeeded" },
    { id: "error", kind: "error", timestamp: "2026-08-06T10:03:00Z", content: "Command failed." },
    { id: "unknown", kind: "new_native_kind", timestamp: "2026-08-06T10:04:00Z" },
  ].map(mapEvent);
  assert.deepEqual(events.map((event) => event.kind), ["reasoning", "usage", "lifecycle", "error", "metadata"]);
  assert.deepEqual(events.map((event) => event.label), ["Reasoning", "Usage", "Lifecycle", "Error", "Metadata"]);
  assert.match(events[1]!.detail ?? "", /inputTokens/);
  assert.equal(events[2]!.status, "succeeded");
});

test("tab keyboard navigation wraps and supports Home and End", () => {
  assert.equal(tabKeyIndex(0, 3, "ArrowRight"), 1);
  assert.equal(tabKeyIndex(2, 3, "ArrowRight"), 0);
  assert.equal(tabKeyIndex(0, 3, "ArrowLeft"), 2);
  assert.equal(tabKeyIndex(1, 3, "Home"), 0);
  assert.equal(tabKeyIndex(1, 3, "End"), 2);
  assert.equal(tabKeyIndex(1, 3, "Enter"), null);
});
