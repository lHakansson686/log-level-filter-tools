import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LogLevelFilter, Level, nameToLevel, levelToName } from '../src/index.js';

describe('Level constants', () => {
  it('defines the five conventional severities with increasing integer values', () => {
    assert.equal(Level.TRACE, 10);
    assert.equal(Level.DEBUG, 20);
    assert.equal(Level.INFO, 30);
    assert.equal(Level.WARN, 40);
    assert.equal(Level.ERROR, 50);
    // Ordered: each is strictly greater than the last, so >= comparisons are stable.
    assert.ok(Level.TRACE < Level.DEBUG);
    assert.ok(Level.DEBUG < Level.INFO);
    assert.ok(Level.INFO < Level.WARN);
    assert.ok(Level.WARN < Level.ERROR);
  });

  it('is frozen so callers cannot mutate the constants', () => {
    assert.ok(Object.isFrozen(Level));
  });
});

describe('nameToLevel', () => {
  it('maps lowercase names to their integer values', () => {
    assert.equal(nameToLevel('trace'), Level.TRACE);
    assert.equal(nameToLevel('debug'), Level.DEBUG);
    assert.equal(nameToLevel('info'), Level.INFO);
    assert.equal(nameToLevel('warn'), Level.WARN);
    assert.equal(nameToLevel('error'), Level.ERROR);
  });

  it('is case-insensitive', () => {
    assert.equal(nameToLevel('INFO'), Level.INFO);
    assert.equal(nameToLevel('Warn'), Level.WARN);
    assert.equal(nameToLevel('ERROR'), Level.ERROR);
  });

  it('returns null for unknown names', () => {
    assert.equal(nameToLevel('fatal'), null);
    assert.equal(nameToLevel('verbose'), null);
    assert.equal(nameToLevel(''), null);
  });

  it('returns null for non-string input rather than throwing', () => {
    assert.equal(nameToLevel(null), null);
    assert.equal(nameToLevel(undefined), null);
    assert.equal(nameToLevel(30), null);
    assert.equal(nameToLevel({}), null);
  });

  it('is not fooled by prototype-pollution-style names', () => {
    // "constructor" would resolve to Object.prototype.constructor if we used a
    // plain object with `in`; the null-prototype map prevents that.
    assert.equal(nameToLevel('constructor'), null);
    assert.equal(nameToLevel('__proto__'), null);
    assert.equal(nameToLevel('toString'), null);
  });
});

describe('levelToName', () => {
  it('round-trips every defined level back to its canonical lowercase name', () => {
    assert.equal(levelToName(Level.TRACE), 'trace');
    assert.equal(levelToName(Level.DEBUG), 'debug');
    assert.equal(levelToName(Level.INFO), 'info');
    assert.equal(levelToName(Level.WARN), 'warn');
    assert.equal(levelToName(Level.ERROR), 'error');
  });

  it('returns null for non-integer or out-of-range values', () => {
    assert.equal(levelToName(0), null);
    assert.equal(levelToName(15), null);
    assert.equal(levelToName(60), null);
    assert.equal(levelToName(30.5), null);
    assert.equal(levelToName(NaN), null);
    assert.equal(levelToName('30'), null);
    assert.equal(levelToName(null), null);
  });
});

describe('LogLevelFilter basic gating', () => {
  it('defaults to INFO so a fresh filter is neither silent nor noisy', () => {
    const f = new LogLevelFilter();
    assert.equal(f.defaultLevel, Level.INFO);
    assert.equal(f.shouldLog('app', Level.TRACE), false);
    assert.equal(f.shouldLog('app', Level.DEBUG), false);
    assert.equal(f.shouldLog('app', Level.INFO), true);
    assert.equal(f.shouldLog('app', Level.WARN), true);
    assert.equal(f.shouldLog('app', Level.ERROR), true);
  });

  it('allows a custom default in the constructor', () => {
    const f = new LogLevelFilter(Level.DEBUG);
    assert.equal(f.shouldLog('app', Level.TRACE), false);
    assert.equal(f.shouldLog('app', Level.DEBUG), true);
    assert.equal(f.shouldLog('app', Level.INFO), true);
  });

  it('threshold is inclusive: setting INFO lets INFO through', () => {
    const f = new LogLevelFilter();
    assert.equal(f.shouldLog('x', Level.INFO), true);
  });

  it('rejects non-integer constructor default with a TypeError', () => {
    assert.throws(() => new LogLevelFilter('info'), TypeError);
    assert.throws(() => new LogLevelFilter(30.5), TypeError);
    assert.throws(() => new LogLevelFilter(null), TypeError);
  });
});

describe('LogLevelFilter namespace thresholds', () => {
  it('a parent threshold applies to descendants', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('app', Level.WARN);
    assert.equal(f.shouldLog('app', Level.INFO), false);
    assert.equal(f.shouldLog('app.db', Level.INFO), false);
    assert.equal(f.shouldLog('app.db.pool', Level.INFO), false);
    assert.equal(f.shouldLog('app.db.pool', Level.WARN), true);
    assert.equal(f.shouldLog('app.db.pool', Level.ERROR), true);
  });

  it('a more specific threshold overrides the parent for that subtree', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('app', Level.WARN);
    f.setThreshold('app.db', Level.TRACE);
    assert.equal(f.shouldLog('app', Level.INFO), false);
    assert.equal(f.shouldLog('app.web', Level.INFO), false);
    assert.equal(f.shouldLog('app.db', Level.TRACE), true);
    assert.equal(f.shouldLog('app.db.pool', Level.TRACE), true);
  });

  it('unrelated namespaces fall back to the default', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('app', Level.WARN);
    assert.equal(f.shouldLog('other', Level.INFO), true);
    assert.equal(f.shouldLog('other.deep', Level.INFO), true);
  });

  it('getEffectiveLevel mirrors the resolution that shouldLog uses', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('app', Level.WARN);
    f.setThreshold('app.db', Level.TRACE);
    assert.equal(f.getEffectiveLevel('app.db.pool'), Level.TRACE);
    assert.equal(f.getEffectiveLevel('app.web'), Level.WARN);
    assert.equal(f.getEffectiveLevel('other'), Level.INFO);
  });
});

describe('LogLevelFilter root namespace handling', () => {
  it('setThreshold with empty string acts as the default for all namespaces', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('', Level.ERROR);
    assert.equal(f.shouldLog('app', Level.WARN), false);
    assert.equal(f.shouldLog('app', Level.ERROR), true);
    assert.equal(f.shouldLog('anything.here', Level.ERROR), true);
  });

  it('a namespace threshold still overrides the root threshold', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('', Level.ERROR);
    f.setThreshold('app', Level.DEBUG);
    assert.equal(f.shouldLog('app', Level.DEBUG), true);
    assert.equal(f.shouldLog('app', Level.INFO), true);
    assert.equal(f.shouldLog('other', Level.WARN), false);
    assert.equal(f.shouldLog('other', Level.ERROR), true);
  });
});

describe('LogLevelFilter namespace normalisation', () => {
  it('collapses repeated dots within a namespace', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('app..db', Level.ERROR);
    // "app..db" is stored as "app.db", so this threshold should apply.
    assert.equal(f.shouldLog('app.db', Level.WARN), false);
    assert.equal(f.shouldLog('app.db', Level.ERROR), true);
    // And the descendant too.
    assert.equal(f.shouldLog('app.db.pool', Level.ERROR), true);
  });

  it('strips leading dots from the namespace', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('.app', Level.WARN);
    assert.equal(f.shouldLog('app', Level.INFO), false);
    assert.equal(f.shouldLog('app', Level.WARN), true);
  });

  it('trims surrounding whitespace before normalising', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('  app.db  ', Level.ERROR);
    assert.equal(f.shouldLog('app.db', Level.WARN), false);
    assert.equal(f.shouldLog('app.db', Level.ERROR), true);
  });

  it('shouldLog with a namespace containing repeated dots still resolves', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('app.db', Level.ERROR);
    // shouldLog does NOT normalise the query namespace (only setThreshold does),
    // so "app..db" is treated as its own namespace "app..db". With no threshold
    // set for that exact string, it falls back to the default INFO.
    assert.equal(f.shouldLog('app..db', Level.INFO), true);
  });
});

describe('LogLevelFilter input validation', () => {
  it('setThreshold throws TypeError on non-string namespace', () => {
    const f = new LogLevelFilter();
    assert.throws(() => f.setThreshold(123, Level.WARN), TypeError);
    assert.throws(() => f.setThreshold(null, Level.WARN), TypeError);
    assert.throws(() => f.setThreshold(undefined, Level.WARN), TypeError);
  });

  it('setThreshold throws TypeError on non-integer level', () => {
    const f = new LogLevelFilter();
    assert.throws(() => f.setThreshold('app', 'info'), TypeError);
    assert.throws(() => f.setThreshold('app', 30.5), TypeError);
    assert.throws(() => f.setThreshold('app', null), TypeError);
  });

  it('shouldLog returns false for invalid inputs rather than throwing', () => {
    // shouldLog is on the logging hot path; it must not throw on garbage input.
    const f = new LogLevelFilter();
    assert.equal(f.shouldLog(null, Level.INFO), false);
    assert.equal(f.shouldLog(undefined, Level.INFO), false);
    assert.equal(f.shouldLog(123, Level.INFO), false);
    assert.equal(f.shouldLog('app', 'info'), false);
    assert.equal(f.shouldLog('app', 30.5), false);
    assert.equal(f.shouldLog('app', null), false);
  });

  it('getEffectiveLevel returns the default for invalid namespace input', () => {
    const f = new LogLevelFilter(Level.WARN);
    assert.equal(f.getEffectiveLevel(null), Level.WARN);
    assert.equal(f.getEffectiveLevel(undefined), Level.WARN);
    assert.equal(f.getEffectiveLevel(123), Level.WARN);
  });
});

describe('LogLevelFilter clearThreshold', () => {
  it('removes a specific threshold so descendants fall back', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('app', Level.WARN);
    f.setThreshold('app.db', Level.TRACE);
    assert.equal(f.shouldLog('app.db', Level.TRACE), true);

    const removed = f.clearThreshold('app.db');
    assert.equal(removed, true);
    assert.equal(f.shouldLog('app.db', Level.TRACE), false);
    // Now inherits from "app" which is WARN.
    assert.equal(f.shouldLog('app.db', Level.WARN), true);
  });

  it('returns false when clearing a namespace that was never set', () => {
    const f = new LogLevelFilter();
    assert.equal(f.clearThreshold('never.set'), false);
  });

  it('clearing the root threshold resets the default to INFO', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('', Level.ERROR);
    assert.equal(f.shouldLog('app', Level.WARN), false);

    const removed = f.clearThreshold('');
    assert.equal(removed, true);
    // Root clear is the one place we reset defaultLevel to INFO.
    assert.equal(f.defaultLevel, Level.INFO);
    assert.equal(f.shouldLog('app', Level.WARN), true);
  });

  it('clearing the root when it was never explicitly set resets the default to INFO', () => {
    const f = new LogLevelFilter(Level.DEBUG);
    assert.equal(f.clearThreshold(''), false);
    // Root clear always resets defaultLevel to INFO, even when no root threshold
    // was explicitly set.
    assert.equal(f.defaultLevel, Level.INFO);
  });

  it('clearThreshold returns false for non-string input', () => {
    const f = new LogLevelFilter();
    assert.equal(f.clearThreshold(null), false);
    assert.equal(f.clearThreshold(123), false);
  });
});

describe('LogLevelFilter clearAll', () => {
  it('removes every namespace threshold but preserves the default level', () => {
    const f = new LogLevelFilter(Level.ERROR);
    f.setThreshold('app', Level.TRACE);
    f.setThreshold('app.db', Level.DEBUG);
    f.setThreshold('web', Level.WARN);

    f.clearAll();

    assert.equal(f.shouldLog('app', Level.TRACE), false);
    assert.equal(f.shouldLog('app', Level.ERROR), true);
    assert.equal(f.shouldLog('app.db', Level.DEBUG), false);
    assert.equal(f.shouldLog('web', Level.WARN), false);
    // default unchanged
    assert.equal(f.defaultLevel, Level.ERROR);
  });

  it('clearAll followed by setting a fresh threshold works cleanly', () => {
    const f = new LogLevelFilter();
    f.setThreshold('app', Level.ERROR);
    f.clearAll();
    f.setThreshold('app', Level.DEBUG);
    assert.equal(f.shouldLog('app', Level.DEBUG), true);
    assert.equal(f.shouldLog('app', Level.TRACE), false);
  });
});

describe('LogLevelFilter setDefault', () => {
  it('changes the fallback threshold', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setDefault(Level.ERROR);
    assert.equal(f.defaultLevel, Level.ERROR);
    assert.equal(f.shouldLog('app', Level.WARN), false);
    assert.equal(f.shouldLog('app', Level.ERROR), true);
  });

  it('throws TypeError on non-integer input', () => {
    const f = new LogLevelFilter();
    assert.throws(() => f.setDefault('info'), TypeError);
    assert.throws(() => f.setDefault(30.5), TypeError);
    assert.throws(() => f.setDefault(null), TypeError);
  });

  it('does not affect existing namespace-specific thresholds', () => {
    const f = new LogLevelFilter(Level.INFO);
    f.setThreshold('app', Level.TRACE);
    f.setDefault(Level.ERROR);
    assert.equal(f.shouldLog('app', Level.TRACE), true);
    assert.equal(f.shouldLog('other', Level.WARN), false);
    assert.equal(f.shouldLog('other', Level.ERROR), true);
  });
});
