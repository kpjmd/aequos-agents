/**
 * Option-order correctness: stance parses to the same CANONICAL option under AB and BA, and lability
 * keys off the canonical option (not the enum index). Plus the no-router-import guardrail.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { orderedOptions, canonicalize, ORDERS } from '../detector/option-order.js';
import { choiceLabilityRate } from '../detector/features.js';

const OPTIONS = ['Nonoperative management', 'Operative stabilization'];

describe('orderedOptions', () => {
  test('AB keeps canonical order, BA swaps', () => {
    expect(orderedOptions(OPTIONS, 'AB')).toEqual([OPTIONS[0], OPTIONS[1]]);
    expect(orderedOptions(OPTIONS, 'BA')).toEqual([OPTIONS[1], OPTIONS[0]]);
  });
});

describe('canonicalize is order-independent', () => {
  test('the same returned label maps to the same canonical code regardless of presentation order', () => {
    // The model returns the label text; it is A whether it was shown first (AB) or second (BA).
    expect(canonicalize('Operative stabilization', OPTIONS)).toBe('B');
    expect(canonicalize('Nonoperative management', OPTIONS)).toBe('A');
    expect(canonicalize('defer', OPTIONS)).toBe('defer');
  });
  test('a pure presentation swap does NOT read as a flip', () => {
    // Model picks "Operative stabilization" in BOTH orders → canonical B in both → NOT labile.
    const cells = [
      { archetypeKey: 'a', replicate: 1, order: 'AB', agent: 'p', stance: canonicalize('Operative stabilization', OPTIONS), confidence: 0.8, evidenceGrade: 'B' },
      { archetypeKey: 'a', replicate: 1, order: 'BA', agent: 'p', stance: canonicalize('Operative stabilization', OPTIONS), confidence: 0.8, evidenceGrade: 'B' },
    ];
    expect(choiceLabilityRate(cells).orderInstability).toBe(0);
  });
  test('unrecognized label → unknown (defensive)', () => {
    expect(canonicalize('something off-menu', OPTIONS)).toBe('unknown');
  });
});

describe('ORDERS', () => {
  test('exactly AB and BA', () => expect(ORDERS).toEqual(['AB', 'BA']));
});

describe('no decision-type router in the detector', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const detectorDir = join(dir, '..', 'detector');
  for (const f of ['grid.js', 'transport.js', 'index.js', 'features.js']) {
    test(`${f} does not IMPORT archetypeGroupsForDecisionType`, () => {
      const src = readFileSync(join(detectorDir, f), 'utf8');
      const importLines = src.split('\n').filter((l) => l.trim().startsWith('import'));
      expect(importLines.some((l) => l.includes('archetypeGroupsForDecisionType') || l.includes('archetypesForDecisionType'))).toBe(false);
    });
  }
});
