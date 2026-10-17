/**
 * bess-sizing-toolkit — dependency-free sizing & ROI math for LFP energy storage.
 *
 * Design goals
 *  1. Every function returns the intermediate steps, not just a number.
 *     Anyone reviewing a proposal can see how the figure was produced.
 *  2. The three corrections most calculators omit are first-class inputs:
 *     chemistry-aware depth of discharge, temperature derating, and rounding
 *     up to a buildable module size.
 *  3. No dependencies, no network calls. Runs in Node and in the browser.
 *
 * @license MIT
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BESS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT = {
    inverterHeadroom: 1.2,   /* inverter sizing factor over continuous load */
    roundStepKwh: 5,        /* buildable module granularity */
    daysPerYear: 365,
    designDod: 0.8,         /* LFP design depth of discharge */
    systemEfficiency: 0.95, /* hybrid inverter + LFP round trip */
    roiDod: 0.8,
    roiEfficiency: 0.95
  };

  function num(v, name) {
    var n = typeof v === "number" ? v : parseFloat(v);
    if (typeof n !== "number" || !isFinite(n)) {
      throw new TypeError("Expected a finite number for `" + name + "`, received: " + v);
    }
    return n;
  }

  function positive(v, name) {
    var n = num(v, name);
    if (n <= 0) throw new RangeError("`" + name + "` must be greater than 0, received: " + n);
    return n;
  }

  function round(n, digits) {
    var f = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round(n * f) / f;
  }

  /**
   * Required battery capacity for backup / off-grid.
   *
   *   nominalKwh = loadKw × backupHours ÷ efficiency ÷ dod
   *   deratedKwh = nominalKwh ÷ temperatureFactor   (temperatureFactor ≤ 1)
   *   buildableKwh = ceil(deratedKwh / step) × step
   *
   * @param {object} input
   * @param {number} input.loadKw             Continuous load in kW
   * @param {number} input.backupHours        Required autonomy in hours
   * @param {number} [input.efficiency]       System round-trip efficiency, 0.90–0.97
   * @param {number} [input.dod]              Usable depth of discharge (LFP 0.8, lead-acid 0.5)
   * @param {number} [input.temperatureFactor] Capacity derate, 1 = rated temp; ≈0.85 at −20 °C for LFP
   * @param {number} [input.stepKwh]          Buildable module granularity
   */
  function sizeBatteryCapacity(input) {
    if (!input || typeof input !== "object") throw new TypeError("sizeBatteryCapacity requires an input object");

    var loadKw = positive(input.loadKw, "loadKw");
    var backupHours = positive(input.backupHours, "backupHours");
    var efficiency = num(input.efficiency === undefined ? DEFAULT.systemEfficiency : input.efficiency, "efficiency");
    var dod = num(input.dod === undefined ? DEFAULT.designDod : input.dod, "dod");
    var tempFactor = num(input.temperatureFactor === undefined ? 1 : input.temperatureFactor, "temperatureFactor");
    var step = num(input.stepKwh === undefined ? DEFAULT.roundStepKwh : input.stepKwh, "stepKwh");

    if (efficiency <= 0 || efficiency > 1) throw new RangeError("`efficiency` must be within (0, 1]");
    if (dod <= 0 || dod > 1) throw new RangeError("`dod` must be within (0, 1]");
    if (tempFactor <= 0 || tempFactor > 1) throw new RangeError("`temperatureFactor` must be within (0, 1]");

    var nominalKwh = loadKw * backupHours / efficiency / dod;
    var deratedKwh = nominalKwh / tempFactor;
    var buildableKwh = Math.ceil(deratedKwh / step) * step;
    var inverterKw = round(loadKw * DEFAULT.inverterHeadroom, 2);

    var steps = [
      { label: "Load energy", value: round(loadKw * backupHours, 2), unit: "kWh", formula: "loadKw x backupHours" },
      { label: "After efficiency losses", value: round(loadKw * backupHours / efficiency, 2), unit: "kWh", formula: "/ efficiency (" + efficiency + ")" },
      { label: "After depth of discharge", value: round(nominalKwh, 2), unit: "kWh", formula: "/ DoD (" + dod + ")" },
      { label: "After temperature derate", value: round(deratedKwh, 2), unit: "kWh", formula: "/ temperature factor (" + tempFactor + ")" },
      { label: "Buildable configuration", value: buildableKwh, unit: "kWh", formula: "round up to multiples of " + step + " kWh" },
      { label: "Inverter sizing", value: inverterKw, unit: "kW", formula: "loadKw x " + DEFAULT.inverterHeadroom }
    ];

    var warnings = [];
    if (dod > 0.8) warnings.push("DoD above 0.8 is rarely warranted; LFP cycle life drops sharply.");
    if (dod < 0.6) warnings.push("DoD below 0.6 suggests lead-acid chemistry and roughly half the usable energy.");
    if (tempFactor < 1) warnings.push("Cold derate applied (" + tempFactor + "): add margin for low-temperature sites.");
    if (buildableKwh / deratedKwh > 1.15) warnings.push("Rounded configuration exceeds the calculation by more than 15%.");
    if (loadKw * backupHours > 500) warnings.push("System above 500 kWh: consider containerised BESS and a site engineering review.");

    return {
      nominalKwh: round(nominalKwh, 2),
      deratedKwh: round(deratedKwh, 2),
      buildableKwh: buildableKwh,
      inverterKw: inverterKw,
      steps: steps,
      warnings: warnings
    };
  }

  /**
   * Annual PV yield and self-consumption value.
   *
   *   annualKwh = kwp × peakSunHours × 365 × pr
   *
   * @param {object} input
   * @param {number} input.kwp
   * @param {number} input.peakSunHours  Daily peak sun hours (central Russia 3–3.5, SE Asia 4.5–5.5, Middle East 5.5–6.5)
   * @param {number} [input.pr=0.8]      Performance ratio
   * @param {number} [input.degradation=0.02] First-year degradation, decimal
   * @param {number} [input.years=10]
   * @param {number} [input.tariff]      Price per kWh
   * @param {number} [input.selfConsumption=1]
   */
  function estimateSolarYield(input) {
    var kwp = positive(input.kwp, "kwp");
    var sun = positive(input.peakSunHours, "peakSunHours");
    var pr = num(input.pr === undefined ? 0.8 : input.pr, "pr");
    var deg = num(input.degradation === undefined ? 0.02 : input.degradation, "degradation");
    var years = num(input.years === undefined ? 10 : input.years, "years");
    var tariff = num(input.tariff === undefined ? 0 : input.tariff, "tariff");
    var self = num(input.selfConsumption === undefined ? 1 : input.selfConsumption, "selfConsumption");

    if (pr <= 0 || pr > 1) throw new RangeError("`pr` must be within (0, 1]");
    if (self < 0 || self > 1) throw new RangeError("`selfConsumption` must be within [0, 1]");

    var annualKwh = kwp * sun * DEFAULT.daysPerYear * pr;
    var cumulativeKwh = 0;
    for (var i = 0; i < years; i++) cumulativeKwh += annualKwh * Math.pow(1 - deg, i);

    var warnings = [];
    if (sun > 7) warnings.push("Peak sun hours above 7 is unusual; verify the source (PVGIS or NASA POWER).");
    if (sun < 2.5) warnings.push("Peak sun hours below 2.5: check snow cover, shading or a wrong dataset.");
    if (pr < 0.7) warnings.push("PR below 0.70 points to heavy soiling, shading or undersized cable runs.");
    if (self < 0.5) warnings.push("Self-consumption below 50%: a load-shifting or storage decision matters more than PV capacity.");

    return {
      annualKwh: round(annualKwh, 0),
      monthlyKwh: round(annualKwh / 12, 0),
      equivalentFullLoadHours: round(sun * DEFAULT.daysPerYear * pr, 0),
      annualSaving: round(annualKwh * self * tariff, 2),
      cumulativeKwh: round(cumulativeKwh, 0),
      years: years,
      steps: [
        { label: "Annual generation", value: round(annualKwh, 0), unit: "kWh", formula: "kwp x peakSunHours x 365 x pr" },
        { label: "Equivalent full-load hours", value: round(sun * DEFAULT.daysPerYear * pr, 0), unit: "h", formula: "peakSunHours x 365 x pr" },
        { label: "Annual bill value", value: round(annualKwh * self * tariff, 2), unit: "", formula: "annualKwh x selfConsumption x tariff" },
        { label: "Cumulative over " + years + " years", value: round(cumulativeKwh, 0), unit: "kWh", formula: "sum of annualKWh x (1 - degradation)^n" }
      ],
      warnings: warnings
    };
  }

  /**
   * C&I storage revenue and static payback from a peak/valley tariff spread.
   *
   *   dailySaving = capacityKwh × dod × tariffSpread × efficiency
   *
   * @param {object} input
   * @param {number} input.capacityKwh
   * @param {number} input.tariffSpread  Peak minus valley price per kWh
   * @param {number} [input.capex]      Total installed cost; omit to skip payback
   * @param {number} [input.dod=0.8]
   * @param {number} [input.efficiency=0.95]
   * @param {number} [input.days=365]
   */
  function estimateStoragePayback(input) {
    var kwh = positive(input.capacityKwh, "capacityKwh");
    var spread = num(input.tariffSpread, "tariffSpread");
    var dod = num(input.dod === undefined ? DEFAULT.roiDod : input.dod, "dod");
    var eff = num(input.efficiency === undefined ? DEFAULT.roiEfficiency : input.efficiency, "efficiency");
    var days = num(input.days === undefined ? DEFAULT.daysPerYear : input.days, "days");
    var capex = (input.capex === undefined || input.capex === null || input.capex === "") ? null : num(input.capex, "capex");

    if (spread <= 0) throw new RangeError("`tariffSpread` must be greater than 0 (peak price minus valley price)");
    if (dod <= 0 || dod > 1) throw new RangeError("`dod` must be within (0, 1]");

    var daily = kwh * dod * spread * eff;
    var annual = daily * days;
    var paybackYears = (capex !== null && annual > 0) ? capex / annual : null;

    var warnings = [
      "Excludes demand-charge savings, demand-response incentives and battery degradation."
    ];
    if (paybackYears !== null && paybackYears > 8) warnings.push("Static payback above 8 years needs a wider local price spread or additional revenue streams.");
    if (spread > 2) warnings.push("Tariff spread above 2 is unusual; double-check the peak and valley periods.");

    return {
      dailySaving: round(daily, 2),
      annualSaving: round(annual, 2),
      tenYearSaving: round(annual * 10, 2),
      paybackYears: paybackYears === null ? null : round(paybackYears, 2),
      capex: capex,
      steps: [
        { label: "Daily arbitrage saving", value: round(daily, 2), unit: "", formula: "capacityKwh x dod x tariffSpread x efficiency" },
        { label: "Annual saving", value: round(annual, 2), unit: "", formula: "daily x " + days + " days" },
        { label: "Static payback", value: paybackYears === null ? "capex required" : round(paybackYears, 2), unit: "years", formula: "capex / annualSaving" }
      ],
      warnings: warnings
    };
  }

  /**
   * Does this PV + storage combination hold up? Encodes the ratio rule of thumb
   * used in commercial practice.
   *
   * @param {object} input
   * @param {number} input.daytimeLoadKwh  Daytime consumption of the site
   * @param {number} input.pvAnnualKwh     Annual PV generation
   */
  function assessStorageNeed(input) {
    var daytimeLoadKwh = num(input.daytimeLoadKwh, "daytimeLoadKwh");
    var pvAnnualKwh = positive(input.pvAnnualKwh, "pvAnnualKwh");
    var ratio = daytimeLoadKwh / pvAnnualKwh;

    var verdict, recommendation;
    if (ratio >= 0.6) {
      verdict = "storage-not-required";
      recommendation = "Daytime load already absorbs most of the generation; storage will rarely pay for itself.";
    } else if (ratio >= 0.4) {
      verdict = "storage-optional";
      recommendation = "Shiftable loads (water heating, HVAC pre-cooling, EV charging) may cover the gap more cheaply than batteries.";
    } else {
      verdict = "storage-likely-viable";
      recommendation = "Large export ratio: storage or extra PV capacity is worth pricing.";
    }

    return {
      ratio: round(ratio, 3),
      verdict: verdict,
      recommendation: recommendation,
      steps: [
        { label: "Self-consumption ratio", value: round(ratio, 3), unit: "", formula: "daytimeLoadKwh / pvAnnualKwh" }
      ],
      warnings: []
    };
  }

  return {
    DEFAULT: DEFAULT,
    sizeBatteryCapacity: sizeBatteryCapacity,
    estimateSolarYield: estimateSolarYield,
    estimateStoragePayback: estimateStoragePayback,
    assessStorageNeed: assessStorageNeed,
    _internal: { round: round }
  };
});