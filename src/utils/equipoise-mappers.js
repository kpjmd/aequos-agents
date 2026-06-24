import logger from './logger.js';

/**
 * Pure mappers from the live panel's internal vocabulary onto the equipoise schema enums
 * (src/utils/equipoise-schema.js). No LLM judge is needed: the benchmark probe feeds each
 * specialist EXACTLY the two curated option labels (plus "defer"), so a stance is always one
 * of those labels or "defer" — the mapping is mechanical and exact-match.
 *
 * Used by panel-run-storage.js for both benchmark_probe and (later, Phase 2b) production runs.
 */

// Registration key (camelCase) OR snake_case agentType -> specialist_agent enum.
const AGENT_ENUM = {
  triage: 'orthotriage',
  orthotriage: 'orthotriage',
  painWhisperer: 'pain_whisperer',
  pain_whisperer: 'pain_whisperer',
  movementDetective: 'movement_detective',
  movement_detective: 'movement_detective',
  strengthSage: 'strength_sage',
  strength_sage: 'strength_sage',
  mindMender: 'mind_mender',
  mind_mender: 'mind_mender',
};

/**
 * Map a specialist identifier to the specialist_agent enum. Returns null for unknown keys so
 * the caller can skip + warn rather than insert an invalid row (specialist_agent is NOT NULL).
 * @param {string} key - registration key or snake_case agentType
 * @returns {string|null}
 */
export function toAgentEnum(key) {
  return AGENT_ENUM[key] ?? null;
}

/**
 * Map a stance label onto the stance enum (option_a / option_b / abstain). "defer" and null map
 * to abstain. An off-menu label cannot occur in practice (makePositionSchema constrains stance to
 * the two options + defer), but is guarded: warn and coerce to abstain so persistence never throws.
 * @param {string} stanceLabel - an option label, or 'defer'
 * @param {string} optionALabel
 * @param {string} optionBLabel
 * @returns {'option_a'|'option_b'|'abstain'}
 */
export function toStanceEnum(stanceLabel, optionALabel, optionBLabel) {
  if (stanceLabel === 'defer' || stanceLabel == null) return 'abstain';
  if (stanceLabel === optionALabel) return 'option_a';
  if (stanceLabel === optionBLabel) return 'option_b';
  logger.warn(`equipoise-mappers: off-menu stance "${stanceLabel}" — coercing to abstain`);
  return 'abstain';
}
