/**
 * The unified sampling grid — the SAME grid for every case, no decision-type router.
 *
 * grid = patient_archetype × agent × replicate_index × option_order
 *
 * Spec decision #3: compute both variance components for every case; route NOTHING. We therefore use
 * ONE canonical archetype axis for all cases — the validated, condition-agnostic DEMAND_RISK set. The
 * pathology / fracture-pattern / biological-window axes were decision-type-specific patches selected by
 * archetypeGroupsForDecisionType (the router); importing that here would resurrect routing. We import
 * only the DEMAND_RISK archetype DATA. Axis richness is a later experiment slot.
 *
 * "sampling_seed" is honestly a REPLICATE INDEX: the Anthropic API has no sampling seed, so replicates
 * are iid draws at temperature>0, not reproducible seeds. Named accordingly everywhere.
 */
import { DEMAND_RISK_ARCHETYPES } from '../src/utils/archetype-flip.js';
import { POSITION_SPECIALISTS } from '../src/utils/coordination-conference.js';
import { ORDERS } from './option-order.js';

export const ARCHETYPE_AXIS = DEMAND_RISK_ARCHETYPES;
export const AGENTS = POSITION_SPECIALISTS;

/**
 * Enumerate the grid points (archetype × replicate × order). Agents fan out within each point.
 * @param {number} replicates
 * @returns {Array<{archetypeKey:string, archetype:object, replicate:number, order:'AB'|'BA'}>}
 */
export function buildGridPoints(replicates = 2) {
  const points = [];
  for (const archetype of ARCHETYPE_AXIS) {
    for (let replicate = 1; replicate <= replicates; replicate++) {
      for (const order of ORDERS) {
        points.push({ archetypeKey: archetype.key, archetype, replicate, order });
      }
    }
  }
  return points;
}

/** Requests per case = archetypes × replicates × orders × agents. */
export function requestsPerCase(replicates = 2) {
  return ARCHETYPE_AXIS.length * replicates * ORDERS.length * AGENTS.length;
}

export function gridShape(replicates = 2) {
  return { archetypes: ARCHETYPE_AXIS.length, agents: AGENTS.length, replicates, orders: ORDERS.length };
}
