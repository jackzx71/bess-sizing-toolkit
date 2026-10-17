# bess-sizing-toolkit

Dependency-free sizing and ROI math for **LiFePO4 battery energy storage**, written for people who have to defend the number in a proposal.

Most battery calculators return a single figure. This one returns the **intermediate steps**, so an engineer, a customer or a reviewer can see exactly how the number was produced — and where the usual assumptions break.

```bash
npm test        # 16 tests, no dependencies
```

## Why this exists

Three corrections are missing from most sizing guides, and each one changes the answer materially:

| Correction | What gets skipped | Consequence |
|---|---|---|
| **Depth of discharge by chemistry** | LFP is sized at 80%, lead-acid at 50% | Running lead-acid at 80% DoD roughly halves cycle life |
| **Temperature derating** | Usable capacity changes away from rated temperature | An "8-hour" battery becomes a 6-hour battery at -20 C |
| **Rounding to a buildable size** | 26.3 kWh is a calculation, not a product | Proposals quote sizes that cannot be shipped |

## Install

Zero dependencies. Drop the file in, or:

```bash
npm install bess-sizing-toolkit
```

```js
const BESS = require("bess-sizing-toolkit");
// or, in the browser: <script src="src/bess-sizing.js"></script> -> window.BESS
```

## API

### `sizeBatteryCapacity(input)`

| Field | Type | Default | Notes |
|---|---|---|---|
| `loadKw` | number | — | Continuous load, **required** |
| `backupHours` | number | — | Required autonomy, **required** |
| `efficiency` | number | `0.95` | Round-trip, incl. inverter + charging losses |
| `dod` | number | `0.8` | LFP 0.8 · lead-acid 0.5 · high-cycling LFP 0.9 |
| `temperatureFactor` | number | `1` | Capacity derate, <= 1 (approx 0.85 at -20 C for LFP) |
| `stepKwh` | number | `5` | Buildable module granularity |

```js
const r = BESS.sizeBatteryCapacity({
  loadKw: 5, backupHours: 4, efficiency: 0.95, dod: 0.8
});

r.nominalKwh;    // 26.32  <- calculation
r.buildableKwh;  // 30     <- what you can actually ship
r.inverterKw;    // 6      <- 1.2x headroom over continuous load
r.steps;         // every intermediate value, with the formula used
r.warnings;      // chemistry, derate and rounding sanity checks
```

### `estimateSolarYield(input)`

```js
BESS.estimateSolarYield({
  kwp: 10, peakSunHours: 4.0, pr: 0.8,
  degradation: 0.02, years: 10,
  tariff: 0.65, selfConsumption: 1.0
});
// annualKwh 11680 - monthlyKwh 973 - equivalentFullLoadHours 1168
// annualSaving 7592 - cumulativeKwh 106829
```

Typical peak sun hours: central Russia 3-3.5 · Southeast Asia 4.5-5.5 · Middle East 5.5-6.5 · Southern Europe 4.5-5.5. Verify local figures against **PVGIS** or **NASA POWER** before committing to a number.

### `estimateStoragePayback(input)`

```js
BESS.estimateStoragePayback({ capacityKwh: 200, tariffSpread: 0.75, capex: 260000 });
// dailySaving 114 - annualSaving 41610 - paybackYears 6.25
```

`tariffSpread` is the peak price minus the valley price. Omit `capex` and payback is skipped rather than guessed.

### `assessStorageNeed(input)`

Encodes the commercial rule of thumb — `daytime load / annual PV generation`:

| Ratio | Verdict |
|---|---|
| >= 0.60 | `storage-not-required` |
| 0.40 - 0.60 | `storage-optional` — shiftable loads may be cheaper than batteries |
| < 0.40 | `storage-likely-viable` |

## Validation

All inputs are validated. Invalid ranges throw immediately rather than returning a plausible-looking wrong answer:

```js
BESS.sizeBatteryCapacity({ loadKw: 5, backupHours: 4, dod: 1.4 });   // RangeError
BESS.estimateStoragePayback({ capacityKwh: 200, tariffSpread: 0 }); // RangeError
```

## Live demo

`demo/index.html` is a dependency-free browser demo with the three calculators and step-by-step output. Open it directly — no build step.

## Scope

This library does **arithmetic only**. It does not model demand-charge optimisation, demand-response incentives, degradation curves, financing, or grid-code compliance. Static payback is a screening tool, not a financial model.

## License

MIT