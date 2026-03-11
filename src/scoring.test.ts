import { describe, expect, it } from "vitest";
import {
  SCORING_CONFIG,
  buildInvestigationHypothesis,
  calculatePriorityScore,
  classifyInvestigationProfile,
  getInvestigationContribution,
  getInvestigationScoreByLens,
  getPriorityLabel,
  getPriorityToneClass,
  getQuadrantColor,
} from "./scoring";

describe("scoring", () => {
  it("calculates the composite priority score from centralized weights", () => {
    expect(
      calculatePriorityScore({
        offerGapIndex: 1,
        pressureIndex: 0,
        impactIndex: 0,
      }),
    ).toBeCloseTo(SCORING_CONFIG.priorityWeights.offer_gap * 100);
    expect(
      calculatePriorityScore({
        offerGapIndex: 0,
        pressureIndex: 1,
        impactIndex: 0,
      }),
    ).toBeCloseTo(SCORING_CONFIG.priorityWeights.pressure * 100);
  });

  it("classifies high offer gap and high pressure as critical under-equipment", () => {
    expect(classifyInvestigationProfile(0.7, 0.7, 0.5)).toBe("Sous-équipement sous tension");
  });

  it("builds a coverage-focused hypothesis when the territory has many contributing communes without a basin", () => {
    expect(
      buildInvestigationHypothesis({
        profile: "Sous-équipement sous tension",
        bassinsPour100kHab: 3,
        licencesFfnParBassin: 90,
        licencesFfnPour1000Hab: 4,
        licencesFfnPour100M2: 8,
        communesSansBassinVolume: 30,
        communesSansBassinShare: 0.2,
        qpvPopulation: 2000,
        qpvShare: 0.02,
        surfaceM2Pour1000Hab: 6,
      }),
    ).toContain("déficit de couverture structurant");
  });

  it("builds a saturation hypothesis when usage pressure crosses the configured threshold", () => {
    expect(
      buildInvestigationHypothesis({
        profile: "Tension d'usage",
        bassinsPour100kHab: 8,
        licencesFfnParBassin: 125,
        licencesFfnPour1000Hab: 5,
        licencesFfnPour100M2: 11,
        communesSansBassinVolume: 8,
        communesSansBassinShare: 0.14,
        qpvPopulation: 3000,
        qpvShare: 0.04,
        surfaceM2Pour1000Hab: 12,
      }),
    ).toContain("saturation des bassins");
  });

  it("maps lens and contribution helpers to the centralized weights", () => {
    const item = {
      offerGapIndex: 0.61,
      pressureIndex: 0.48,
      impactIndex: 0.3,
      priorityScore: 52,
    };

    expect(getInvestigationScoreByLens(item, "offer_gap")).toBeCloseTo(61);
    expect(getInvestigationContribution(61, "offer_gap")).toBeCloseTo(
      61 * SCORING_CONFIG.priorityWeights.offer_gap,
    );
  });

  it("derives tone, label, and quadrant color from configured thresholds", () => {
    expect(getPriorityToneClass(72)).toBe("priority-high");
    expect(getPriorityLabel(60)).toBe("À investiguer");
    expect(getQuadrantColor({ offerGapIndex: 0.7, pressureIndex: 0.7 })).toBe("#ff8f5c");
  });
});
