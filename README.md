# log-level-filter-tools

A small, zero-dependency hierarchical log-level filter: decide whether a message at a given severity should propagate, with runtime-tunable thresholds per namespace.

## Usage

```js
import { LogLevelFilter, Level, nameToLevel } from 'log-level-filter-tools';

const filter = new LogLevelFilter();             // defaults to INFO
filter.setThreshold('app', Level.WARN);        // quiet the whole app subtree
filter.setThreshold('app.db', Level.TRACE);    // except the DB layer

filter.shouldLog('app.web', Level.INFO);        // false  (app -> WARN)
filter.shouldLog('app.db.pool', Level.TRACE);   // true   (app.db -> TRACE)

// Read thresholds from text config safely.
const level = nameToLevel(process.env.LOG_LEVEL ?? 'info');
if (level !== null) filter.setDefault(level);
```

## Why this exists

Most logging libraries bundle their own filtering, but the filtering is welded to their logger implementation. This library provides just the gate logic so you can plug it into whatever transport, formatter, or sink you already use. The trade-off: you get a focused, inspectable filter at the cost of doing your own message formatting and I/O.

Levels are five fixed integer constants (`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`) rather than a configurable set. Every flexible level system I have used has devolved into teams disagreeing about whether `DEBUG` or `DETAIL` is lower. Five levels, integer constants, done.

## The awkward edge

`clearThreshold('')` — clearing the root threshold — resets the default level to `INFO`. This is the one spot where the library makes an opinionated reset choice rather than preserving previous state, because there is no reliable "previous default" to restore once the root has been overwritten. Call `setDefault()` afterwards if you need a different baseline.

Namespace queries passed to `shouldLog` are **not** normalised: `shouldLog('app..db', ...)` is treated as the literal namespace `app..db`, not `app.db`. Only `setThreshold` normalises (collapsing repeated dots and stripping leading dots). This keeps the hot path simple and predictable.
