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

// The `priorities` goal is held CONSTANT and neutral across the three archetypes (it does NOT steer
// toward surgery or non-op): only the FACTS — functional demand and surgical-risk profile — vary, so
// the panel weighs them clinically. An earlier directional steer on the low archetype ("avoid
// unnecessary surgical risk / symptom relief and safety") manufactured palliative non-op options that
// false-positived absolute-indication cases (atlantoaxial myelopathy, unstable pelvic ring); neutralizing
// it lets demand/risk inform the choice without overriding a mandatory operative indication.
const DEMAND_RISK_GOAL = 'the most appropriate management given this patient\'s functional demand and surgical-risk profile';

export const DEMAND_RISK_ARCHETYPES = [
  {
    key: 'high_demand_low_risk',
    label: 'high-demand, low surgical risk',
    case: {
      activityLevel: 'high functional demand (competitive sport or heavy manual work)',
      surgicalRisk: 'low (healthy, no comorbidities raising operative risk)',
      priorities: DEMAND_RISK_GOAL,
    },
  },
  {
    key: 'average',
    label: 'average demand and risk',
    case: {
      activityLevel: 'moderate functional demand (recreational activity, typical daily demands)',
      surgicalRisk: 'average',
      priorities: DEMAND_RISK_GOAL,
    },
  },
  {
    key: 'low_demand_high_risk',
    label: 'low-demand, elevated surgical risk',
    case: {
      activityLevel: 'low functional demand (sedentary, modest functional goals)',
      surgicalRisk: 'elevated (comorbidities raising operative risk)',
      priorities: DEMAND_RISK_GOAL,
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

// For timing_of_surgery: timing equipoise turns on LOCAL INJURY BIOLOGY, not functional demand —
// whether the wound/soft-tissue/nerve biology mandates operating now or tolerates a window of waiting,
// observation, or staged care. The demand×risk axis alone can never flip these (open-fracture-
// debridement-timing and radial-nerve-palsy were deterministic 0/3 false negatives; see
// divergence-spike-findings, "Full 122-sweep, N=3"). This is the exact analog of the which_operation
// multi-axis discovery. A single BUNDLED axis: contamination, soft-tissue envelope, and spontaneous
// nerve-recovery co-vary with injury severity, so one archetype can describe the whole local-biology
// state. Clinical input + sign-off: kpjohnsonmd, ortho surgeon.
//
// RELEVANCE-GATED to TWO clean levers (after iteration — see below). Each fact is CONDITIONAL, so an
// injury without that feature has nothing to apply and the archetype stays converged, while genuinely
// open-wound / nerve-injury decisions flip:
//   - woundContamination — gated to "if there is an open wound" (drives open-fracture-debridement-timing;
//     vacuous on closed fractures).
//   - nerveRecovery — gated to "if a nerve is injured", framed neurapraxia-vs-laceration (drives
//     radial-nerve-palsy; vacuous when no nerve is injured).
// Labels are kept neutral and explicitly conditional ("where applicable") so the archetype carries no
// unconditional "this injury is high-risk" gestalt.
//
// WHY a soft-tissue-envelope lever is NOT here (the iteration record): v1 used an unconditional
// "compromised soft-tissue envelope" and spuriously flipped hip-fracture-surgery-timing-fit 3/3 (the
// same failure mode as the old demand-axis bailout on absolute cases — varying a SETTLED case's
// standard candidate). Conditioning it ("if there is a soft-tissue injury…", then region-gating to
// "a thin/subcutaneous envelope: distal tibia, ankle, foot…") did NOT fix it: the panel still delayed
// the hip fracture on the overall high-risk-biology gestalt (a robust 3/4-lens flip, not a thin
// artifact a support threshold removes — a compromised peri-hip envelope genuinely delays surgery).
// Since hip-fx-timing is genuinely settled for the standard closed case, the axis must not manufacture
// that tissue variant — so the soft-tissue lever was DROPPED (MD decision, kpjohnsonmd). Pilon
// (the staged-vs-immediate soft-tissue case) is instead caught by the demand_risk axis in the
// OR-combine (~2/3 at N=3 — pilon is demand-correlated). The generic injury-energy lever (which also
// leaked to closed fractures) was likewise dropped. The axis carries minModalSupport:2 (see
// archetypeGroupsForDecisionType) so a lone non-deferring lens can't manufacture a flip where the
// conditional levers don't apply. The goal is held CONSTANT and neutral so the set does not steer
// toward operating-now or waiting (the demand-axis neutralization lesson — facts vary, direction does not).
const BIOLOGICAL_WINDOW_GOAL =
  "the most appropriate timing or sequencing of surgery given this injury's local tissue biology and healing/recovery profile";

export const BIOLOGICAL_WINDOW_ARCHETYPES = [
  {
    key: 'narrow_window',
    label: 'contaminated open wound / low nerve-recovery mechanism (where applicable)',
    case: {
      woundContamination: 'if there is an open wound, it is heavily contaminated',
      nerveRecovery: 'if a nerve is injured, the mechanism suggests low spontaneous-recovery potential (a laceration or entrapment rather than a neurapraxia)',
      priorities: BIOLOGICAL_WINDOW_GOAL,
    },
  },
  {
    key: 'intermediate_window',
    label: 'intermediate wound contamination / nerve-recovery (where applicable)',
    case: {
      woundContamination: 'if there is an open wound, it has moderate contamination',
      nerveRecovery: 'if a nerve is injured, its spontaneous-recovery potential is uncertain',
      priorities: BIOLOGICAL_WINDOW_GOAL,
    },
  },
  {
    key: 'wide_window',
    label: 'clean open wound / high nerve-recovery mechanism (where applicable)',
    case: {
      woundContamination: 'if there is an open wound, it is clean',
      nerveRecovery: 'if a nerve is injured, the mechanism suggests high spontaneous-recovery potential (a neurapraxia in continuity)',
      priorities: BIOLOGICAL_WINDOW_GOAL,
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
 * Archetype groups (axes) to evaluate for a decision type. Some decision types do not share one
 * axis, so they are run across MULTIPLE axes and labelled contested if EITHER/ANY flips (equipoise =
 * case-dependent along any clinically real axis):
 *   - which_operation technique choices: pkr-vs-tka flips on pathology, acl-graft-choice on demand,
 *     nail-vs-plate on fracture_pattern → run all three.
 *   - timing_of_surgery: timing equipoise turns on local injury BIOLOGY (contamination/soft-tissue
 *     envelope/spontaneous-recovery), not functional demand — the demand×risk axis can never flip
 *     open-fx-debridement-timing or radial-nerve-palsy (deterministic FNs) → run demand_risk AND
 *     biological_window. demand_risk is retained because it already recovers pilon (soft-tissue/demand
 *     correlation) and held the timing settled controls at N=3.
 * Other decision types flip on demand×risk alone (validated 8/8).
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
  if (decisionType === 'timing_of_surgery') {
    return [
      { name: 'demand_risk', set: DEMAND_RISK_ARCHETYPES },
      // minModalSupport: 2 — the biological_window levers are relevance-gated ("if there is an open
      // wound …"), so on a DP where they don't apply most lenses DEFER and a lone non-deferring lens
      // can otherwise manufacture a thin cross-archetype flip (this spuriously flipped
      // hip-fracture-surgery-timing-fit on a single "deliberate delay" vote, 3 deferring). Requiring
      // ≥2 lenses to hold the differing stance discards that gating artifact while keeping every
      // genuine timing flip (open-fx/pilon/radial-nerve all carry 3-4/4 lens support). Scoped to this
      // axis only — the unconditional demand/pathology/fracture axes engage all lenses, so lone-lens
      // modals don't arise there and their validated behavior is untouched.
      { name: 'biological_window', set: BIOLOGICAL_WINDOW_ARCHETYPES, minModalSupport: 2 },
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
 * @param {{minModalSupport?:number}} [options] - minModalSupport (default 1): an archetype's modal
 *   stance is only counted toward a cross-archetype flip if at least this many lenses hold it;
 *   below it the archetype is treated as 'abstain'. Used by relevance-gated axes (biological_window)
 *   to discard lone-lens modals that arise when most lenses defer because the levers don't apply.
 * @returns {{verdict, flipDetected, internalContested, modalByArchetype, distinctOptionModals}}
 *   verdict is 'contested' if the modal answer flips across archetypes OR any archetype is internally
 *   split; else 'converged'. A 'split' archetype contributes internalContested; an archetype with no
 *   qualifying substantive stance is 'abstain' and ignored for flip detection.
 */
export function computeArchetypeFlipVerdict(archetypeResults, options = {}) {
  const { minModalSupport = 1 } = options;
  const modalByArchetype = {};
  let internalContested = false;

  for (const a of archetypeResults) {
    if (a.verdict === 'contested') {
      internalContested = true;
      modalByArchetype[a.key] = 'split';
      continue;
    }
    const entries = Object.entries(a.stanceCounts || {});
    const top = entries.length ? entries.sort((x, y) => y[1] - x[1])[0] : null;
    modalByArchetype[a.key] = top && top[1] >= minModalSupport ? top[0] : 'abstain';
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
