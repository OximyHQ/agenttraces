import type { NativeEnvelope, NormalizedEvent } from "../contracts.js";
import { array, event, failure, metadataFallback, object, success, text, type LocalParser } from "./base.js";

export class ClaudeCodeParser implements LocalParser {
  readonly name = "claude_code" as const;
  readonly supportedFileTypes = ["session_transcript", "subagent_transcript", "session_index", "prompt_history", "stats"];

  parse(envelope: NativeEnvelope) {
    try {
      const raw = envelope.raw;
      const type = text(raw.type) ?? (envelope.file_type === "prompt_history" ? "user" : undefined);
      if (!type) return metadataFallback(envelope);
      if (["queue-operation", "file-history-snapshot"].includes(type)) {
        return success([event(envelope, 0, "lifecycle", { content: text(raw.operation ?? raw.type), metadata: raw })]);
      }
      if (type === "system") return success([event(envelope, 0, "system", { role: "system", content: text(raw.message ?? raw.content), metadata: raw })]);
      if (type !== "user" && type !== "assistant") return metadataFallback(envelope, text(raw.content));

      const message = object(raw.message);
      const role = text(message.role) ?? type;
      const blocks = array(message.content ?? raw.content ?? raw.prompt);
      const records: NormalizedEvent[] = [];
      for (const [index, blockValue] of blocks.entries()) {
        const block = object(blockValue);
        const blockType = text(block.type);
        if (blockType === "tool_use") {
          records.push(event(envelope, index, "tool_call", {
            role, toolName: text(block.name), toolCallId: text(block.id),
            content: text(block.input) ?? JSON.stringify(block.input ?? {}), metadata: block,
          }));
        } else if (blockType === "tool_result") {
          records.push(event(envelope, index, "tool_result", {
            role, toolCallId: text(block.tool_use_id), content: text(block.content), metadata: block,
          }));
        } else if (blockType === "thinking") {
          records.push(event(envelope, index, "reasoning", { role, content: text(block.thinking ?? block.text), metadata: block }));
        } else {
          const content = text(blockValue);
          if (content) records.push(event(envelope, index, type, { role, content, model: text(message.model ?? raw.model), metadata: block }));
        }
      }
      if (!records.length) records.push(event(envelope, 0, type, { role, content: text(message.content ?? raw.content), metadata: raw }));
      return success(records);
    } catch (error) { return failure(error); }
  }
}
