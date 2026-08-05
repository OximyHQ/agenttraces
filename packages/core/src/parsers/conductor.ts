import type { NativeEnvelope } from "../contracts.js";
import { event, failure, object, parseJsonString, success, text, type LocalParser } from "./base.js";

export class ConductorParser implements LocalParser {
  readonly name = "conductor" as const;
  readonly supportedFileTypes = ["sqlite_conductor_sessions", "sqlite_conductor_messages"];

  parse(envelope: NativeEnvelope) {
    try {
      const raw = envelope.raw;
      if (envelope.file_type === "sqlite_conductor_sessions") {
        return success([event(envelope, 0, "metadata", {
          content: text(raw.title), model: text(raw.model), metadata: raw,
        })]);
      }
      const decoded = parseJsonString(raw.content);
      const contentObject = object(decoded);
      const role = text(raw.role) ?? "assistant";
      const content = text(decoded) ?? text(contentObject.content ?? contentObject.text);
      return success([event(envelope, 0, role === "user" ? "user" : role === "system" ? "system" : "assistant", {
        role, content, model: text(raw.model), metadata: { ...raw, content: decoded },
      })]);
    } catch (error) { return failure(error); }
  }
}
