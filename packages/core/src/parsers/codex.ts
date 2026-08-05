import type { NativeEnvelope, NormalizedEvent } from "../contracts.js";
import { event, failure, metadataFallback, numberValue, object, success, text, type LocalParser } from "./base.js";

export class CodexParser implements LocalParser {
  readonly name = "codex" as const;
  readonly supportedFileTypes = ["session_transcript", "prompt_history", "config"];

  parse(envelope: NativeEnvelope) {
    try {
      if (envelope.file_type === "config") return metadataFallback(envelope, text(envelope.raw.text));
      const raw = envelope.raw;
      const outerType = text(raw.type);
      const payload = object(raw.payload ?? raw);
      if (outerType === "session_meta") {
        return success([event(envelope, 0, "metadata", {
          repository: text(payload.cwd ?? payload.repository), branch: text(payload.branch), model: text(payload.model), metadata: payload,
        })]);
      }
      if (outerType === "turn_context") return success([event(envelope, 0, "lifecycle", { content: text(payload.cwd), metadata: payload })]);
      if (outerType === "event_msg") {
        const type = text(payload.type);
        const usage = object(payload.usage ?? payload.token_usage);
        if (type?.includes("usage") || Object.keys(usage).length) {
          return success([event(envelope, 0, "usage", {
            inputTokens: numberValue(usage.input_tokens ?? usage.input),
            outputTokens: numberValue(usage.output_tokens ?? usage.output), metadata: payload,
          })]);
        }
        return success([event(envelope, 0, "lifecycle", { content: text(payload.message ?? payload.type), metadata: payload })]);
      }
      const item = outerType === "response_item" ? object(payload) : payload;
      const itemType = text(item.type) ?? (envelope.file_type === "prompt_history" ? "message" : undefined);
      const records: NormalizedEvent[] = [];
      switch (itemType) {
        case "message":
          records.push(event(envelope, 0, text(item.role) === "user" ? "user" : "assistant", {
            role: text(item.role), content: text(item.content ?? item.text), model: text(item.model), metadata: item,
          }));
          break;
        case "reasoning":
          records.push(event(envelope, 0, "reasoning", { content: text(item.summary ?? item.content), metadata: item }));
          break;
        case "function_call":
          records.push(event(envelope, 0, "tool_call", {
            toolName: text(item.name), toolCallId: text(item.call_id), content: text(item.arguments), metadata: item,
          }));
          break;
        case "function_call_output":
          records.push(event(envelope, 0, "tool_result", {
            toolCallId: text(item.call_id), content: text(item.output), metadata: item,
          }));
          break;
        default:
          return metadataFallback(envelope, text(item.content ?? item.text));
      }
      return success(records);
    } catch (error) { return failure(error); }
  }
}
