export type InvestigationLens = "priority" | "offer_gap" | "pressure" | "impact";
export type InvestigationComponentLens = Exclude<InvestigationLens, "priority">;
export type InvestigationIndexKey = "offerGapIndex" | "pressureIndex" | "impactIndex";

export interface InvestigationScoreDefinition {
  lens: InvestigationComponentLens;
  indexKey: InvestigationIndexKey;
  label: string;
  weight: number;
  description: string;
  metrics: string[];
}

export interface InvestigationCompositeInput {
  offerGapIndex: number;
  pressureIndex: number;
  impactIndex: number;
}

export interface InvestigationScoreSubject extends InvestigationCompositeInput {
  priorityScore: number;
}

export interface InvestigationHypothesisInput {
  profile: string;
  bassinsPour100kHab: number;
  licencesFfnParBassin: number;
  licencesFfnPour1000Hab: number;
  licencesFfnPour100M2: number;
  communesSansBassinVolume: number;
  communesSansBassinShare: number;
  qpvPopulation: number;
  qpvShare: number;
  surfaceM2Pour1000Hab: number;
}

export interface PriorityDriverInput {
  bassinsPour100kHab: number;
  licencesFfnParBassin: number;
  licencesFfnPour1000Hab: number;
  licencesFfnPour100M2: number;
  communesSansBassinVolume: number;
  communesSansBassinShare: number;
  population: number;
  licences: number;
  qpvPopulation: number;
  qpvShare: number;
}

// Centralize scoring thresholds so the model can evolve without searching magic
// numbers across rendering code.
export const SCORING_CONFIG = {
  priorityWeights: {
    offer_gap: 0.34,
    pressure: 0.38,
    impact: 0.28,
  } satisfies Record<InvestigationComponentLens, number>,
  quadrantThreshold: 60,
  priorityToneThresholds: {
    high: 70,
    medium: 58,
  },
  profileThresholds: {
    strongOfferGap: 0.62,
    strongPressure: 0.64,
    highPressure: 0.68,
    highImpact: 0.72,
    significantImpact: 0.68,
    watch: 0.5,
  },
  hypothesisThresholds: {
    highCoverageGapVolume: 25,
    highCoverageGapShare: 0.45,
    veryHighLicencesPer100M2: 16,
    veryHighLicencesPerBassin: 140,
    lowSurfacePer1000Hab: 7,
    lowBassinsPer100kHab: 4,
    highLicencesPer1000Hab: 6,
    highLicencesPerBassin: 120,
    elevatedQpvPopulation: 15000,
    elevatedQpvShare: 0.12,
    moderateQpvShare: 0.08,
  },
} as const;

export const INVESTIGATION_PRIORITY_WEIGHTS = SCORING_CONFIG.priorityWeights;
export const QUADRANT_THRESHOLD = SCORING_CONFIG.quadrantThreshold;

export function calculatePriorityScore({
  offerGapIndex,
  pressureIndex,
  impactIndex,
}: InvestigationCompositeInput) {
  return (
    offerGapIndex * INVESTIGATION_PRIORITY_WEIGHTS.offer_gap +
    pressureIndex * INVESTIGATION_PRIORITY_WEIGHTS.pressure +
    impactIndex * INVESTIGATION_PRIORITY_WEIGHTS.impact
  ) * 100;
}

export function classifyInvestigationProfile(
  offerGapIndex: number,
  pressureIndex: number,
  impactIndex: number,
) {
  const thresholds = SCORING_CONFIG.profileThresholds;

  if (
    offerGapIndex >= thresholds.strongOfferGap &&
    pressureIndex >= thresholds.strongPressure
  ) {
    return "Sous-équipement sous tension";
  }
  if (pressureIndex >= thresholds.highPressure && impactIndex >= thresholds.highImpact) {
    return "Tension d'usage à fort impact";
  }
  if (offerGapIndex >= thresholds.strongOfferGap && impactIndex >= thresholds.significantImpact) {
    return "Déficit structurant";
  }
  if (offerGapIndex >= thresholds.strongOfferGap) {
    return "Sous-dotation de couverture";
  }
  if (pressureIndex >= thresholds.strongPressure) {
    return "Tension d'usage";
  }
  if (impactIndex >= thresholds.highImpact) {
    return "Impact territorial élevé";
  }
  if (pressureIndex >= thresholds.watch || offerGapIndex >= thresholds.watch) {
    return "Équilibre fragile";
  }
  return "Socle intermédiaire";
}

export function buildInvestigationHypothesis({
  profile,
  bassinsPour100kHab,
  licencesFfnParBassin,
  licencesFfnPour1000Hab,
  licencesFfnPour100M2,
  communesSansBassinVolume,
  communesSansBassinShare,
  qpvPopulation,
  qpvShare,
  surfaceM2Pour1000Hab,
}: InvestigationHypothesisInput) {
  const thresholds = SCORING_CONFIG.hypothesisThresholds;

  if (profile === "Sous-équipement sous tension") {
    if (
      communesSansBassinVolume >= thresholds.highCoverageGapVolume ||
      communesSansBassinShare >= thresholds.highCoverageGapShare
    ) {
      return "Vérifier un déficit de couverture structurant : de nombreuses communes contributrices restent sans bassin sur le territoire.";
    }
    if (
      licencesFfnPour100M2 >= thresholds.veryHighLicencesPer100M2 ||
      licencesFfnParBassin >= thresholds.veryHighLicencesPerBassin
    ) {
      return "Vérifier une saturation des bassins existants : la pression FFN est élevée au regard de la surface et des équipements disponibles.";
    }
    return "Croiser couverture, capacité réelle et accès interterritorial pour qualifier un manque d'offre.";
  }

  if (profile === "Tension d'usage à fort impact") {
    if (
      qpvPopulation >= thresholds.elevatedQpvPopulation ||
      qpvShare >= thresholds.elevatedQpvShare
    ) {
      return "Territoire de masse critique : besoin potentiellement fort sur les créneaux, avec un enjeu social marqué à documenter.";
    }
    return "Offre existante mais tension élevée sur un territoire de grand poids : utile pour investiguer la saturation réelle des usages.";
  }

  if (profile === "Déficit structurant") {
    return "Le territoire cumule retrait d'offre et poids territorial notable : utile pour tester un besoin d'investissement ou de rééquilibrage.";
  }

  if (profile === "Sous-dotation de couverture") {
    if (
      surfaceM2Pour1000Hab < thresholds.lowSurfacePer1000Hab ||
      bassinsPour100kHab < thresholds.lowBassinsPer100kHab
    ) {
      return "Approfondir la dépendance aux bassins voisins et la capacité locale à absorber de nouveaux usages.";
    }
    return "Tester d'abord l'accessibilité réelle aux équipements et les écarts entre communes du même EPCI.";
  }

  if (profile === "Tension d'usage") {
    if (
      licencesFfnPour1000Hab >= thresholds.highLicencesPer1000Hab ||
      licencesFfnParBassin >= thresholds.highLicencesPerBassin
    ) {
      return "Approfondir la saturation des bassins et l'arbitrage des créneaux sur les usages scolaires, clubs et grand public.";
    }
    if (qpvShare >= thresholds.moderateQpvShare) {
      return "Approfondir les usages autour des quartiers prioritaires et la disponibilité effective des créneaux.";
    }
    return "Offre présente mais forte intensité d'usage : vérifier saturation, spécialisation et arbitrages de créneaux.";
  }

  if (profile === "Impact territorial élevé") {
    return "Territoire à fort volume de population ou de licences : même un déséquilibre modéré peut y produire un effet massif.";
  }

  if (profile === "Équilibre fragile") {
    return "Territoire intermédiaire : utile pour vérifier les contrastes internes entre communes équipées et communes contributrices.";
  }

  return "Socle plutôt favorable : territoire repère pour comparaison ou pour détecter des fragilités locales plus fines.";
}

export function buildPriorityDrivers({
  bassinsPour100kHab,
  licencesFfnParBassin,
  licencesFfnPour1000Hab,
  licencesFfnPour100M2,
  communesSansBassinVolume,
  communesSansBassinShare,
  population,
  licences,
  qpvPopulation,
  qpvShare,
}: PriorityDriverInput) {
  const reasons = [
    {
      score: licencesFfnParBassin,
      text: `Pression club élevée : ${formatNumber(licencesFfnParBassin, 1)} licences FFN par bassin.`,
    },
    {
      score: licencesFfnPour100M2,
      text: `Capacité sollicitée : ${formatNumber(licencesFfnPour100M2, 2)} licences FFN pour 100 m².`,
    },
    {
      score: licencesFfnPour1000Hab,
      text: `Taux de pratique notable : ${formatNumber(licencesFfnPour1000Hab, 2)} licences FFN pour 1 000 habitants.`,
    },
    {
      score: communesSansBassinVolume,
      text: `${formatInteger(communesSansBassinVolume)} communes avec licences restent sans bassin recensé.`,
    },
    {
      score: communesSansBassinShare * 100,
      text: `${formatPercent(communesSansBassinShare)} des communes licenciées restent sans bassin.`,
    },
    {
      score: qpvPopulation,
      text: `Enjeu social important : ${formatInteger(qpvPopulation)} habitants en QPV.`,
    },
    {
      score: qpvShare * 100,
      text: `Poids social marqué : ${formatPercent(qpvShare)} de la population en QPV.`,
    },
    {
      score: population,
      text: `Masse critique élevée : ${formatInteger(population)} habitants concernés.`,
    },
    {
      score: licences,
      text: `Volume important : ${formatInteger(licences)} licences FFN sur le territoire.`,
    },
    {
      score: bassinsPour100kHab === 0 ? 999 : 100 / bassinsPour100kHab,
      text: `Densité de bassin limitée : ${formatNumber(bassinsPour100kHab, 2)} bassins pour 100 000 habitants.`,
    },
  ];

  return reasons
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.text);
}

export function getQuadrantBucket(offerGapIndex: number, pressureIndex: number) {
  const offerGapScore = offerGapIndex * 100;
  const pressureScore = pressureIndex * 100;

  if (offerGapScore >= QUADRANT_THRESHOLD && pressureScore >= QUADRANT_THRESHOLD) {
    return "critical";
  }
  if (offerGapScore >= QUADRANT_THRESHOLD) {
    return "offer_gap";
  }
  if (pressureScore >= QUADRANT_THRESHOLD) {
    return "pressure";
  }
  return "stable";
}

export function getQuadrantColor(
  item: Pick<InvestigationCompositeInput, "offerGapIndex" | "pressureIndex">,
) {
  const bucket = getQuadrantBucket(item.offerGapIndex, item.pressureIndex);

  if (bucket === "critical") {
    return "#b34000";
  }
  if (bucket === "offer_gap") {
    return "#c3992a";
  }
  if (bucket === "pressure") {
    return "#000091";
  }
  return "#6a6af4";
}

export function getInvestigationScoreByLens(
  item: InvestigationScoreSubject,
  lens: InvestigationLens,
) {
  if (lens === "offer_gap") {
    return item.offerGapIndex * 100;
  }
  if (lens === "pressure") {
    return item.pressureIndex * 100;
  }
  if (lens === "impact") {
    return item.impactIndex * 100;
  }
  return item.priorityScore;
}

export function getInvestigationContribution(
  score: number,
  lens: InvestigationComponentLens,
) {
  return score * INVESTIGATION_PRIORITY_WEIGHTS[lens];
}

export function getPriorityToneClass(score: number) {
  const thresholds = SCORING_CONFIG.priorityToneThresholds;

  if (score >= thresholds.high) {
    return "priority-high";
  }
  if (score >= thresholds.medium) {
    return "priority-medium";
  }
  return "priority-low";
}

export function getPriorityLabel(score: number) {
  const thresholds = SCORING_CONFIG.priorityToneThresholds;

  if (score >= thresholds.high) {
    return "Très prioritaire";
  }
  if (score >= thresholds.medium) {
    return "À investiguer";
  }
  return "Repère";
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
}

function formatNumber(value: number, digits: number) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}
