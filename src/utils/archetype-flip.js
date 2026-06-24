/**
 * Archetype-flip equipoise detection (Phase 2a v2).
 *
 * Phase 2a's population-mode pilot found 0% sensitivity: with no patient specifics the 4-lens panel
 * falls back to a shared modal answer on genuine-equipoise decisions (see divergence-spike-findings,
 * "population mode gives 0% equipoise sensitivity"). The spike showed divergence is patient-specific
 * — a concrete athlete pulls Strength/Movement toward surgery. Archetype-flip operationalizes
 * POPULATION equipoise directly: run each decision across a few patient archetypes and call it
 * CONTESTED if the panel's modal answer FLIPS across them (the decision is patient-dependent) or if
 * any single archetype is itself internally split.
 *
 * Different decision types flip along different axes (see divergence-spike-findings, "Archetype-flip
 * restores sensitivity" + the which_operation follow-up):
 *   - conservative_vs_operative / timing_of_surgery / which_intervention flip on FUNCTIONAL DEMAND ×
 *     SURGICAL RISK (operate-or-not, intervene-or-not is patient-demand driven).
 *   - which_operation (technique/implant choice) flips on PATHOLOGY EXTENT × HOST BONE QUALITY
 *     (anatomy/fracture-pattern/disease-extent driven, NOT demand). Using demand×risk here misses
 *     the deciding axis (pkr-vs-tka, nail-vs-plate converged in the demand×risk pilot).
 * All archetypes are AGE-AGNOSTIC so they never contradict a DP that already specifies its population
 * ("older adult"). Within a set, the differentiating fields are clinical FACTS (demand/risk, or
 * extent/bone-quality); the stated goal is held constant so the set doesn't steer toward an option.
 */

export const DEMAND_RISK_ARCHETYPES = [
  {
    key: 'high_demand_low_risk',
    label: 'high-demand, low surgical risk',
    case: {
      activityLevel: 'high functional demand (competitive sport or heavy manual work)',
      surgicalRisk: 'low (healthy, no comorbidities raising operative risk)',
      priorities: 'maximize function and return to full activity',
    },
  },
  {
    key: 'average',
    label: 'average demand and risk',
    case: {
      activityLevel: 'moderate functional demand (recreational activity, typical daily demands)',
      surgicalRisk: 'average',
      priorities: 'balanced recovery of function at acceptable risk',
    },
  },
  {
    key: 'low_demand_high_risk',
    label: 'low-demand, elevated surgical risk',
    case: {
      activityLevel: 'low functional demand (sedentary, modest functional goals)',
      surgicalRisk: 'elevated (comorbidities raising operative risk)',
      priorities: 'symptom relief and safety; avoid unnecessary surgical risk',
    },
  },
];

// For which_operation: vary the local clinical FACTS that drive technique/implant selection
// (disease extent / injury pattern / bone quality), holding the goal constant and neutral so the
// set doesn't pre-load a particular technique.
export const PATHOLOGY_ARCHETYPES = [
  {
    key: 'limited_pathology',
    label: 'limited extent, favorable local factors',
    case: {
      pathologyExtent: 'limited/localized disease or a simple, well-aligned injury pattern',
      boneQuality: 'good bone stock',
      localFactors: 'favorable anatomy with no complicating features',
      priorities: 'the most appropriate operative choice given these local factors',
    },
  },
  {
    key: 'intermediate_pathology',
    label: 'intermediate extent and host factors',
    case: {
      pathologyExtent: 'moderate extent of disease or a moderately complex injury pattern',
      boneQuality: 'average bone stock',
      localFactors: 'some complicating anatomic features',
      priorities: 'the most appropriate operative choice given these local factors',
    },
  },
  {
    key: 'extensive_pathology',
    label: 'extensive disease/comminution, poor host factors',
    case: {
      pathologyExtent: 'extensive/multifocal disease, or a comminuted/complex injury pattern',
      boneQuality: 'poor bone quality / osteoporotic',
      localFactors: 'complicating anatomic features',
      priorities: 'the most appropriate operative choice given these local factors',
    },
  },
];

// For which_operation fixation choices whose answer turns on TECHNICAL FEASIBILITY, not demand or
// disease extent: the standard construct is preferred until a context makes it infeasible or
// inferior — e.g. a subtrochanteric fracture is nailed by default, but a surgeon chooses a plate for
// a periprosthetic fracture (retained hardware blocks the canal), after failed prior nailing, or when
// the pattern requires precise open control of individual fragments (clinical input, kpjohnsonmd).
// Descriptions are factual context; the goal is held constant so the set doesn't pre-load a construct.
export const FRACTURE_PATTERN_ARCHETYPES = [
  {
    key: 'standard_pattern',
    label: 'standard pattern, conventional construct feasible',
    case: {
      pattern: 'a typical fracture pattern in the usual location; no retained hardware or prior fixation',
      technicalContext: 'closed/indirect reduction is feasible and the medullary canal is accessible',
      priorities: 'the most appropriate fixation construct for this pattern and technical context',
    },
  },
  {
    key: 'intermediate_pattern',
    label: 'moderate complexity',
    case: {
      pattern: 'a moderately complex pattern with some comminution',
      technicalContext: 'reduction is achievable but not entirely straightforward',
      priorities: 'the most appropriate fixation construct for this pattern and technical context',
    },
  },
  {
    key: 'constrained_context',
    label: 'constrained context (retained hardware / failed prior fixation / needs direct control)',
    case: {
      pattern: 'a context where the conventional construct is constrained — e.g. a periprosthetic fracture with retained hardware blocking the intramedullary canal, a failed prior fixation, or a pattern requiring precise open control of individual fragments',
      technicalContext: 'intramedullary access is limited and/or direct anatomic fragment control is required',
      priorities: 'the most appropriate fixation construct for this pattern and technical context',
    },
  },
];

// Back-compat default (the validated demand×risk set).
export const ARCHETYPES = DEMAND_RISK_ARCHETYPES;

/**
 * Select the archetype set whose flip axis matches the decision type.
 * @param {string} decisionType
 * @returns {{set: Array, name: string}}
 */
export function archetypesForDecisionType(decisionType) {
  if (decisionType === 'which_operation') {
    return { set: PATHOLOGY_ARCHETYPES, name: 'pathology' };
  }
  return { set: DEMAND_RISK_ARCHETYPES, name: 'demand_risk' };
}

/**
 * Archetype groups (axes) to evaluate for a decision type. which_operation technique choices do not
 * share one axis — pkr-vs-tka flips on pathology, acl-graft-choice flips on demand — so they are run
 * across BOTH axes and labelled contested if EITHER flips (equipoise = case-dependent along any
 * clinically real axis). Other decision types flip on demand×risk alone (validated 8/8).
 * @param {string} decisionType
 * @returns {Array<{name:string, set:Array}>}
 */
export function archetypeGroupsForDecisionType(decisionType) {
  if (decisionType === 'which_operation') {
    return [
      { name: 'pathology', set: PATHOLOGY_ARCHETYPES },
      { name: 'demand_risk', set: DEMAND_RISK_ARCHETYPES },
      { name: 'fracture_pattern', set: FRACTURE_PATTERN_ARCHETYPES },
    ];
  }
  return [{ name: 'demand_risk', set: DEMAND_RISK_ARCHETYPES }];
}

/**
 * Combine per-axis flip verdicts: contested if ANY axis is contested (flip or internal split).
 * @param {Array<{name:string, flip:{verdict:string}}>} groupResults
 * @returns {{verdict:'converged'|'contested', contestedBy:string[]}}
 */
export function combineGroupVerdicts(groupResults) {
  const contestedBy = groupResults.filter((g) => g.flip.verdict === 'contested').map((g) => g.name);
  return { verdict: contestedBy.length ? 'contested' : 'converged', contestedBy };
}

/**
 * Aggregate per-archetype panel results into a single decision-point verdict.
 *
 * @param {Array<{key:string, verdict:'converged'|'contested', stanceCounts:Object<string,number>}>} archetypeResults
 *   one entry per archetype — `verdict` and `stanceCounts` come straight from the conference's
 *   summarizeDecisionPoint() splitSummary (substantive, above-floor stances only).
 * @returns {{verdict, flipDetected, internalContested, modalByArchetype, distinctOptionModals}}
 *   verdict is 'contested' if the modal answer flips across archetypes OR any archetype is internally
 *   split; else 'converged'. A 'split' archetype contributes internalContested; an archetype with no
 *   substantive stance is 'abstain' and ignored for flip detection.
 */
export function computeArchetypeFlipVerdict(archetypeResults) {
  const modalByArchetype = {};
  let internalContested = false;

  for (const a of archetypeResults) {
    if (a.verdict === 'contested') {
      internalContested = true;
      modalByArchetype[a.key] = 'split';
      continue;
    }
    const entries = Object.entries(a.stanceCounts || {});
    modalByArchetype[a.key] = entries.length
      ? entries.sort((x, y) => y[1] - x[1])[0][0]
      : 'abstain';
  }

  const optionModals = Object.values(modalByArchetype).filter(
    (m) => m !== 'abstain' && m !== 'split'
  );
  const distinctOptionModals = [...new Set(optionModals)];
  const flipDetected = distinctOptionModals.length >= 2;
  const verdict = internalContested || flipDetected ? 'contested' : 'converged';

  return { verdict, flipDetected, internalContested, modalByArchetype, distinctOptionModals };
}

export default computeArchetypeFlipVerdict;
