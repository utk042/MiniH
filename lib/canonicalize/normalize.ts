import { createHash } from 'node:crypto';

/**
 * Normalisation exists so that trivial differences in what someone typed do not
 * cost a second API call. "  ORGO 3rd ed  Morrison Boyd " and
 * "orgo 3rd ed morrison boyd" are the same cache entry.
 *
 * It is deliberately conservative: case, whitespace, curly quotes and dashes
 * only. Nothing that could change which book is being described.
 */
export function normalizeInput(raw: string): string {
  return raw
    .normalize('NFKC')
    // Curly quotes and dashes vary by keyboard and by phone autocorrect.
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Cache key. Taken over the normalised form, never the raw string. */
export function hashInput(raw: string): string {
  return createHash('sha256').update(normalizeInput(raw), 'utf8').digest('hex');
}

/** Hash of an arbitrary structured value, for the enrichment cache. */
export function hashStructured(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

/** JSON.stringify with sorted keys, so key order cannot change the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Rough guard against someone pasting a chapter into the listing box. */
export const MAX_RAW_INPUT_LENGTH = 1000;

export function assertUsableInput(raw: string): string {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) {
    throw new InputTooThinError('Type something about the book first.');
  }
  if (trimmed.length > MAX_RAW_INPUT_LENGTH) {
    throw new InputTooThinError(
      `That is ${trimmed.length} characters. Keep it under ${MAX_RAW_INPUT_LENGTH} — title, author, edition, condition.`,
    );
  }
  // Two characters of "ok" is not a book.
  if (trimmed.replace(/[^a-z0-9]/gi, '').length < 3) {
    throw new InputTooThinError('That is too short to identify a book.');
  }
  return trimmed;
}

export class InputTooThinError extends Error {
  readonly code = 'input_too_thin';
}
