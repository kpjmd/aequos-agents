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
 * The archetypes vary the two levers that genuinely flip orthopedic operative-vs-conservative /
 * technique decisions — functional demand and surgical risk — and are deliberately AGE-AGNOSTIC so
 * they never contradict a decision point that already specifies its population (e.g. "older adult").
 */

export const ARCHETYPES = [
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
