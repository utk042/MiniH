import { GoogleGenAI } from '@google/genai';
import { GEMINI_LIMITS, GEMINI_MODEL } from './model';

/**
 * Server only. GEMINI_API_KEY is read here and nowhere else, and nothing in
 * this file may be imported from a client component.
 *
 * Everything downstream talks to the GenerateJson seam rather than to the SDK,
 * so the pipeline can be tested without a network and without a key.
 */

export interface GenerateJsonRequest {
  prompt: string;
  /** Gemini responseSchema. Constrains decoding; not a substitute for Zod. */
  schema: unknown;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface GenerateJsonResponse {
  text: string;
  model: string;
  usage?: { promptTokens?: number; responseTokens?: number };
}

export type GenerateJson = (request: GenerateJsonRequest) => Promise<GenerateJsonResponse>;

export class GeminiUnavailableError extends Error {
  readonly code = 'gemini_unavailable';
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

let cachedClient: GoogleGenAI | null = null;

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiUnavailableError('GEMINI_API_KEY is not set.');
  }
  cachedClient ??= new GoogleGenAI({ apiKey });
  return cachedClient;
}

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * The real transport. JSON only: responseMimeType plus a responseSchema, so
 * there is no prose to strip and no fence to unwrap. Temperature 0 because this
 * is extraction — the same listing should resolve the same way every time.
 */
export const generateJson: GenerateJson = async ({ prompt, schema, maxOutputTokens, signal }) => {
  const timeout = AbortSignal.timeout(GEMINI_LIMITS.requestTimeoutMs);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const response = await client().models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema as never,
        temperature: GEMINI_LIMITS.temperature,
        maxOutputTokens,
        abortSignal: abort,
      },
    });

    const text = response.text ?? '';
    if (!text.trim()) {
      throw new GeminiUnavailableError('Gemini returned an empty response.');
    }

    return {
      text,
      model: GEMINI_MODEL,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount,
        responseTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  } catch (error) {
    if (error instanceof GeminiUnavailableError) throw error;
    throw new GeminiUnavailableError(
      error instanceof Error ? error.message : 'Gemini request failed.',
      error,
    );
  }
};

/**
 * responseMimeType should make this unnecessary. It is here because a stray
 * ```json fence is the single most common way a structured-output call fails,
 * and falling back to the rules path over a pair of backticks would be silly.
 */
export function parseJsonLoosely(text: string): unknown {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    // Last resort: the outermost {...} in the response.
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(unfenced.slice(start, end + 1));
    }
    throw new SyntaxError('Response was not JSON.');
  }
}
