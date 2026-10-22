/**
 * core.js — the filtering engine for log-level-filter-tools.
 *
 * Levels are plain integers so comparisons are O(1) and there is no string parsing
 * on the hot path. We deliberately use a fixed level set rather than letting callers
 * invent their own — every "flexible" level system I have used has devolved into
 * teams disagreeing about whether DEBUG or DETAIL is lower. Five levels, integer
 * constants, done.
 */

/**
 * Numeric severity levels. Higher number = more severe.
 * These values are stable and part of the public API; callers may persist them.
 *
 * @enum {number}
 */
export const Level = Object.freeze({
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
});

/**
 * Ordered names, lowest severity first. Used by nameToLevel for the reverse lookup.
 * Kept as a module-level constant so we are not rebuilding an object on every call.
 */
const LEVEL_NAMES = Object.freeze([
  ['trace', Level.TRACE],
  ['debug', Level.DEBUG],
  ['info', Level.INFO],
  ['warn', Level.WARN],
  ['error', Level.ERROR],
]);

/** @type {Record<string, number>} */
const nameToLevelMap = Object.freeze(
  LEVEL_NAMES.reduce((acc, [name, val]) => {
    acc[name] = val;
    return acc;
  }, Object.create(null))
);

/**
 * Convert a level name to its numeric value.
 *
 * Matching is case-insensitive — log config files are commonly written in either
 * casing and rejecting "INFO" when the map has "info" is a papercut we can avoid.
 * Anything not in the fixed set returns `null`; the caller decides how to surface that.
 *
 * @param {string} name
 * @returns {number|null}
 */
export function nameToLevel(name) {
  if (typeof name !== 'string') return null;
  const key = name.toLowerCase();
  // hasOwnProperty via the null-prototype object, so no risk of "constructor" collisions.
  return Object.prototype.hasOwnProperty.call(nameToLevelMap, key)
    ? nameToLevelMap[key]
    : null;
}

/**
 * Convert a numeric level back to its canonical name.
 *
 * Returns `null` for unknown integers rather than throwing, because threshold configs
 * are often read from files and a bad value should not crash the logging path.
 *
 * @param {number} level
 * @returns {string|null}
 */
export function levelToName(level) {
  if (typeof level !== 'number' || !Number.isInteger(level)) return null;
  for (let i = 0; i < LEVEL_NAMES.length; i++) {
    if (LEVEL_NAMES[i][1] === level) return LEVEL_NAMES[i][0];
  }
  return null;
}

/**
 * A hierarchical log-level filter.
 *
 * Namespaces are dot-separated (e.g. `app.db.pool`). A threshold set on `app.db`
 * applies to `app.db.pool` unless a more specific threshold overrides it. This
 * mirrors how every popular logging framework namespaces its loggers, so operators
 * already understand the mental model.
 *
 * Threshold lookup walks up the namespace chain on every `shouldLog` call. For
 * the volumes a logging filter handles (thousands of calls/sec, not millions)
 * this is cheaper than maintaining a per-namespace resolved-threshold cache that
 * must be invalidated on every `setThreshold`. If profiling later shows lookup is
 * hot, the cache can be added behind the same public API.
 */
export class LogLevelFilter {
  /**
   * @param {number} [defaultLevel=Level.INFO] The threshold applied when no
   *   namespace-specific threshold matches. Defaulting to INFO means a fresh
   *   filter is not accidentally silent or accidentally noisy.
   */
  constructor(defaultLevel = Level.INFO) {
    // We validate the default even though callers are usually code, because a
    // bad default would silently make every shouldLog() return false.
    if (!Number.isInteger(defaultLevel)) {
      throw new TypeError(`defaultLevel must be an integer, got ${typeof defaultLevel}`);
    }
    this._defaultLevel = defaultLevel;
    /** @type {Map<string, number>} */
    this._thresholds = new Map();
  }

  /**
   * The fallback threshold used when no namespace match is found.
   * Exposed as a read-only getter so callers can display it without risking
   * a direct write that bypasses `setDefault`.
   *
   * @returns {number}
   */
  get defaultLevel() {
    return this._defaultLevel;
  }

  /**
   * Set the fallback threshold.
   * Throws on non-integer input — a bad default should fail loudly at the call
   * site, not silently in the middle of a request.
   *
   * @param {number} level
   * @returns {void}
   */
  setDefault(level) {
    if (!Number.isInteger(level)) {
      throw new TypeError(`level must be an integer, got ${typeof level}`);
    }
    this._defaultLevel = level;
  }

  /**
   * Set a threshold for a namespace. Applies to that namespace and all descendants
   * (dotted suffixes) unless overridden by a more specific setting.
   *
   * An empty string namespace is normalised to the root and is equivalent to
   * `setDefault`. This avoids a surprising special case where `''` is silently
   * ignored.
   *
   * @param {string} namespace
   * @param {number} level
   * @returns {void}
   */
  setThreshold(namespace, level) {
    if (typeof namespace !== 'string') {
      throw new TypeError(`namespace must be a string, got ${typeof namespace}`);
    }
    if (!Number.isInteger(level)) {
      throw new TypeError(`level must be an integer, got ${typeof level}`);
    }
    const ns = namespace.trim();
    if (ns === '') {
      // Treat root the same as the default; storing it under '' keeps the map
      // as the single source of truth and means clearThreshold('') works too.
      this._defaultLevel = level;
      this._thresholds.set('', level);
      return;
    }
    // Leading dots create ambiguity ("is .app a namespace called .app or a mistake?").
    // Rather than guess, we normalise them away so the behaviour is predictable.
    const cleaned = ns.replace(/^[.]+/, '').replace(/\.+/g, '.');
    this._thresholds.set(cleaned, level);
  }

  /**
   * Remove a threshold previously set with `setThreshold`.
   * Returns true if a threshold was actually removed, false if none existed.
   * After removal, descendants fall back to the next ancestor or the default.
   *
   * @param {string} namespace
   * @returns {boolean}
   */
  clearThreshold(namespace) {
    if (typeof namespace !== 'string') return false;
    const ns = namespace.trim();
    if (ns === '') {
      const had = this._thresholds.delete('');
      // We cannot know what the "previous" default was, so on root clear we
      // reset to INFO — the constructor default — rather than inventing a
      // value. This is the one spot where the library makes an opinionated
      // reset choice; it is documented in the README.
      this._defaultLevel = Level.INFO;
      return had;
    }
    const cleaned = ns.replace(/^[.]+/, '').replace(/\.+/g, '.');
    return this._thresholds.delete(cleaned);
  }

  /**
   * Remove all namespace thresholds. The default level is left untouched —
   * clearing thresholds is not the same as resetting the whole filter.
   *
   * @returns {void}
   */
  clearAll() {
    this._thresholds.clear();
    // Restore the root key if it was present, preserving defaultLevel — we
    // do NOT reset defaultLevel here because clearAll is about thresholds,
    // not configuration. Call setDefault() to change the default.
  }

  /**
   * Resolve the effective threshold for a namespace by walking up the chain.
   *
   * We walk from the most specific ancestor to the least, which is the inverse
   * of building the chain and iterating from the root. Doing it specific-first
   * means the first hit wins and we never evaluate less-specific entries once a
   * match is found.
   *
   * @param {string} namespace
   * @returns {number}
   * @private
   */
  _resolveLevel(namespace) {
    const ns = namespace.trim();
    if (ns === '') {
      // Root threshold if present, otherwise the default.
      return this._thresholds.has('') ? this._thresholds.get('') : this._defaultLevel;
    }
    // Build ancestor chains from most-specific to least-specific.
    // For "app.db.pool" that is: ["app.db.pool", "app.db", "app"].
    const parts = ns.split('.');
    for (let i = parts.length; i >= 1; i--) {
      const candidate = parts.slice(0, i).join('.');
      if (this._thresholds.has(candidate)) {
        return this._thresholds.get(candidate);
      }
    }
    // Root as the final ancestor.
    if (this._thresholds.has('')) {
      return this._thresholds.get('');
    }
    return this._defaultLevel;
  }

  /**
   * Return true if a message at `level` should be emitted for `namespace`.
   *
   * A message is allowed when its level is >= the effective threshold for the
   * namespace. Using >= (not >) means setting the threshold to INFO allows
   * INFO itself through — the common-sense reading of "threshold INFO".
   *
   * @param {string} namespace
   * @param {number} level
   * @returns {boolean}
   */
  shouldLog(namespace, level) {
    if (typeof namespace !== 'string') return false;
    if (typeof level !== 'number' || !Number.isInteger(level)) return false;
    const threshold = this._resolveLevel(namespace);
    return level >= threshold;
  }

  /**
   * Return the effective threshold for a namespace.
   *
   * Exposed so tooling can display "what threshold is active here?" without
   * probing via shouldLog.
   *
   * @param {string} namespace
   * @returns {number}
   */
  getEffectiveLevel(namespace) {
    if (typeof namespace !== 'string') return this._defaultLevel;
    return this._resolveLevel(namespace);
  }
}
