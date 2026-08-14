/**
 * Hand-written to match supabase/migrations/*.sql. There is no live project in
 * this environment to run `supabase gen types typescript` against; when one
 * exists, regenerate this file and delete the by-hand parts below the marker.
 *
 * Every table needs `Relationships: []` and non-`never` Insert/Update or the
 * whole `Database['public']` type silently fails to satisfy postgrest-js's
 * `GenericSchema` constraint — the client then falls back to typing every
 * query as `never`, with no error at the point of failure, only downstream
 * where the never-typed results are used. Tables the app never writes to
 * (matches, match_legs, tag_vocabulary, app_config) still get a real Insert
 * type here for that reason; RLS is what actually stops the write.
 */

export type CopyCondition = 'poor' | 'fair' | 'good' | 'like_new' | 'new';
export type CopyStatus = 'open' | 'reserved' | 'traded' | 'withdrawn';
export type WantStatus = 'active' | 'fulfilled' | 'archived';
export type MatchKind = 'swap' | 'cash';
export type MatchStatus = 'proposed' | 'accepted' | 'declined' | 'expired' | 'completed';
export type CanonSource = 'gemini' | 'fallback' | 'human' | 'seed';

type AppConfigRow = {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

type ProfileRow = {
  id: string;
  email: string;
  handle: string;
  display_name: string;
  pickup_spot: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

type BookRow = {
  id: string;
  canonical_key: string;
  work_key: string;
  title: string;
  authors: string[];
  edition_number: number | null;
  edition_label: string | null;
  isbn13: string | null;
  subject_tags: string[];
  course_codes: string[];
  list_price_cents: number | null;
  source: CanonSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  title_key: string;
}

type CopyRow = {
  id: string;
  owner_id: string;
  book_id: string;
  condition: CopyCondition;
  condition_score: number;
  notes: string | null;
  description: string | null;
  ask_price_cents: number | null;
  photo_path: string | null;
  status: CopyStatus;
  raw_input: string | null;
  input_hash: string | null;
  created_at: string;
  updated_at: string;
}

type WantRow = {
  id: string;
  user_id: string;
  canonical_key: string;
  priority: number;
  edition_strict: boolean;
  status: WantStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

type MatchRow = {
  id: string;
  kind: MatchKind;
  leg_count: number;
  signature: string;
  score: number;
  total_condition: number;
  min_condition: number;
  all_exact: boolean;
  status: MatchStatus;
  created_at: string;
  refreshed_at: string;
}

type MatchLegRow = {
  match_id: string;
  position: number;
  giver_id: string;
  receiver_id: string;
  copy_id: string;
  book_id: string;
  want_id: string | null;
  exact: boolean;
}

type MessageRow = {
  id: string;
  match_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

type CacheCanonicalizationRow = {
  input_hash: string;
  raw_input: string;
  normalized_input: string;
  result: Record<string, unknown>;
  canonical_key: string;
  model: string;
  source: CanonSource;
  hits: number;
  overridden_by: string | null;
  created_at: string;
  updated_at: string;
}

type TagVocabularyRow = {
  tag: string;
  facet: string;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      app_config: {
        Row: AppConfigRow;
        Insert: AppConfigRow;
        Update: Partial<AppConfigRow>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & Pick<ProfileRow, 'id' | 'email' | 'handle' | 'display_name'>;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      books: {
        Row: BookRow;
        Insert: Partial<BookRow> & Pick<BookRow, 'canonical_key' | 'work_key' | 'title'>;
        Update: Partial<BookRow>;
        Relationships: [];
      };
      copies: {
        Row: CopyRow;
        Insert: Partial<CopyRow> & Pick<CopyRow, 'owner_id' | 'book_id' | 'condition'>;
        Update: Partial<CopyRow>;
        Relationships: [];
      };
      wants: {
        Row: WantRow;
        Insert: Partial<WantRow> & Pick<WantRow, 'user_id' | 'canonical_key'>;
        Update: Partial<WantRow>;
        Relationships: [];
      };
      matches: {
        Row: MatchRow;
        Insert: MatchRow;
        Update: Partial<MatchRow>;
        Relationships: [];
      };
      match_legs: {
        Row: MatchLegRow;
        Insert: MatchLegRow;
        Update: Partial<MatchLegRow>;
        Relationships: [];
      };
      messages: {
        Row: MessageRow;
        Insert: Pick<MessageRow, 'match_id' | 'sender_id' | 'body'>;
        Update: Partial<Pick<MessageRow, 'read_at'>>;
        Relationships: [];
      };
      cache_canonicalization: {
        Row: CacheCanonicalizationRow;
        Insert: Partial<CacheCanonicalizationRow> &
          Pick<
            CacheCanonicalizationRow,
            'input_hash' | 'raw_input' | 'normalized_input' | 'result' | 'canonical_key' | 'model' | 'source'
          >;
        Update: Partial<CacheCanonicalizationRow>;
        Relationships: [];
      };
      tag_vocabulary: {
        Row: TagVocabularyRow;
        Insert: TagVocabularyRow;
        Update: Partial<TagVocabularyRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      find_swap_cycles: {
        Args: { p_user?: string | null; p_max_participants?: number; p_limit?: number };
        Returns: Array<{
          leg_count: number;
          participants: string[];
          copy_ids: string[];
          book_ids: string[];
          want_ids: string[];
          all_exact: boolean;
          total_condition: number;
          min_condition: number;
          score: number;
          signature: string;
        }>;
      };
      find_cash_offers: {
        Args: { p_user: string; p_limit?: number };
        Returns: Array<{
          want_id: string;
          wanted_key: string;
          copy_id: string;
          book_id: string;
          owner_id: string;
          condition: CopyCondition;
          ask_price_cents: number | null;
          suggested_price_cents: number | null;
          exact: boolean;
        }>;
      };
      suggest_price_cents: {
        Args: { p_book_id: string; p_condition: CopyCondition };
        Returns: number | null;
      };
      book_demand: {
        Args: { p_canonical_key: string };
        Returns: number;
      };
      resolve_book: {
        Args: {
          p_title_key: string;
          p_edition_number?: number | null;
          p_surnames?: string[];
          p_isbn13?: string | null;
        };
        Returns: Array<{
          canonical_key: string;
          work_key: string;
          title: string;
          authors: string[];
          edition_number: number | null;
          edition_label: string | null;
          subject_tags: string[];
          course_codes: string[];
        }>;
      };
      bump_canonicalization_hit: {
        Args: { p_input_hash: string };
        Returns: undefined;
      };
      respond_to_match: {
        Args: { p_match_id: string; p_status: MatchStatus };
        Returns: MatchStatus;
      };
    };
  };
}
