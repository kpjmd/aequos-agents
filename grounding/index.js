#!/usr/bin/env node
/**
 * Grounding CLI — build real evidence tables for anchor cases and (optionally) cache them.
 *
 *   node grounding/index.js --cases <id> … [--dry-run|--fetch] [--tier basic|premium]
 *
 * Default is DRY RUN: derive the query, print the grounded prompt skeleton with an empty evidence block,
 * no network, no model call, $0. --fetch calls the ResearchAgent (PubMed + heuristic query), normalizes,
 * and caches to artifacts/grounding/<id>.json for downstream consumers (mechanismProbe, the detector).
 */
import dotenv from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCases } from '../anchor-set/index.js';
import { buildGroundingQuery, buildEvidenceTable } from './build.js';
import { groundedPrompt } from './prompt.js';

dotenv.config();

function parseArgs(argv) {
  const o = { cases: [], dryRun: true, fetch: false, tier: 'basic' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fetch') { o.fetch = true; o.dryRun = false; }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--tier') o.tier = argv[++i] === 'premium' ? 'premium' : 'basic';
    else if (a === '--cases') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) o.cases.push(argv[++i]); }
  }
  return o;
}

function selectCases(all, ids) {
  const byId = new Map(all.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function artifactDir() {
  const dir = join(process.cwd(), 'artifacts', 'grounding');
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cases = selectCases(loadCases(), opts.cases);
  if (cases.length === 0) { console.error('no cases selected — pass --cases <id> …'); process.exit(1); }

  if (opts.dryRun) {
    const c = cases[0];
    console.log(`grounding DRY RUN — ${cases.length} case(s), tier=${opts.tier}`);
    console.log('\nderived query:', JSON.stringify(buildGroundingQuery(c), null, 2));
    console.log('\ngrounded prompt (evidence block empty until --fetch):\n');
    console.log(groundedPrompt(c, null).userPrompt);
    console.log('\nDRY RUN — re-run with --fetch to retrieve + cache real evidence tables.');
    process.exit(0);
  }

  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set (needed for the ResearchAgent query/intro).'); process.exit(1); }
  const { ResearchAgent } = await import('../src/agents/research-agent.js');
  const agent = new ResearchAgent();
  for (const c of cases) {
    const table = await buildEvidenceTable(c, agent, { tier: opts.tier });
    const out = join(artifactDir(), `${c.id}.json`);
    writeFileSync(out, JSON.stringify(table, null, 2) + '\n');
    console.log(`  ✓ ${c.id}: ${table.citations.length} citation(s), overall GRADE ${table.overall_grade || 'none'} → ${out}`);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('\nGROUNDING FAILED ❌', err); process.exit(1); });
}
