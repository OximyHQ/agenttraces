import type { NativeEnvelope } from "../contracts.js";
import { event, failure, metadataFallback, success, text, type LocalParser } from "./base.js";

export class AntigravityParser implements LocalParser {
  readonly name = "antigravity" as const;
  readonly supportedFileTypes = ["conversation", "brain_artifact", "brain_metadata", "annotation"];

  parse(envelope: NativeEnvelope) {
    try {
      if (envelope.file_type === "conversation") return success([event(envelope, 0, "metadata", { content: "Encrypted Antigravity conversation artifact", metadata: { encrypted: true } })]);
      return metadataFallback(envelope, text(envelope.raw.content ?? envelope.raw.text ?? envelope.raw.summary));
    } catch (error) { return failure(error); }
  }
}
