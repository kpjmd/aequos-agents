import logger from './logger.js';

/**
 * Single source of truth for agent persona identity inside coordination divergences.
 *
 * The frontend renders `specialist` (display name) verbatim and keys joins/grouping on
 * `specialistType` (machine key). This module maps any internal identifier variant —
 * the camelCase registration key, the snake_case `agentType`, or research aliases — to the
 * ONE canonical { specialistType, specialist } pair, so every divergence field is consistent.
 *
 * Only the 4 specialists in POSITION_SPECIALISTS ever appear in divergences in practice;
 * triage and research are included for completeness/robustness.
 */

const PERSONA_BY_KEY = {
  triage: { specialistType: 'triage', specialist: 'OrthoTriage Master' },
  painWhisperer: { specialistType: 'painWhisperer', specialist: 'Pain Whisperer' },
  movementDetective: { specialistType: 'movementDetective', specialist: 'Movement Detective' },
  strengthSage: { specialistType: 'strengthSage', specialist: 'Strength Sage' },
  mindMender: { specialistType: 'mindMender', specialist: 'Mind Mender' },
  research: { specialistType: 'research', specialist: 'Research Agent' },
};

// Normalize snake_case agentType values and research naming variants to the canonical key.
const ALIASES = {
  pain_whisperer: 'painWhisperer',
  movement_detective: 'movementDetective',
  strength_sage: 'strengthSage',
  mind_mender: 'mindMender',
  research_pioneer: 'research',
  researchPioneer: 'research',
};

/**
 * Resolve any internal specialist identifier to its canonical persona identity.
 * Falls back to the raw value (with a warning) for unknown identifiers — never throws,
 * so the divergence pipeline degrades gracefully instead of crashing.
 * @param {string} internalId
 * @returns {{ specialistType: string, specialist: string }}
 */
export function resolvePersona(internalId) {
  const key = ALIASES[internalId] || internalId;
  const persona = PERSONA_BY_KEY[key];
  if (!persona) {
    logger.warn(`specialist-identity: no persona mapping for "${internalId}" — falling back to raw value`);
    return { specialistType: internalId, specialist: internalId };
  }
  return { ...persona };
}

export { PERSONA_BY_KEY };
