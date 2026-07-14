/**
 * Neutralize Coinbase AgentKit's startup telemetry.
 *
 * WHY: `WalletProvider`'s constructor fires `sendAnalyticsEvent()` fire-and-forget
 * (Promise.resolve().then(() => this.trackInitialization())) with NO `.catch()`. Inside,
 * `sendAnalyticsEvent` is async and `await fetch("https://cca-lite.coinbase.com/amp")`
 * THROWS on a non-2xx response — but AgentKit wraps it in a *synchronous* try/catch, which
 * cannot catch the async rejection. The result is an unhandledRejection that, under Node's
 * default `--unhandled-rejections=throw`, KILLS the process. Coinbase's analytics endpoint
 * began returning HTTP 400 in July 2026, which turned this latent bug into a crash-loop at
 * startup (Express never binds → Railway deploy fails). AgentKit 0.10.2 exposes no opt-out env
 * var, so we neutralize the telemetry before any wallet provider is constructed. The global
 * unhandledRejection guard in index.js is the belt to this suspenders — either alone stops the
 * crash; together the failing call never even fires.
 *
 * Two layers, both best-effort (a future AgentKit reorg can't leave us worse off — the
 * process-level guard still protects the server):
 *   1. Replace the exported `sendAnalyticsEvent` with a no-op. Its deep subpath is blocked by
 *      the package `exports` map, so we resolve the file by ABSOLUTE path (which bypasses the
 *      map) off the package main. The analytics index re-exports via a live getter, so the
 *      no-op reaches walletProvider.
 *   2. Intercept `globalThis.fetch` for the analytics host only, returning a synthetic 204 so
 *      even an un-patched code path can't throw. Every other request passes through untouched.
 *
 * @returns {boolean} true if at least one layer engaged.
 */
import { createRequire } from 'module';
import path from 'path';
import logger from './logger.js';

const require = createRequire(import.meta.url);
const ANALYTICS_HOST = 'cca-lite.coinbase.com';

/** Layer 1: no-op the exported telemetry function via an absolute-path require. */
function patchTelemetryExport() {
  try {
    const main = require.resolve('@coinbase/agentkit');
    const file = path.join(path.dirname(main), 'analytics', 'sendAnalyticsEvent.js');
    const mod = require(file); // absolute path bypasses the package "exports" restriction
    if (mod && typeof mod.sendAnalyticsEvent === 'function') {
      mod.sendAnalyticsEvent = async () => {};
      return true;
    }
  } catch (err) {
    logger.warn(`AgentKit telemetry export patch skipped: ${err.message}`);
  }
  return false;
}

/** Layer 2: short-circuit only the analytics host at the fetch layer; pass everything else through. */
function patchGlobalFetch() {
  if (typeof globalThis.fetch !== 'function' || globalThis.__agentkitTelemetryFetchPatched) return false;
  const original = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes(ANALYTICS_HOST)) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return original.call(this, input, init);
  };
  globalThis.__agentkitTelemetryFetchPatched = true;
  return true;
}

export function disableAgentKitTelemetry() {
  const exportPatched = patchTelemetryExport();
  const fetchPatched = patchGlobalFetch();
  if (exportPatched || fetchPatched) {
    logger.info(`AgentKit telemetry disabled (export=${exportPatched}, fetch=${fetchPatched})`);
    return true;
  }
  logger.warn('AgentKit telemetry could not be disabled — relying on the global unhandledRejection guard');
  return false;
}

export default disableAgentKitTelemetry;
