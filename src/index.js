/**
 * index.js — public entry point for log-level-filter-tools.
 *
 * Re-exports the filtering engine and the Level constants. We keep the public
 * surface narrow on purpose: anything not exported here is an internal detail
 * and may change between versions.
 */
export { LogLevelFilter, Level, nameToLevel, levelToName } from './core.js';
