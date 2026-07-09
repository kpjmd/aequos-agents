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
 * @param {string} id
 * @returns {{id, pseudo_replicated, desc}}
 */
export function compositionMeta(id = DEFAULT_COMPOSITION) {
  const found = DECORRELATION_LADDER.find((r) => r.id === id);
  if (!found) throw new Error(`unknown panel composition: ${id} (expected one of ${DECORRELATION_LADDER.map((r) => r.id).join(', ')})`);
  return found;
}

export default DECORRELATION_LADDER;
