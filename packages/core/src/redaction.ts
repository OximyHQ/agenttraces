const BUILT_INS = [
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, preservePrefix: false },
  { pattern: /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g, preservePrefix: false },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, preservePrefix: false },
  { pattern: /((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["'])[^"'\s]+/gi, preservePrefix: true },
];

export function scrubText(value: string, patterns: RegExp[] = []) {
  let result = value;
  for (const item of BUILT_INS) result = result.replace(item.pattern, (_match, prefix) => item.preservePrefix ? `${prefix}[REDACTED]` : "[REDACTED]");
  for (const pattern of patterns) result = result.replace(pattern, "[REDACTED]");
  return result;
}

export function scrubRecord(value: Record<string, unknown>, patterns: RegExp[] = []) {
  return JSON.parse(scrubText(JSON.stringify(value), patterns)) as Record<string, unknown>;
}
