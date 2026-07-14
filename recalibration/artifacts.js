/**
 * Persist / load recalibration artifacts, keyed by (model_version, anchor_set_version) so a model
 * upgrade RE-DERIVES its own threshold and never silently reuses an old one. Files, git-ignorable, one
 * per (model, anchor-set) pair.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const STORE_DIR = join(__dirname, 'store');

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');

export function artifactPath(modelVersion, anchorSetVersion) {
  return join(STORE_DIR, `${sanitize(modelVersion)}__${sanitize(anchorSetVersion)}.json`);
}

export function saveArtifact(modelVersion, anchorSetVersion, artifact) {
  mkdirSync(STORE_DIR, { recursive: true });
  const p = artifactPath(modelVersion, anchorSetVersion);
  writeFileSync(p, JSON.stringify(artifact, null, 2) + '\n');
  return p;
}

export function loadArtifact(modelVersion, anchorSetVersion) {
  const p = artifactPath(modelVersion, anchorSetVersion);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
