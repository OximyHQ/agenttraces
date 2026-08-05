import type { NativeEnvelope, NormalizedEvent } from "../contracts.js";
import { array, event, failure, metadataFallback, numberValue, object, parseJsonString, success, text, type LocalParser } from "./base.js";

export class CopilotParser implements LocalParser {
  readonly name = "copilot" as const;
  readonly supportedFileTypes = [
    "copilot_session_events", "copilot_session_snapshot", "copilot_workspace_session_events",
    "copilot_compact_transcript", "copilot_debug_log", "copilot_session_index",
    "copilot_workspace_folder", "copilot_workspace_agent_cache",
  ];

  parse(envelope: NativeEnvelope) {
    try {
      const raw = object(parseJsonString(envelope.raw.value) ?? envelope.raw);
      if (["copilot_session_index", "copilot_workspace_folder", "copilot_workspace_agent_cache", "copilot_debug_log"].includes(envelope.file_type)) {
        return metadataFallback({ ...envelope, raw }, text(raw.folder ?? raw.key ?? raw.type));
      }
      if (envelope.file_type === "copilot_compact_transcript") return this.parseCompact(envelope, raw);
      const kind = numberValue(raw.kind);
      const session = kind === 0 ? object(raw.v) : raw;
      const requests = kind === 2 && Array.isArray(raw.k) && raw.k.join(".") === "requests"
        ? array(raw.v)
        : array(session.requests ?? session.messages ?? raw.requests);
      const records: NormalizedEvent[] = [];
      for (const [index, value] of requests.entries()) {
        const request = object(value);
        const prompt = text(request.message ?? request.prompt);
        if (prompt) records.push(event(envelope, index * 2, "user", { role: "user", content: prompt, metadata: request }));
        const response = text(request.response ?? request.answer);
        if (response) records.push(event(envelope, index * 2 + 1, "assistant", {
          role: "assistant", content: response, model: text(request.model),
          outputTokens: numberValue(request.completionTokens), metadata: request,
        }));
      }
      return records.length ? success(records) : metadataFallback(envelope, text(session.title));
    } catch (error) { return failure(error); }
  }

  private parseCompact(envelope: NativeEnvelope, raw: Record<string, unknown>) {
    const type = text(raw.type);
    const records: NormalizedEvent[] = [];
    if (type === "session.start") records.push(event(envelope, 0, "lifecycle", { content: "session.start", metadata: raw }));
    else if (type === "assistant.message") {
      records.push(event(envelope, 0, "assistant", { role: "assistant", content: text(raw.content), metadata: raw }));
      const reasoning = text(raw.reasoningText);
      if (reasoning) records.push(event(envelope, 1, "reasoning", { content: reasoning, metadata: raw }));
      for (const [index, value] of array(raw.toolRequests).entries()) {
        const tool = object(value);
        records.push(event(envelope, index + 2, "tool_call", { toolName: text(tool.toolName ?? tool.name), toolCallId: text(tool.toolCallId ?? tool.id), content: text(tool.arguments), metadata: tool }));
      }
    } else if (type === "tool.execution_start") records.push(event(envelope, 0, "tool_call", { toolName: text(raw.toolName), toolCallId: text(raw.toolCallId), content: text(raw.arguments), metadata: raw }));
    else if (type === "tool.execution_complete") records.push(event(envelope, 0, "tool_result", { toolCallId: text(raw.toolCallId), content: text(raw.output ?? raw.success), metadata: raw }));
    return records.length ? success(records) : metadataFallback(envelope, type);
  }
}
