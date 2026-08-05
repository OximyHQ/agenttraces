import type { NativeEnvelope, ParseResult, SourceName } from "../contracts.js";
import { AntigravityParser } from "./antigravity.js";
import type { LocalParser } from "./base.js";
import { ClaudeCodeParser } from "./claude-code.js";
import { CodexParser } from "./codex.js";
import { ConductorParser } from "./conductor.js";
import { CopilotParser } from "./copilot.js";
import { CursorParser } from "./cursor.js";
import { OpenClawParser } from "./openclaw.js";

export class ParserRegistry {
  private readonly parsers = new Map<SourceName, LocalParser>();

  constructor(parsers: LocalParser[] = [
    new ClaudeCodeParser(), new CursorParser(), new CodexParser(), new OpenClawParser(),
    new ConductorParser(), new AntigravityParser(), new CopilotParser(),
  ]) {
    for (const parser of parsers) this.parsers.set(parser.name, parser);
  }

  parse(envelope: NativeEnvelope): ParseResult {
    const parser = this.parsers.get(envelope.source);
    if (!parser) return { success: false, records: [], error: `No parser for ${envelope.source}` };
    if (!parser.supportedFileTypes.includes(envelope.file_type)) {
      return { success: false, records: [], error: `Unsupported ${envelope.source} file type: ${envelope.file_type}` };
    }
    return parser.parse(envelope);
  }

  inventory() {
    return [...this.parsers.values()].map((parser) => ({ source: parser.name, fileTypes: [...parser.supportedFileTypes] }));
  }
}

export * from "./base.js";
