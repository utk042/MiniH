import type { CanonicalBook, CanonicalizationSource } from './schema';

/**
 * The two things the pipeline needs from the outside world, as interfaces.
 * Supabase implementations are in supabase-repos.ts; in-memory ones live in the
 * tests. Neither the orchestrator nor its tests know which is in use.
 */

export interface CacheEntry {
  inputHash: string;
  rawInput: string;
  normalizedInput: string;
  record: CanonicalBook;
  canonicalKey: string;
  model: string;
  source: Exclude<CanonicalizationSource, 'cache'>;
  overriddenBy?: string | null;
}

export interface CanonicalizationCache {
  /** Null on a miss. Implementations must not throw on a miss. */
  get(inputHash: string): Promise<CacheEntry | null>;
  put(entry: CacheEntry): Promise<void>;
  /** Best-effort usage counter. Failures here must never fail a lookup. */
  bumpHit(inputHash: string): Promise<void>;
}

export interface CatalogueMatch {
  canonicalKey: string;
  workKey: string;
  title: string;
  authors: string[];
  editionNumber: number | null;
  editionLabel: string | null;
  subjectTags: string[];
  courseCodes: string[];
}

export interface CatalogueQuery {
  titleKey: string;
  editionNumber: number | null;
  /** Slugified surnames from the resolved record, used to break title ties. */
  surnames: string[];
  isbn13: string | null;
}

export interface BookCatalogue {
  /**
   * Finds a book already in the catalogue that this record describes.
   * Returning null means "mint a new key", so a false positive is worse than a
   * false negative: two different books sharing one node is unrecoverable,
   * whereas a duplicate node can be merged later.
   */
  find(query: CatalogueQuery): Promise<CatalogueMatch | null>;
}

/** A catalogue that never matches. Useful in tests and for the CLI. */
export const emptyCatalogue: BookCatalogue = {
  async find() {
    return null;
  },
};

/** A cache that never hits. Every call goes to the model. */
export const noCache: CanonicalizationCache = {
  async get() {
    return null;
  },
  async put() {},
  async bumpHit() {},
};

export class InMemoryCache implements CanonicalizationCache {
  private readonly entries = new Map<string, CacheEntry>();
  readonly hits: string[] = [];

  async get(inputHash: string): Promise<CacheEntry | null> {
    return this.entries.get(inputHash) ?? null;
  }

  async put(entry: CacheEntry): Promise<void> {
    const existing = this.entries.get(entry.inputHash);
    // Human corrections are final; automated output must not overwrite them.
    // The same rule is enforced by a trigger in migration 000400.
    if (existing?.source === 'human' && entry.source !== 'human') return;
    this.entries.set(entry.inputHash, entry);
  }

  async bumpHit(inputHash: string): Promise<void> {
    this.hits.push(inputHash);
  }

  get size(): number {
    return this.entries.size;
  }
}
