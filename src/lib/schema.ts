/**
 * Data model for src/data/graph.json.
 *
 * Two independent honesty labels exist and must not be conflated:
 *
 *  - Nodes carry `verification`: how the baseline number was checked.
 *  - Edges carry `confidence`: whether the causal relationship itself has a
 *    cited source ("empirical") or is a commonly argued direction with no
 *    citable magnitude ("modeled").
 *
 * `strength` is a qualitative weight for every edge, including empirical ones.
 * A cited source supports that the relationship exists and its direction. It
 * does not supply a coefficient.
 */

export const CATEGORIES = ["economic", "fiscal", "social", "institutional", "policy"] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * observed:  a measured series.
 * projected: a forecast or projection, never presented as an observation.
 * index:     an abstract 0-100 lever with no real unit and no baseline.
 */
export const VALUE_TYPES = ["observed", "projected", "index"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

/**
 * primary:   the page at a primary-source host was fetched and the figure was
 *            read on it.
 * secondary: a news or aggregator page relays the figure.
 * pending:   a value was supplied but no source page has been read yet.
 */
export const VERIFICATIONS = ["primary", "secondary", "pending"] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const CONFIDENCES = ["empirical", "modeled"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** Coarse tiers, so that 0.7 versus 0.8 is never mistaken for a finding. */
export const STRENGTH_TIERS = [0.25, 0.5, 0.75, 1] as const;
export type StrengthTier = (typeof STRENGTH_TIERS)[number];

export interface GraphNode {
  id: string;
  label: string;
  category: Category;
  valueType: ValueType;
  unit: string;
  baseline: number | null;
  /** Editorial display scale for the lever. This is not data. */
  range: { min: number; max: number };
  /** Period the baseline describes: YYYY, YYYY-MM, YYYY-MM-DD, YYYY-Qn, or FYYYYY. */
  asOf: string | null;
  /** null for index nodes, which have nothing to verify. */
  verification: Verification | null;
  sourceUrl: string | null;
  sourceDetail: string | null;
  /** ISO date (YYYY-MM-DD) on which the source page was fetched and read. */
  retrievedDate: string | null;
  description: string;
}

export interface GraphEdge {
  /** Always `${from}__${to}`. */
  id: string;
  from: string;
  to: string;
  direction: 1 | -1;
  strength: StrengthTier;
  confidence: Confidence;
  sourceUrl: string | null;
  sourceDetail: string | null;
  retrievedDate: string | null;
  /** One line, shown on hover. */
  claim: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type ValidationCode =
  | "invalid_type"
  | "unknown_key"
  | "invalid_id"
  | "duplicate_id"
  | "invalid_enum"
  | "invalid_range"
  | "baseline_required"
  | "baseline_forbidden"
  | "baseline_out_of_range"
  | "as_of_required"
  | "invalid_as_of"
  | "verification_mismatch"
  | "source_required"
  | "source_forbidden"
  | "invalid_url"
  | "invalid_date"
  | "primary_host_required"
  | "dangling_reference"
  | "self_loop"
  | "id_mismatch"
  | "invalid_direction"
  | "invalid_strength"
  | "invalid_claim"
  | "forbidden_word";

export interface ValidationError {
  path: string;
  code: ValidationCode;
  message: string;
}
