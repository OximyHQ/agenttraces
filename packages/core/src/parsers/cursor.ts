import type { NativeEnvelope, NormalizedEvent } from "../contracts.js";
import { array, event, failure, metadataFallback, numberValue, object, parseJsonString, success, text, type LocalParser } from "./base.js";

export class CursorParser implements LocalParser {
  readonly name = "cursor" as const;
  readonly supportedFileTypes = ["agent_transcript", "sqlite_composer", "sqlite_bubble", "sqlite_code_tracking", "sqlite_daily_stats"];

  parse(envelope: NativeEnvelope) {
    try {
      const parsed = parseJsonString(envelope.raw.value);
      const decoded = Array.isArray(parsed) ? { messages: parsed } : object(parsed ?? envelope.raw);
      if (envelope.file_type === "sqlite_code_tracking" || envelope.file_type === "sqlite_daily_stats") {
        return success([event(envelope, 0, envelope.file_type === "sqlite_daily_stats" ? "usage" : "file", {
          content: text(decoded.filePath ?? decoded.path), inputTokens: numberValue(decoded.inputTokens),
          outputTokens: numberValue(decoded.outputTokens), metadata: { ...envelope.raw, decoded },
        })]);
      }
      const messages = array(decoded.messages ?? decoded.conversation ?? decoded.bubbles ?? decoded);
      const records: NormalizedEvent[] = [];
      for (const [index, value] of messages.entries()) {
        const item = object(parseJsonString(value));
        const role = text(item.role) ?? (numberValue(item.type) === 1 ? "user" : "assistant");
        const toolName = text(item.toolName ?? item.tool_name);
        records.push(event(envelope, index, toolName ? "tool_call" : role === "user" ? "user" : "assistant", {
          role, content: text(item.text ?? item.content ?? item.message), toolName,
          toolCallId: text(item.toolCallId ?? item.id), model: text(item.model), metadata: item,
        }));
      }
      return records.length ? success(records) : metadataFallback(envelope, text(decoded.name ?? decoded.title));
    } catch (error) { return failure(error); }
  }
}
