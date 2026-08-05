import type { NativeEnvelope } from "../contracts.js";
import { event, failure, metadataFallback, object, success, text, type LocalParser } from "./base.js";

export class OpenClawParser implements LocalParser {
  readonly name = "openclaw" as const;
  readonly supportedFileTypes = ["session_transcript", "session_index", "cron_run", "memory"];

  parse(envelope: NativeEnvelope) {
    try {
      if (envelope.file_type === "memory") return metadataFallback(envelope, text(envelope.raw.text));
      const raw = envelope.raw;
      const type = text(raw.type);
      if (type === "message" || raw.role || raw.message) {
        const message = object(raw.message ?? raw);
        const role = text(message.role) ?? "assistant";
        return success([event(envelope, 0, role === "user" ? "user" : role === "system" ? "system" : "assistant", {
          role, content: text(message.content ?? message.text), model: text(message.model ?? raw.model), metadata: raw,
        })]);
      }
      if (["compaction", "session", "model_change", "thinking_level_change"].includes(type ?? "")) {
        return success([event(envelope, 0, "lifecycle", { content: text(raw.summary ?? raw.type), model: text(raw.model), metadata: raw })]);
      }
      return metadataFallback(envelope, text(raw.content ?? raw.summary));
    } catch (error) { return failure(error); }
  }
}
