import assert from "node:assert/strict";
import test from "node:test";
import { AgentTracesStore, type Actor } from "../packages/core/src/index.js";
import { envelope, temporary } from "./helpers.js";

function localEnvelope(store: AgentTracesStore, session = "s1", content = "cache sentinel") {
  return envelope("claude_code", "session_transcript", { type: "user", message: { role: "user", content }, session_id: session }, { device_id: store.installation().deviceId, session_id: session, event_id: `native_${session}_${content.replaceAll(" ", "_")}` });
}

test("anonymous identity can be claimed without changing device, principal, namespace, or traces", () => {
  const temp = temporary();
  try {
    const store = new AgentTracesStore(`${temp.path}/db.sqlite`, temp.path); const before = store.installation();
    store.enqueue("batch_claim", [localEnvelope(store)]); store.processPending(); const traceId = store.listTraces()[0]!.id;
    const claim = store.claim("developer@example.com", "Developer"); const after = store.installation();
    assert.equal(claim.signatureVerified, true); assert.deepEqual({ ...after, claimed: false }, { ...before, claimed: false }); assert.equal(after.claimed, true); assert.equal(store.getTrace(traceId).id, traceId);
    store.close();
  } finally { temp.cleanup(); }
});

test("encrypted durable spool is idempotent and parser replay produces searchable rollups", () => {
  const temp = temporary();
  try {
    const store = new AgentTracesStore(`${temp.path}/db.sqlite`, temp.path); const event = localEnvelope(store, "search", "unique cache sentinel");
    const first = store.enqueue("batch_1", [event]); const duplicateBatch = store.enqueue("batch_1", [event]); const duplicateEvent = store.enqueue("batch_2", [event]);
    assert.deepEqual([first.accepted, duplicateBatch.duplicates, duplicateEvent.duplicates], [1, 1, 1]);
    const encrypted = store.db.prepare("SELECT cipher FROM spool WHERE event_id=?").get(event.event_id) as { cipher: Buffer };
    assert.doesNotMatch(encrypted.cipher.toString("utf8"), /unique cache sentinel/);
    assert.deepEqual(store.processPending(), { processed: 1, failed: 0, produced: 1, remaining: 0 });
    assert.equal(store.search({ query: "cache sentinel" })[0]?.sessionId, "search"); assert.equal(store.usage().sessions, 1);
    assert.deepEqual(store.processPending(), { processed: 0, failed: 0, produced: 0, remaining: 0 });
    store.close();
  } finally { temp.cleanup(); }
});

test("personal, team, public, and capability-link authorization do not leak metadata", () => {
  const temp = temporary();
  try {
    const store = new AgentTracesStore(`${temp.path}/db.sqlite`, temp.path); store.enqueue("private", [localEnvelope(store, "private")]); store.processPending();
    const privateTrace = store.listTraces()[0]!; const stranger: Actor = { principalId: "stranger", teamIds: [] };
    assert.throws(() => store.getTrace(privateTrace.id, stranger), /not found or inaccessible/); assert.equal(store.search({ query: "cache" }, stranger).length, 0);
    store.setTraceVisibility(privateTrace.id, "public"); assert.equal(store.getTrace(privateTrace.id, stranger).id, privateTrace.id);
    store.setTraceVisibility(privateTrace.id, "private");
    const share = store.createShare({ traceId: privateTrace.id, content: "summary", audience: "anyone_with_link", agentRetrieve: true, allowContext: false, allowSkillCreation: false, maxViews: 1 });
    const shareActor = store.actorForShare(share.token); assert.equal(store.getTrace(privateTrace.id, shareActor, "summary").id, privateTrace.id);
    assert.throws(() => store.getTrace(privateTrace.id, shareActor, "full_transcript"), /does not grant/); assert.throws(() => store.actorForShare(share.token), /view limit/);
    const team = store.createTeam("platform-team"); store.setTeamPolicy(team.id, "team"); store.useNamespace(team.id);
    store.enqueue("team", [localEnvelope(store, "team")]); store.processPending(); const teamTrace = store.listTraces().find((trace) => trace.sessionId === "team")!;
    const teammate: Actor = { principalId: "teammate", teamIds: [team.id], role: "member" }; assert.equal(store.getTrace(teamTrace.id, teammate).id, teamTrace.id);
    store.setTeamPolicy(team.id, "private"); store.enqueue("team-private", [localEnvelope(store, "team-private")]); store.processPending(); const teamPrivate = store.listTraces().find((trace) => trace.sessionId === "team-private")!;
    assert.throws(() => store.getTrace(teamPrivate.id, teammate), /not found or inaccessible/);
    store.close();
  } finally { temp.cleanup(); }
});

test("single-use confirmation previews protect share and skill mutations", () => {
  const temp = temporary();
  try {
    const store = new AgentTracesStore(`${temp.path}/db.sqlite`, temp.path); store.enqueue("batch", [localEnvelope(store)]); store.processPending(); const traceId = store.listTraces()[0]!.id;
    const spec = { traceId, content: "summary" as const, audience: "anyone_with_link" as const, agentRetrieve: true, allowContext: false, allowSkillCreation: false };
    const preview = store.prepareMutation("share.create", spec); const consumed = store.consumeMutation<typeof spec>(preview.confirmationToken, "share.create"); const share = store.createShare(consumed);
    assert.equal(share.traceId, traceId); assert.throws(() => store.consumeMutation(preview.confirmationToken, "share.create"), /already been used/);
    const skillInput = { name: "cache-fix", description: "Reuse cache fix", instructions: ["Inspect cache key"], traceIds: [traceId] };
    const skillPreview = store.prepareMutation("skill.create", skillInput); const skill = store.createSkill(store.consumeMutation<typeof skillInput>(skillPreview.confirmationToken, "skill.create"));
    assert.equal(skill.name, "cache-fix"); assert.deepEqual(skill.sourceTraceIds, [traceId]);
    store.close();
  } finally { temp.cleanup(); }
});

test("team setup links are constrained, auditable, and register member devices", () => {
  const temp = temporary();
  try {
    const store = new AgentTracesStore(`${temp.path}/db.sqlite`, temp.path);
    store.claim("owner@example.com", "Owner");
    const team = store.createTeam("example-team");
    const link = store.createSetupLink(team.id, { domain: "example.com", maxUses: 1 });
    assert.equal(store.listSetupLinks(team.id)[0]?.uses, 0);
    assert.throws(() => store.redeemSetupLink(link.token, "outsider@elsewhere.com"), /approved email domain/);
    assert.equal(store.redeemSetupLink(link.token, "member@example.com").teamId, team.id);
    assert.throws(() => store.redeemSetupLink(link.token, "member@example.com"), /usage limit/);
    assert.equal(store.listSetupLinks(team.id)[0]?.uses, 1);
    assert.equal(store.listTeamDevices(team.id).length, 1);
    store.close();
  } finally { temp.cleanup(); }
});

test("pull requests link many traces and roll up usage with explicit provenance", () => {
  const temp = temporary();
  try {
    const store = new AgentTracesStore(`${temp.path}/db.sqlite`, temp.path);
    store.enqueue("pr-one", [localEnvelope(store, "pr-one", "implement the search index")]);
    store.enqueue("pr-two", [localEnvelope(store, "pr-two", "verify the search index")]);
    store.processPending();
    const repository = "https://github.com/OximyHQ/agenttraces";
    for (const trace of store.listTraces()) {
      store.linkTraceToPullRequest(trace.id, { repository, number: 42, title: "Index prior work", state: "open", evidence: "manual", confirmed: true });
    }
    const result = store.getPullRequestTrace(repository, 42);
    assert.equal(result.pullRequest?.number, 42);
    assert.equal(result.traces.length, 2);
    assert.equal(result.traces[0]?.pullRequests?.[0]?.evidence, "manual");
    assert.equal(result.traces[0]?.pullRequests?.[0]?.confirmed, true);
    store.close();
  } finally { temp.cleanup(); }
});

test("lazy enrichment is cached and public shares stay immutable by default", () => {
  const temp = temporary();
  try {
    const store = new AgentTracesStore(`${temp.path}/db.sqlite`, temp.path);
    store.enqueue("summary-one", [localEnvelope(store, "summary", "build the immutable share")]);
    store.processPending();
    const traceId = store.listTraces()[0]!.id;
    const request = store.prepareTraceEnrichment(traceId);
    assert.equal(request.promptVersion, "trace-summary-v1");
    assert.equal(store.getTraceEnrichment(traceId), null);
    const enrichment = store.cacheTraceEnrichment({
      traceId,
      title: "Build immutable trace shares",
      summary: "Implemented a point-in-time trace share.",
      stages: [{ kind: "build", text: "Created the share snapshot." }],
      outcome: "completed",
      provider: "local_subscription",
      model: "user-subscription",
      promptVersion: request.promptVersion,
    });
    assert.equal(enrichment?.provider, "local_subscription");
    const share = store.createShare({ traceId, content: "conversation", audience: "anyone_with_link", agentRetrieve: true, allowContext: false, allowSkillCreation: false });
    assert.match(share.url, /^\/t\/build-immutable-trace-shares\/[A-Za-z0-9_-]{24}$/);
    const shareSegment = share.url.slice(3);
    const sharedBefore = store.getTrace(traceId, store.actorForShare(shareSegment), "full_transcript") as { events: unknown[]; snapshot: boolean };
    store.enqueue("summary-two", [localEnvelope(store, "summary", "this arrived after the share")]);
    store.processPending();
    const sharedAfter = store.getTrace(traceId, store.actorForShare(share.token), "full_transcript") as { events: unknown[]; snapshot: boolean };
    assert.equal(sharedBefore.snapshot, true);
    assert.equal(sharedAfter.events.length, sharedBefore.events.length);
    assert.equal((store.getTrace(traceId, store.actor(), "full_transcript") as { events: unknown[] }).events.length, sharedBefore.events.length + 1);
    store.close();
  } finally { temp.cleanup(); }
});
