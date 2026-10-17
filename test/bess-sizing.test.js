/**
 * Test suite — run with:  node test/bess-sizing.test.js
 * No test framework required, so the repo stays dependency-free.
 */
"use strict";

var assert = require("assert");
var BESS = require("../src/bess-sizing.js");

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (err) {
    console.error("FAIL  " + name + "\n      " + err.message);
    process.exitCode = 1;
  }
}

console.log("\nsizeBatteryCapacity");

test("reference case: 5 kW, 4 h, 95% efficiency, 80% DoD", function () {
  var r = BESS.sizeBatteryCapacity({ loadKw: 5, backupHours: 4, efficiency: 0.95, dod: 0.8 });
  assert.strictEqual(r.nominalKwh, 26.32);
  assert.strictEqual(r.buildableKwh, 30);      /* rounded up to a 5 kWh step */
  assert.strictEqual(r.inverterKw, 6);        /* 1.2x headroom */
});

test("cold derate increases the buildable size", function () {
  var mild = BESS.sizeBatteryCapacity({ loadKw: 5, backupHours: 4 });
  var cold = BESS.sizeBatteryCapacity({ loadKw: 5, backupHours: 4, temperatureFactor: 0.85 });
  assert.ok(cold.deratedKwh > mild.deratedKwh);
  assert.ok(cold.buildableKwh >= mild.buildableKwh);
  assert.ok(cold.warnings.some(function (w) { return /derate/i.test(w); }));
});

test("lead-acid at 0.5 DoD needs roughly twice the nameplate", function () {
  var lfp = BESS.sizeBatteryCapacity({ loadKw: 5, backupHours: 4, dod: 0.8 });
  var lead = BESS.sizeBatteryCapacity({ loadKw: 5, backupHours: 4, dod: 0.5 });
  assert.ok(Math.abs(lead.nominalKwh / lfp.nominalKwh - 1.6) < 0.01);
});

test("rejects non-positive load", function () {
  assert.throws(function () { BESS.sizeBatteryCapacity({ loadKw: 0, backupHours: 4 }); }, RangeError);
});

test("rejects out-of-range depth of discharge", function () {
  assert.throws(function () { BESS.sizeBatteryCapacity({ loadKw: 5, backupHours: 4, dod: 1.4 }); }, RangeError);
});

test("rejects non-numeric input", function () {
  assert.throws(function () { BESS.sizeBatteryCapacity({ loadKw: "abc", backupHours: 4 }); }, TypeError);
});

test("returns an auditable step list", function () {
  var r = BESS.sizeBatteryCapacity({ loadKw: 5, backupHours: 4 });
  assert.ok(r.steps.length >= 5);
  assert.ok(r.steps.every(function (s) { return s.formula && "value" in s; }));
});

console.log("\nestimateSolarYield");

test("reference case: 10 kWp, 4.0 h, PR 0.80", function () {
  var r = BESS.estimateSolarYield({ kwp: 10, peakSunHours: 4.0, pr: 0.8 });
  assert.strictEqual(r.annualKwh, 11680);
  assert.strictEqual(r.equivalentFullLoadHours, 1168);
  assert.strictEqual(r.monthlyKwh, 973);
});

test("degradation reduces the 10-year cumulative below 10x annual", function () {
  var r = BESS.estimateSolarYield({ kwp: 10, peakSunHours: 4, degradation: 0.02 });
  assert.ok(r.cumulativeKwh < r.annualKwh * 10);
  assert.ok(r.cumulativeKwh > r.annualKwh * 9);
});

test("annual bill value scales with the self-consumption ratio", function () {
  var full = BESS.estimateSolarYield({ kwp: 10, peakSunHours: 4, tariff: 0.65, selfConsumption: 1 });
  var third = BESS.estimateSolarYield({ kwp: 10, peakSunHours: 4, tariff: 0.65, selfConsumption: 0.3 });
  assert.ok(Math.abs(full.annualSaving / third.annualSaving - 3.33) < 0.05);
});

test("warns on suspicious sun hours", function () {
  var r = BESS.estimateSolarYield({ kwp: 10, peakSunHours: 8 });
  assert.ok(r.warnings.length > 0);
});

console.log("\nestimateStoragePayback");

test("reference case: 200 kWh, spread 0.75, capex 260,000", function () {
  var r = BESS.estimateStoragePayback({ capacityKwh: 200, tariffSpread: 0.75, capex: 260000 });
  assert.strictEqual(r.dailySaving, 114);
  assert.strictEqual(r.annualSaving, 41610);
  assert.ok(Math.abs(r.paybackYears - 6.25) < 0.01);
});

test("omitting capex skips payback instead of failing", function () {
  var r = BESS.estimateStoragePayback({ capacityKwh: 200, tariffSpread: 0.75 });
  assert.strictEqual(r.paybackYears, null);
  assert.ok(/capex required/.test(String(r.steps[2].value)));
});

test("rejects a non-positive tariff spread", function () {
  assert.throws(function () {
    BESS.estimateStoragePayback({ capacityKwh: 200, tariffSpread: 0 });
  }, RangeError);
});

console.log("\nassessStorageNeed");

test("high daytime load means storage is not required", function () {
  var r = BESS.assessStorageNeed({ daytimeLoadKwh: 8000, pvAnnualKwh: 10000 });
  assert.strictEqual(r.verdict, "storage-not-required");
});

test("low daytime load means storage is worth pricing", function () {
  var r = BESS.assessStorageNeed({ daytimeLoadKwh: 2500, pvAnnualKwh: 10000 });
  assert.strictEqual(r.verdict, "storage-likely-viable");
});

console.log("\n" + passed + " tests passed" + (process.exitCode ? " (with failures)" : ""));