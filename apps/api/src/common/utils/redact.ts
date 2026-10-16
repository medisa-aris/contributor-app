const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|api_?key|authorization|cookie|csrf|hash|credential/i;

const REDACTED = '[REDACTED]';

/** Deep-clones a value while masking values whose keys look sensitive. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(entry, depth + 1);
    }
    return result;
  }
  return value;
}

export function redactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return redactValue(input) as Record<string, unknown>;
}
