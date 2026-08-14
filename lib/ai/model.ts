/**
 * The one place the model id lives. Swapping tiers is a one-line change here.
 */
export const GEMINI_MODEL = 'gemini-2.5-flash-lite';

/**
 * Ceilings, not targets. Canonicalization returns a small record and enrichment
 * returns eight tags and two sentences; if a response is running past these
 * something has gone wrong and we would rather fall back than pay for it.
 */
export const GEMINI_LIMITS = {
  canonicalizeMaxOutputTokens: 512,
  enrichMaxOutputTokens: 384,
  /** Extraction, not composition. Same input should give the same record. */
  temperature: 0,
  requestTimeoutMs: 8_000,
} as const;
