export type CetFamilyEntry = {
  headword: string;
  variants: string[];
  homonym_index: number | null;
  raw: string;
};

export type LexicalInfo = {
  matched_word: string;
  phonetic: string | null;
  translation: string | null;
  pos: Array<{ tag: string; weight: number | null }>;
  inflections: Record<string, string[]>;
  frequency: {
    bnc_rank: number | null;
    frq_rank: number | null;
    collins_stars: number | null;
    oxford_3000: boolean;
    tags: string[];
  };
};

export type StudyPriority = {
  tier: "A" | "B" | "C" | "N";
  score: number;
  sources: string[];
};

export type CetOfficialEntry = {
  id: string;
  headword: string;
  variants: string[];
  homonym_index: number | null;
  cet6: boolean;
  family: CetFamilyEntry[];
  source: {
    raw_headword: string;
    raw_family: string[];
    source_kind?: string;
  };
  lexical: LexicalInfo | null;
  lexical_source: string | null;
  lexical_match: "headword" | "variant" | null;
  study_priority: StudyPriority;
};

export type CetOfficialDataset = {
  metadata: Record<string, unknown>;
  entries: CetOfficialEntry[];
};
