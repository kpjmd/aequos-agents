/**
 * Panel composition + the decorrelation ladder.
 *
 * Within-archetype entropy (the evidence-split / equivalent-options signal) is only meaningful if the
 * panel members can disagree for INDEPENDENT reasons. Four personas on ONE base model are
 * pseudo-replication — near one draw counted four times — which UNDER-detects evidence-split. The
 * detector must therefore record which composition produced every result and flag pseudo-replicated
 * panels, so downstream analysis never mistakes correlated agreement for genuine consensus.
 *
 * The rungs climb in decorrelation strength. Cross-provider is strongest AND maximizes upgrade
 * exposure — fine here precisely because the detector consumes behavioral signals recalibrated per
 * version, not hard-coded numbers.
 */
export const DECORRELATION_LADDER = [
  { id: 'personas_single_model', pseudo_replicated: true, desc: '4 specialist personas on one base model — correlated priors' },
  { id: 'seed_temperature_ensemble', pseudo_replicated: false, desc: 'replicate draws at temperature>0 — captures the model\'s own uncertainty only' },
  { id: 'same_family_multi_version', pseudo_replicated: false, desc: 'e.g. sonnet + haiku of the same family' },
  { id: 'cross_provider', pseudo_replicated: false, desc: 'multiple providers — strongest decorrelation (and most upgrade exposure)' },
];

/** Default composition = the current production panel (4 personas, single model). */
export const DEFAULT_COMPOSITION = 'personas_single_model';

/**
 * The same-family multi-version panel: one distinct Claude model per specialist slot, spanning the
 * size/generation tiers so the four members carry genuinely different priors (the decorrelation the
 * within-archetype entropy feature needs). These are MODEL IDS — configuration, not derived
 * thresholds; the recalibration gate remains DERIVED. Keys are the POSITION_SPECIALISTS agent types.
 */
export const SAME_FAMILY_MODELS = {
  painWhisperer: 'claude-opus-4-8',
  movementDetective: 'claude-sonnet-4-6',
  strengthSage: 'claude-haiku-4-5',
  mindMender: 'claude-opus-4-6',
};

/**
 * Resolve the model for one agent slot under a composition. Only same_family_multi_version routes
 * per-agent; every other rung (personas_single_model default, and the not-yet-wired
 * seed_temperature_ensemble / cross_provider) returns the single default model, so the default path
 * and all existing behavior are unchanged.
 * @param {string} composition
 * @param {string} agentType - a POSITION_SPECIALISTS key
 * @param {string} defaultModel - the single-model fallback (POSITION_MODEL)
 * @returns {string} model id
 */
export function modelForAgent(composition, agentType, defaultModel) {
  if (composition === 'same_family_multi_version') {
    return SAME_FAMILY_MODELS[agentType] || defaultModel;
  }
  return defaultModel;
}

/**
 * The per-agent model map a composition will use over a set of agent types — carried into the
 * artifact so every feature row records exactly which model produced each slot's stances.
 * @param {string} composition
 * @param {string[]} agentTypes
 * @param {string} defaultModel
 * @returns {Object<string,string>}
 */
export function modelMap(composition, agentTypes, defaultModel) {
  const m = {};
  for (const a of agentTypes) m[a] = modelForAgent(composition, a, defaultModel);
  return m;
}

/**
 * @param {string} id
 * @returns {{id, pseudo_replicated, desc}}
 */
export function compositionMeta(id = DEFAULT_COMPOSITION) {
  const found = DECORRELATION_LADDER.find((r) => r.id === id);
  if (!found) throw new Error(`unknown panel composition: ${id} (expected one of ${DECORRELATION_LADDER.map((r) => r.id).join(', ')})`);
  return found;
}

export default DECORRELATION_LADDER;
