import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { divIcon, latLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  INVESTIGATION_PRIORITY_WEIGHTS,
  QUADRANT_THRESHOLD,
  SCORING_CONFIG,
  buildInvestigationHypothesis,
  buildPriorityDrivers,
  calculatePriorityScore,
  classifyInvestigationProfile,
  getInvestigationContribution,
  getQuadrantBucket,
  getInvestigationScoreByLens,
  getPriorityToneClass,
  getQuadrantColor,
  type InvestigationLens,
  type InvestigationScoreDefinition,
} from "./scoring";
import type {
  AccessibilityEpciRecord,
  AccessibilityOverview,
  AgeSexRecord,
  BasinRecord,
  CommuneTransitRecord,
  CommuneAccessibilityRecord,
  CommuneRecord,
  DashboardData,
  EpciRecord,
  ExtendedInventoryRecord,
  GenericRecord,
  InstallationStatusRecord,
  InstallationStatusReviewQueueRecord,
  InstallationTransitRecord,
  OperationalStatusCode,
  Overview,
  ProjectBucketCode,
  ProjectInProgressRecord,
  ProjectPhaseCode,
  SchoolDemandInstallationRecord,
  SchoolDemandOverview,
  SchoolEstablishmentRecord,
  TransitEpciRecord,
  TransitOverview,
} from "./types";

type MetricKey =
  | "bassins_total"
  | "bassins_pour_100k_hab"
  | "surface_m2_pour_1000hab"
  | "licences_ffn_pour_1000hab"
  | "communes_sans_bassin_parmi_licenciees"
  | "part_dsp_bassins"
  | "part_bassins_usage_scolaires"
  | "licences_ffn_par_bassin"
  | "licences_ffn_pour_100m2"
  | "bassins_qpv_200m_pour_100k_qpv";

type RawSheetKey =
  | "departments"
  | "epci"
  | "communes"
  | "basins"
  | "epci_management"
  | "epci_schools"
  | "school_basins"
  | "age_sex"
  | "sex_2024"
  | "sources"
  | "extended_inventory"
  | "school_establishments"
  | "school_demand_epci"
  | "school_demand_installations"
  | "commune_accessibility"
  | "accessibility_epci"
  | "commune_transit"
  | "transit_epci"
  | "installation_transit"
  | "installation_status"
  | "status_review_queue"
  | "projects_in_progress";

type DashboardTab = "overview" | "territories" | "facilities" | "licences" | "data";
type OverviewView = "panorama" | "social" | "operations" | "school" | "access" | "transit";
type TerritoriesView = "investigation" | "comparisons" | "territory";
type FacilitiesView = "map" | "projects" | "sheet" | "scope" | "physical" | "operations" | "inventory" | "territories";

interface RawSheetDefinition {
  key: RawSheetKey;
  label: string;
  sheetName: string;
  description: string;
  exportSlug: string;
  getRows: (data: DashboardData) => GenericRecord[];
}

interface PreparedRawSheet extends RawSheetDefinition {
  rows: GenericRecord[];
  downloadPath?: string;
}

type MetricKind = "count" | "ratio" | "percent" | "duration" | "distance" | "year";
type InventoryCountMode = "equipments" | "installations";
type FacilityOperationalStatusFilter = "all" | "open" | "closed" | "verify";

interface MetricOption {
  key: MetricKey;
  label: string;
  kind: MetricKind;
  getValue: (item: EpciRecord) => number | null;
}

interface TerritoryMetricsSummary {
  bassinsPour100kHab: number;
  surfaceM2Pour1000Hab: number;
  licencesFfnPour100M2: number;
  communesSansBassinParmiLicenciees: number;
}

interface InventoryScopeSummary {
  equipmentsTotal: number;
  installationsTotal: number;
  bassinFamilyEquipmentsTotal: number;
  bassinFamilyInstallationsTotal: number;
  nonBassinFamilyEquipmentsTotal: number;
  nonBassinFamilyInstallationsTotal: number;
  familiesTotal: number;
  typesTotal: number;
  activitiesTotal: number;
}

interface InventoryCountableRecord {
  id_equipement: string;
  id_installation: string;
}

interface InventoryTypedRecord extends InventoryCountableRecord {
  type_equipement: string | null | undefined;
}

interface InventoryActivityRecord extends InventoryCountableRecord {
  activites: string | null | undefined;
}

type OperationalBasinRecord = BasinRecord &
  Pick<
    ExtendedInventoryRecord,
    | "uai"
    | "survey_date"
    | "state_change_date"
    | "observation_installation"
    | "observation_equipement"
    | "handicap_access_types"
    | "transport_access_modes"
    | "opening_authorized_flag"
    | "year_service"
    | "last_major_works_year"
    | "energy_sources"
    | "pmr_access_detail"
    | "sensory_access_detail"
    | "seasonal_only_flag"
    | "installation_out_of_service_flag"
    | "operational_status_code"
    | "operational_status_label"
    | "operational_status_reason"
    | "status_source"
    | "status_source_url"
    | "status_reviewed_at"
    | "status_confidence"
    | "status_verified_by"
    | "status_is_manual"
    | "status_override_comment"
  >;

interface FacilityMapPoint {
  kind: "point";
  id: string;
  displayMode: InventoryCountMode;
  installationId: string;
  equipmentId: string | null;
  installation: string;
  equipment: string | null;
  typeLabel: string | null;
  commune: string;
  departement: string;
  latitude: number;
  longitude: number;
  managementLabel: string;
  operational_status_code: OperationalStatusCode;
  operational_status_label: string;
  operational_status_reason: string | null;
  status_source: string | null;
  usage_scolaires: number;
  qpv_flag: number;
  qpv_200m_flag: number;
  surface_bassin_m2: number | null;
  equipmentCount: number;
  basinCount: number;
}

interface FacilityMapCluster {
  kind: "cluster";
  id: string;
  displayMode: InventoryCountMode;
  latitude: number;
  longitude: number;
  count: number;
  managementLabel: string;
  operational_status_code: OperationalStatusCode;
  operational_status_label: string;
  samplePoints: FacilityMapPoint[];
  managementBreakdown: Array<{ label: string; count: number }>;
  statusBreakdown: Array<{ code: OperationalStatusCode; label: string; count: number }>;
}

interface FacilityMapSearchSuggestion {
  id: string;
  kind: "installation" | "commune";
  title: string;
  detail: string;
  queryValue: string;
  pointId: string | null;
}

interface OperationalInventorySummary {
  equipmentCount: number;
  installationCount: number;
  averageServiceYear: number;
  yearCoverageShare: number;
  legacyShare: number;
  recentWorksShare: number;
  transportAccessShare: number;
  accessibilityShare: number;
  openingAuthorizedShare: number;
  seasonalShare: number;
  outOfServiceShare: number;
  schoolUsageCount: number;
  schoolUsageShare: number;
  schoolExplicitCount: number;
  uaiCount: number;
  schoolTransportShare: number;
  schoolAccessibilityShare: number;
  schoolOperationalShare: number;
}

interface OperationalStatusSummary {
  totalInstallations: number;
  verifiedManual: number;
  openProbable: number;
  temporaryClosed: number;
  closed: number;
  seasonal: number;
  verify: number;
}

interface OperationalTerritoryRow {
  epci_code: string;
  epci_nom: string;
  departement: string;
  basins: number;
  installations: number;
  averageServiceYear: number;
  legacyShare: number;
  recentWorksShare: number;
  transportAccessShare: number;
  accessibilityShare: number;
  schoolUsageCount: number;
  schoolOperationalShare: number;
}

interface FacilityAssignedSchoolRow {
  uai: string;
  schoolName: string;
  schoolLevel: string;
  commune: string;
  studentsTotal: number;
  distanceToInstallationKm: number | null;
  driveDistanceToInstallationKm: number | null;
  driveTimeToInstallationMin: number | null;
}

interface AccessibilityHighlightRow {
  label: string;
  detail: string;
  value: string;
}

interface ProjectSummaryCard {
  label: string;
  value: string;
  detail: string;
}

type ComparableProfileScope =
  | "all"
  | "sport_25"
  | "sport_50"
  | "ludique"
  | "mixte"
  | "fosse"
  | "specialized";

type ComparableBasinContext = "all" | "school" | "qpv";

interface ComparableProfileSummary {
  equipmentCount: number;
  installationCount: number;
  averageLength: number;
  averageSurface: number;
  averageLanes: number;
  averageMaxDepth: number;
}

interface LicenceTrendRow {
  code: string;
  label: string;
  licences2023: number;
  licences2024: number;
  delta: number;
  deltaShare: number;
}

interface QpvFragilityRow {
  epci_code: string;
  epci_nom: string;
  departement: string;
  qpvCount: number;
  qpvPopulation: number;
  qpvShare: number;
  bassinsQpv: number;
  bassinsQpv200m: number;
  bassinsParQpv: number;
  coveragePer100kQpv: number;
  directCoveragePer100kQpv: number;
  fragilityScore: number;
}

const LEGACY_SERVICE_YEAR_THRESHOLD = 2000;
const RECENT_WORKS_YEAR_THRESHOLD = 2015;
const SERVICE_YEAR_BUCKETS = [
  { label: "Avant 1980", min: -Infinity, max: 1980 },
  { label: "1980-1999", min: 1980, max: 2000 },
  { label: "2000-2014", min: 2000, max: 2015 },
  { label: "2015 et plus", min: 2015, max: Infinity },
] as const;

interface InvestigationProfileRow {
  epci_code: string;
  epci_nom: string;
  departement: string;
  population: number;
  bassins: number;
  licences: number;
  bassinsPour100kHab: number;
  surfaceM2Pour1000Hab: number;
  licencesFfnPour1000Hab: number;
  licencesFfnParBassin: number;
  licencesFfnPour100M2: number;
  communesSansBassinShare: number;
  communesSansBassinVolume: number;
  qpvPopulation: number;
  qpvShare: number;
  selectedMetricValue: number | null;
  selectedMetricKind: MetricKind;
  priorityScore: number;
  offerGapIndex: number;
  pressureIndex: number;
  impactIndex: number;
  profile: string;
  hypothesis: string;
  priorityDrivers: string[];
}

type InvestigationRankLookup = Record<InvestigationLens, Map<string, number>>;

const METRIC_OPTIONS: MetricOption[] = [
  {
    key: "bassins_total",
    label: "Bassins totaux",
    kind: "count",
    getValue: (item) => item.bassins_total,
  },
  {
    key: "bassins_pour_100k_hab",
    label: "Bassins pour 100 000 hab.",
    kind: "ratio",
    getValue: (item) => item.bassins_pour_100k_hab,
  },
  {
    key: "surface_m2_pour_1000hab",
    label: "Surface pour 1 000 hab.",
    kind: "ratio",
    getValue: (item) => safeDivide(item.surface_totale_bassins_m2, item.population_2023_communes) * 1000,
  },
  {
    key: "licences_ffn_pour_1000hab",
    label: "Licences FFN pour 1 000 hab.",
    kind: "ratio",
    getValue: (item) => item.licences_ffn_pour_1000hab,
  },
  {
    key: "communes_sans_bassin_parmi_licenciees",
    label: "Communes licenciées sans bassin",
    kind: "percent",
    getValue: (item) =>
      safeDivide(item.communes_avec_licences_sans_bassin, item.communes_avec_licences_ffn),
  },
  {
    key: "part_dsp_bassins",
    label: "Part de DSP",
    kind: "percent",
    getValue: (item) => item.part_dsp_bassins,
  },
  {
    key: "part_bassins_usage_scolaires",
    label: "Part d'usage scolaires",
    kind: "percent",
    getValue: (item) => item.part_bassins_usage_scolaires,
  },
  {
    key: "licences_ffn_par_bassin",
    label: "Licences FFN par bassin",
    kind: "ratio",
    getValue: (item) => item.licences_ffn_par_bassin,
  },
  {
    key: "licences_ffn_pour_100m2",
    label: "Licences FFN pour 100 m²",
    kind: "ratio",
    getValue: (item) => safeDivide(item.licences_ffn_2023, item.surface_totale_bassins_m2) * 100,
  },
  {
    key: "bassins_qpv_200m_pour_100k_qpv",
    label: "Bassins proches QPV pour 100k hab. QPV",
    kind: "ratio",
    getValue: (item) => safeDivide(item.bassins_qpv_200m, item.pop_qpv) * 100000,
  },
];

const RAW_SHEET_DEFINITIONS: RawSheetDefinition[] = [
  {
    key: "departments",
    label: "02 Départements",
    sheetName: "02_Departements",
    description: "Indicateurs départementaux : population, licences, bassins, QPV et surfaces.",
    exportSlug: "departements",
    getRows: (data) => toRawRows(data.departments),
  },
  {
    key: "epci",
    label: "03 EPCI",
    sheetName: "03_EPCI",
    description: "Table principale EPCI pour cartographie, filtres et comparaisons territoriales.",
    exportSlug: "epci",
    getRows: (data) => toRawRows(data.epci),
  },
  {
    key: "communes",
    label: "04 Communes",
    sheetName: "04_Communes",
    description: "Base communale complète avec licences, bassins, typo, ZRR et QPV.",
    exportSlug: "communes",
    getRows: (data) => toRawRows(data.communes),
  },
  {
    key: "basins",
    label: "05 Bassins points",
    sheetName: "05_Bassins_points",
    description: "Couche de points des équipements aquatiques avec coordonnées et mode de gestion.",
    exportSlug: "bassins_points",
    getRows: (data) => toRawRows(data.basins),
  },
  {
    key: "epci_management",
    label: "06 Gestion EPCI",
    sheetName: "06_Gestion_EPCI",
    description: "Répartition DSP / régie / autre hors DSP à l'échelle EPCI.",
    exportSlug: "gestion_epci",
    getRows: (data) => data.epci_management,
  },
  {
    key: "epci_schools",
    label: "07 Scolaires EPCI",
    sheetName: "07_Scolaires_EPCI",
    description: "Indicateurs usage scolaires et proximité QPV à l'échelle EPCI.",
    exportSlug: "scolaires_epci",
    getRows: (data) => data.epci_schools,
  },
  {
    key: "school_basins",
    label: "08 Bassins scolaires",
    sheetName: "08_Bassins_scolaires",
    description: "D\u00e9tail des bassins rep\u00e9r\u00e9s comme li\u00e9s \u00e0 des usages scolaires.",
    exportSlug: "bassins_scolaires",
    getRows: (data) => toRawRows(data.school_basins),
  },
  {
    key: "age_sex",
    label: "09 \u00c2ges x sexe",
    sheetName: "09_Ages_dep_sexe",
    description: "Distribution d\u00e9partementale des licences FFN 2024 par \u00e2ge et sexe.",
    exportSlug: "ages_dep_sexe",
    getRows: (data) => toRawRows(data.age_sex),
  },
  {
    key: "sex_2024",
    label: "10 Sexe 2024",
    sheetName: "10_Dep_sexe_2024",
    description: "Licences FFN 2024 par département et sexe.",
    exportSlug: "dep_sexe_2024",
    getRows: (data) => toRawRows(data.sex_2024),
  },
  {
    key: "sources",
    label: "11 Sources",
    sheetName: "11_Sources",
    description: "Sources, filtres et définitions métier utilisés dans le classeur.",
    exportSlug: "sources",
    getRows: (data) => toRawRows(data.sources),
  },
  {
    key: "extended_inventory",
    label: "12 Data ES élargie",
    sheetName: "Extraction complémentaire",
    description:
      "Extraction Data ES non filtrée à l'échelle des installations marquées piscine, normalisée pour le web.",
    exportSlug: "equipements_sportifs_non_filtres",
    getRows: (data) => toRawRows(data.extended_inventory),
  },
  {
    key: "school_establishments",
    label: "13 Établissements scolaires",
    sheetName: "Extraction Éducation",
    description:
      "Établissements scolaires géolocalisés en Hauts-de-France avec effectifs 2024 et distance au bassin le plus proche.",
    exportSlug: "etablissements_scolaires_hdf",
    getRows: (data) => toRawRows(data.school_establishments),
  },
  {
    key: "school_demand_epci",
    label: "14 Pression scolaire EPCI",
    sheetName: "Synthèse scolaire EPCI",
    description:
      "Lecture territoriale de la demande scolaire potentielle : effectifs, couverture bassin et distance d'accès.",
    exportSlug: "pression_scolaire_epci",
    getRows: (data) => toRawRows(data.school_demand_epci),
  },
  {
    key: "school_demand_installations",
    label: "15 Pression scolaire installations",
    sheetName: "Synthèse scolaire installations",
    description:
      "Rattachement des établissements scolaires à l'installation aquatique la plus proche dans le socle bassin retenu.",
    exportSlug: "pression_scolaire_installations",
    getRows: (data) => toRawRows(data.school_demand_installations),
  },
  {
    key: "commune_accessibility",
    label: "16 Accessibilité voiture communes",
    sheetName: "Accessibilité voiture communes",
    description:
      "Temps d'acces voiture depuis le centre communal vers l'installation aquatique la plus proche du socle regional.",
    exportSlug: "accessibilite_voiture_communes",
    getRows: (data) => toRawRows(data.commune_accessibility),
  },
  {
    key: "accessibility_epci",
    label: "17 Accessibilité voiture EPCI",
    sheetName: "Synthèse accessibilité EPCI",
    description:
      "Lecture agrégée des temps d'accès voiture par EPCI : temps moyen, distance moyenne et parts de population couvertes.",
    exportSlug: "accessibilite_voiture_epci",
    getRows: (data) => toRawRows(data.accessibility_epci),
  },
  {
    key: "commune_transit",
    label: "18 Offre TC potentielle communes",
    sheetName: "Offre TC potentielle communes",
    description:
      "Lecture GTFS des communes : distance à l'arrêt ou à la gare la plus proche et volume théorique de passages à proximité.",
    exportSlug: "offre_tc_potentielle_communes",
    getRows: (data) => toRawRows(data.commune_transit),
  },
  {
    key: "transit_epci",
    label: "19 Offre TC potentielle EPCI",
    sheetName: "Synthèse offre TC EPCI",
    description:
      "Lecture agrégée par EPCI de l'offre TC potentielle autour des communes, des installations et des établissements scolaires.",
    exportSlug: "offre_tc_potentielle_epci",
    getRows: (data) => toRawRows(data.transit_epci),
  },
  {
    key: "installation_transit",
    label: "20 Offre TC potentielle installations",
    sheetName: "Synthèse offre TC installations",
    description:
      "Ancrage GTFS des installations aquatiques : distance à l'arrêt le plus proche et intensité théorique de desserte à pied.",
    exportSlug: "offre_tc_potentielle_installations",
    getRows: (data) => toRawRows(data.installation_transit),
  },
  {
    key: "installation_status",
    label: "21 Statuts installations",
    sheetName: "Statuts exploitation",
    description:
      "Statut d'exploitation calculé à partir de Data ES, avec prise en compte d'une éventuelle vérification manuelle.",
    exportSlug: "statuts_installations",
    getRows: (data) => toRawRows(data.installation_status),
  },
  {
    key: "projects_in_progress",
    label: "22 Projets en cours",
    sheetName: "Veille projets",
    description:
      "Veille manuelle des constructions neuves, réhabilitations lourdes et projets incertains repérés dans le rapport local.",
    exportSlug: "projets_equipements_en_cours",
    getRows: (data) => toRawRows(data.projects_in_progress),
  },
];

const AGE_ORDER = [
  "0 à 4 ans",
  "5 à 9 ans",
  "10 à 14 ans",
  "15 à 19 ans",
  "20 à 24 ans",
  "25 à 29 ans",
  "30 à 34 ans",
  "35 à 39 ans",
  "40 à 44 ans",
  "45 à 49 ans",
  "50 à 54 ans",
  "55 à 59 ans",
  "60 à 64 ans",
  "65 à 69 ans",
  "70 à 74 ans",
  "75 à 79 ans",
  "80 ans et plus",
  "NR - Non réparti",
];

const MANAGEMENT_COLORS: Record<string, string> = {
  DSP: "#b34000",
  "Régie publique": "#000091",
  "Autre gestion hors DSP": "#6a6af4",
};
const MANAGEMENT_LEGEND_ITEMS = [
  ...Object.entries(MANAGEMENT_COLORS).map(([label, color]) => ({ label, color })),
  { label: "Gestion mixte", color: "#7a6f5a" },
];
const OPERATIONAL_STATUS_COLORS: Record<OperationalStatusCode, string> = {
  open_probable: "#18753c",
  temporary_closed: "#b34000",
  closed: "#a94645",
  seasonal: "#8f6a00",
  verify: "#000091",
};
const PROJECT_BUCKET_COLORS: Record<ProjectBucketCode, string> = {
  new: "#000091",
  rehab: "#0063cb",
  uncertain: "#7a7a7a",
};
const PROJECT_PHASE_COLORS: Record<ProjectPhaseCode, string> = {
  works: "#b34000",
  programming: "#000091",
  procedure: "#6a6af4",
  consultation: "#8f6a00",
  recent_delivery: "#18753c",
  uncertain: "#7a7a7a",
};
const PROJECT_MARKER_FILL = "#f4c542";
const PROJECT_MARKER_STROKE = "#7a5800";
const PROJECT_BUCKET_OPTIONS: Array<{ key: ProjectBucketCode; label: string }> = [
  { key: "new", label: "Constructions neuves" },
  { key: "rehab", label: "Réhabilitations lourdes" },
  { key: "uncertain", label: "Très incertains" },
];
const OPERATIONAL_STATUS_LEGEND = [
  { key: "open_probable", label: "Ouvert probable" },
  { key: "temporary_closed", label: "Fermé temporairement / travaux" },
  { key: "closed", label: "Fermé / hors service" },
  { key: "seasonal", label: "Ouverture saisonnière" },
  { key: "verify", label: "Statut à vérifier" },
] as const;
const FACILITY_OPERATIONAL_STATUS_FILTER_OPTIONS: Array<{
  key: FacilityOperationalStatusFilter;
  label: string;
}> = [
  { key: "all", label: "Tous statuts" },
  { key: "open", label: "Ouverts / saisonniers" },
  { key: "closed", label: "Fermés / travaux" },
  { key: "verify", label: "À vérifier" },
];

const CORE_AQUATIC_TYPES = new Set([
  "Bassin sportif de natation",
  "Bassin ludique de natation",
  "Bassin mixte de natation",
]);
const SURFACE_BUCKETS = [
  { label: "< 100 m²", min: 0, max: 100 },
  { label: "100 à 249 m²", min: 100, max: 250 },
  { label: "250 à 499 m²", min: 250, max: 500 },
  { label: "500 à 999 m²", min: 500, max: 1000 },
  { label: "1 000 m² et +", min: 1000, max: Number.POSITIVE_INFINITY },
] as const;
const LENGTH_BUCKETS = [
  { label: "< 15 m", min: 0, max: 15 },
  { label: "15 à 24 m", min: 15, max: 25 },
  { label: "25 à 49 m", min: 25, max: 50 },
  { label: "50 m et +", min: 50, max: Number.POSITIVE_INFINITY },
] as const;
const EMPTY_SCHOOL_DEMAND_SUMMARY: SchoolDemandOverview = {
  schools_total: 0,
  schools_geolocated_total: 0,
  students_total: 0,
  students_geolocated_total: 0,
  primary_students: 0,
  secondary_students: 0,
  distance_coverage_share: 0,
  drive_time_coverage_share: 0,
  average_distance_to_installation_km: 0,
  average_drive_time_to_installation_min: 0,
  average_drive_distance_to_installation_km: 0,
  average_distance_to_basin_km: 0,
  students_within_5km_installation_share: 0,
  students_within_15min_installation_share: 0,
  basins_total: 0,
  installations_total: 0,
  school_basins_total: 0,
  students_per_basin: 0,
  students_per_installation: 0,
  students_per_school_basin: 0,
};
const EMPTY_ACCESSIBILITY_SUMMARY: AccessibilityOverview = {
  communes_total: 0,
  communes_routed_total: 0,
  population_total: 0,
  population_routed_total: 0,
  installations_total: 0,
  reachable_installations_total: 0,
  average_drive_time_to_installation_min: 0,
  average_drive_distance_to_installation_km: 0,
  population_within_10min_share: 0,
  population_within_15min_share: 0,
  population_within_20min_share: 0,
  communes_within_10min_share: 0,
  communes_within_15min_share: 0,
  communes_within_20min_share: 0,
};
const EMPTY_TRANSIT_SUMMARY: TransitOverview = {
  communes_total: 0,
  communes_geolocated_total: 0,
  population_total: 0,
  population_geolocated_total: 0,
  transit_hubs_total: 0,
  average_nearest_stop_distance_km: 0,
  average_weekday_trips_within_1000m: 0,
  population_within_500m_share: 0,
  population_within_1000m_share: 0,
  communes_within_500m_share: 0,
  communes_within_1000m_share: 0,
  installations_total: 0,
  installations_geolocated_total: 0,
  installations_within_500m_share: 0,
  installations_within_1000m_share: 0,
  schools_total: 0,
  students_total: 0,
  students_geolocated_total: 0,
  average_school_nearest_stop_distance_km: 0,
  students_within_500m_share: 0,
  students_within_1000m_share: 0,
};
const RAW_PAGE_SIZE = 20;
const INVESTIGATION_PAGE_SIZE = 10;
const RANKING_LIMIT_OPTIONS = [12, 25, 50, 100] as const;
const INVESTIGATION_LENS_OPTIONS: Array<{ key: InvestigationLens; label: string; description: string }> = [
  {
    key: "priority",
    label: "À approfondir",
    description: "Composite équilibré entre déficit d'offre, tension d'usage et impact territorial.",
  },
  {
    key: "offer_gap",
    label: "Sous-équipement",
    description: "Lecture orientée couverture et capacité disponibles sur le territoire.",
  },
  {
    key: "pressure",
    label: "Sous tension",
    description: "Lecture orientée intensité d'usage, licences et saturation potentielle.",
  },
  {
    key: "impact",
    label: "Fort impact",
    description: "Lecture orientée volume de population, licences et enjeux sociaux touchés.",
  },
];
const INVESTIGATION_SCORE_DEFINITIONS: InvestigationScoreDefinition[] = [
  {
    lens: "offer_gap",
    indexKey: "offerGapIndex",
    label: "Sous-équipement",
    weight: INVESTIGATION_PRIORITY_WEIGHTS.offer_gap,
    description: "Mesure le retrait relatif d'offre et de couverture dans le périmètre actif.",
    metrics: [
      "surface de bassins pour 1 000 habitants",
      "bassins pour 100 000 habitants",
      "part de communes licenciées sans bassin",
      "volume de communes licenciées sans bassin",
    ],
  },
  {
    lens: "pressure",
    indexKey: "pressureIndex",
    label: "Sous tension",
    weight: INVESTIGATION_PRIORITY_WEIGHTS.pressure,
    description: "Mesure l'intensité d'usage susceptible de saturer l'offre existante.",
    metrics: [
      "licences FFN pour 100 m²",
      "licences FFN par bassin",
      "licences FFN pour 1 000 habitants",
    ],
  },
  {
    lens: "impact",
    indexKey: "impactIndex",
    label: "Fort impact",
    weight: INVESTIGATION_PRIORITY_WEIGHTS.impact,
    description:
      "Mesure le poids territorial du besoin : population, volumes de licences et enjeux sociaux.",
    metrics: [
      "population totale",
      "volume de licences FFN",
      "volume de communes licenciées sans bassin",
      "population QPV en volume et en part",
    ],
  },
];
const TAB_OPTIONS: Array<{ key: DashboardTab; label: string; description: string }> = [
  {
    key: "overview",
    label: "Synthèse",
    description: "Vue rapide des indicateurs structurants et des signaux de lecture du panorama.",
  },
  {
    key: "territories",
    label: "Territoires",
    description: "Prioriser les EPCI, formuler des hypothèses et ouvrir une fiche territoire ciblée.",
  },
  {
    key: "facilities",
    label: "Équipements",
    description: "Explorer le parc aquatique, ses équipements, ses usages scolaires et sa cartographie.",
  },
  {
    key: "licences",
    label: "Licences",
    description: "Lire la structure des licences FFN et repérer les communes sous pression.",
  },
  {
    key: "data",
    label: "Données",
    description: "Accéder à la méthode, aux exports et au détail brut des feuilles du classeur.",
  },
];
const COMPARABLE_PROFILE_SCOPE_OPTIONS: Array<{
  key: ComparableProfileScope;
  label: string;
  description: string;
}> = [
  {
    key: "all",
    label: "Tous profils",
    description: "Voir tout le parc et ses écarts de structure.",
  },
  {
    key: "sport_25",
    label: "Formats 25 m",
    description: "Bassins sportifs 25 m et grands formats 25 m assimilés.",
  },
  {
    key: "sport_50",
    label: "Formats 50 m",
    description: "Bassins sportifs 50 m et grands formats 50 m assimilés.",
  },
  {
    key: "ludique",
    label: "Ludiques",
    description: "Bassins d'agrément, récréatifs ou peu profonds.",
  },
  {
    key: "mixte",
    label: "Mixtes",
    description: "Bassins combinant logiques sportives et récréatives.",
  },
  {
    key: "fosse",
    label: "Fosses",
    description: "Plongée, plongeon et grands volumes profonds.",
  },
  {
    key: "specialized",
    label: "Spécialisés",
    description: "Formats courts, toboggans et autres bassins particuliers.",
  },
];
const COMPARABLE_BASIN_CONTEXT_OPTIONS: Array<{
  key: ComparableBasinContext;
  label: string;
  description: string;
}> = [
  {
    key: "all",
    label: "Tous les bassins",
    description: "Lecture complète de la famille comparable retenue.",
  },
  {
    key: "school",
    label: "Bassins scolaires",
    description: "Ne garder que les équipements où un usage scolaire est repéré.",
  },
  {
    key: "qpv",
    label: "Bassins proches QPV",
    description: "Ne garder que les équipements en QPV ou à moins de 200 m.",
  },
];
const OVERVIEW_VIEW_OPTIONS: Array<{
  key: OverviewView;
  label: string;
  description: string;
}> = [
  {
    key: "panorama",
    label: "Panorama",
    description: "Rep\u00e8res globaux, signaux rapides et comparaison d\u00e9partementale.",
  },
  {
    key: "social",
    label: "Enjeux sociaux",
    description: "Lecture QPV du p\u00e9rim\u00e8tre actif et fragilit\u00e9 sociale par EPCI.",
  },
  {
    key: "operations",
    label: "État du parc",
    description: "Lecture courte de l'exploitation, du vieillissement du parc et des fragilités structurelles par EPCI.",
  },
  {
    key: "school",
    label: "Demande scolaire",
    description: "Pression scolaire potentielle, distances d'accès et lecture des effectifs par EPCI.",
  },
  {
    key: "access",
    label: "Accès voiture",
    description: "Temps d'accès routier vers l'installation aquatique la plus proche, à la maille communale puis EPCI.",
  },
  {
    key: "transit",
    label: "Offre TC",
    description: "Lecture GTFS d'offre potentielle : arrêts, gares et intensité théorique de desserte à proximité.",
  },
];
const TERRITORIES_VIEW_OPTIONS: Array<{
  key: TerritoriesView;
  label: string;
  description: string;
}> = [
  {
    key: "investigation",
    label: "Repérage",
    description: "Priorisation, quadrants et table exhaustive des EPCI.",
  },
  {
    key: "comparisons",
    label: "Comparaisons",
    description: "Face-à-face entre EPCI et comparaison de bassins équivalents.",
  },
  {
    key: "territory",
    label: "Fiche territoire",
    description: "Lecture synthétique d'un territoire avec ses repères et points d'appui.",
  },
];
const FACILITIES_VIEW_OPTIONS: Array<{
  key: FacilitiesView;
  label: string;
  description: string;
}> = [
  {
    key: "map",
    label: "Carte",
    description: "Carte, filtres actifs et répartition immédiate du parc affiché.",
  },
  {
    key: "projects",
    label: "Projets en cours",
    description: "Veille des constructions, réhabilitations lourdes et projets encore incertains repérés dans la région.",
  },
  {
    key: "sheet",
    label: "Fiche équipement",
    description: "Lecture fine d'un bassin, de ses dimensions, de son exploitation et du site qui l'accueille.",
  },
  {
    key: "scope",
    label: "Périmètre",
    description: "Socle bassins, lecture Data ES élargie et repères de couverture.",
  },
  {
    key: "physical",
    label: "Propriétés",
    description: "Tailles, longueurs, couloirs et intensité physique du parc.",
  },
  {
    key: "operations",
    label: "État & scolaire",
    description: "Ancienneté, travaux, énergie, accessibilité et conditions d'accueil scolaire.",
  },
  {
    key: "inventory",
    label: "Familles & activités",
    description: "Lecture complète des familles, types, configurations et activités.",
  },
  {
    key: "territories",
    label: "Territoires",
    description: "Surface par habitant et lecture territoriale par EPCI.",
  },
];

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [overviewView, setOverviewView] = useState<OverviewView>("panorama");
  const [territoriesView, setTerritoriesView] = useState<TerritoriesView>("investigation");
  const [facilitiesView, setFacilitiesView] = useState<FacilitiesView>("map");
  const [selectedFacilityEquipmentId, setSelectedFacilityEquipmentId] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedEpciCode, setSelectedEpciCode] = useState("all");
  const [selectedComparisonEpciCode, setSelectedComparisonEpciCode] = useState("all");
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("bassins_total");
  const [investigationLens, setInvestigationLens] = useState<InvestigationLens>("priority");
  const [rankingLimit, setRankingLimit] = useState<(typeof RANKING_LIMIT_OPTIONS)[number]>(25);
  const [managementFilter, setManagementFilter] = useState("all");
  const [basinUsageFilter, setBasinUsageFilter] = useState("all");
  const [localityTypeFilter, setLocalityTypeFilter] = useState("all");
  const [operationalStatusFilter, setOperationalStatusFilter] =
    useState<FacilityOperationalStatusFilter>("all");
  const [facilityMapZoom, setFacilityMapZoom] = useState(8);
  const [isMapFilterPanelOpen, setIsMapFilterPanelOpen] = useState(true);
  const [showProjectMarkers, setShowProjectMarkers] = useState(true);
  const [selectedMapPointId, setSelectedMapPointId] = useState("");
  const [inventoryCountMode, setInventoryCountMode] = useState<InventoryCountMode>("installations");
  const [comparableProfileScope, setComparableProfileScope] = useState<ComparableProfileScope>("all");
  const [comparableBasinContext, setComparableBasinContext] = useState<ComparableBasinContext>("all");
  const [epciSearch, setEpciSearch] = useState("");
  const [basinSearch, setBasinSearch] = useState("");
  const [selectedRawSheet, setSelectedRawSheet] = useState<RawSheetKey>("epci");
  const [rawSearch, setRawSearch] = useState("");
  const [rawPage, setRawPage] = useState(1);
  const [investigationPage, setInvestigationPage] = useState(1);
  const territoryPanelRef = useRef<HTMLElement | null>(null);
  const pendingTerritoryJumpRef = useRef(false);

  const deferredEpciSearch = useDeferredValue(epciSearch.trim().toLowerCase());
  const deferredBasinSearch = useDeferredValue(basinSearch.trim().toLowerCase());
  const deferredProjectSearch = useDeferredValue(projectSearch.trim().toLowerCase());
  const deferredRawSearch = useDeferredValue(rawSearch.trim().toLowerCase());

  useEffect(() => {
    if (inventoryCountMode !== "installations" && managementFilter === "Gestion mixte") {
      setManagementFilter("all");
    }
  }, [inventoryCountMode, managementFilter]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      try {
        const dashboardUrl = `${import.meta.env.BASE_URL}data/dashboard.json?v=${encodeURIComponent(
          __APP_BUILD_ID__,
        )}`;
        const response = await fetch(dashboardUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Impossible de charger les données (${response.status}).`);
        }
        const payload = (await response.json()) as Partial<DashboardData>;
        const normalizedPayload = {
          ...payload,
          notes: Array.isArray(payload.notes) ? payload.notes : [],
          departments: Array.isArray(payload.departments) ? payload.departments : [],
          epci: Array.isArray(payload.epci) ? payload.epci : [],
          communes: Array.isArray(payload.communes) ? payload.communes : [],
          basins: Array.isArray(payload.basins) ? payload.basins : [],
          epci_management: Array.isArray(payload.epci_management) ? payload.epci_management : [],
          epci_schools: Array.isArray(payload.epci_schools) ? payload.epci_schools : [],
          school_basins: Array.isArray(payload.school_basins) ? payload.school_basins : [],
          age_sex: Array.isArray(payload.age_sex) ? payload.age_sex : [],
          sex_2024: Array.isArray(payload.sex_2024) ? payload.sex_2024 : [],
          sources: Array.isArray(payload.sources) ? payload.sources : [],
          extended_inventory: Array.isArray(payload.extended_inventory) ? payload.extended_inventory : [],
          installation_status: Array.isArray(payload.installation_status) ? payload.installation_status : [],
          status_review_queue: Array.isArray(payload.status_review_queue) ? payload.status_review_queue : [],
          projects_in_progress: Array.isArray(payload.projects_in_progress) ? payload.projects_in_progress : [],
          school_establishments: Array.isArray(payload.school_establishments)
            ? payload.school_establishments
            : [],
          school_demand_epci: Array.isArray(payload.school_demand_epci) ? payload.school_demand_epci : [],
          school_demand_installations: Array.isArray(payload.school_demand_installations)
            ? payload.school_demand_installations
            : [],
          commune_accessibility: Array.isArray(payload.commune_accessibility)
            ? payload.commune_accessibility
            : [],
          accessibility_epci: Array.isArray(payload.accessibility_epci) ? payload.accessibility_epci : [],
          commune_transit: Array.isArray(payload.commune_transit) ? payload.commune_transit : [],
          transit_epci: Array.isArray(payload.transit_epci) ? payload.transit_epci : [],
          installation_transit: Array.isArray(payload.installation_transit)
            ? payload.installation_transit
            : [],
          school_demand_overview:
            payload.school_demand_overview && typeof payload.school_demand_overview === "object"
              ? payload.school_demand_overview
              : EMPTY_SCHOOL_DEMAND_SUMMARY,
          accessibility_overview:
            payload.accessibility_overview && typeof payload.accessibility_overview === "object"
              ? payload.accessibility_overview
              : EMPTY_ACCESSIBILITY_SUMMARY,
          transit_overview:
            payload.transit_overview && typeof payload.transit_overview === "object"
              ? payload.transit_overview
              : EMPTY_TRANSIT_SUMMARY,
          downloads: Array.isArray(payload.downloads) ? payload.downloads : [],
        } as DashboardData;
        setData(normalizedPayload);
      } catch (loadError) {
        if (loadError instanceof Error && loadError.name !== "AbortError") {
          setError(loadError.message);
        }
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setRawPage(1);
  }, [deferredRawSearch, selectedDepartment, selectedRawSheet]);

  useEffect(() => {
    setRawSearch("");
  }, [selectedRawSheet]);

  useEffect(() => {
    const tabLabel = TAB_OPTIONS.find((t) => t.key === activeTab)?.label ?? "";
    document.title = tabLabel ? `${tabLabel} · Panorama aquatique HDF` : "Panorama aquatique HDF";
  }, [activeTab]);

  useEffect(() => {
    setBasinSearch("");
    setEpciSearch("");
  }, [activeTab]);

  useEffect(() => {
    setInvestigationPage(1);
  }, [deferredEpciSearch, investigationLens, selectedDepartment]);

  const departmentOptions = data?.departments ?? [];
  const departmentLabel =
    selectedDepartment === "all"
      ? "Hauts-de-France"
      : departmentOptions.find((item) => item.code_departement === selectedDepartment)?.departement ??
        "Département";

  const filteredDepartments = useMemo(() => {
    if (!data) {
      return [];
    }
    return selectedDepartment === "all"
      ? data.departments
      : data.departments.filter((item) => item.code_departement === selectedDepartment);
  }, [data, selectedDepartment]);

  const scopedEpci = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.epci.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const filteredEpci = useMemo(() => {
    return scopedEpci.filter((item) => {
      if (!deferredEpciSearch) {
        return true;
      }

      return `${item.epci_nom} ${item.departement}`.toLowerCase().includes(deferredEpciSearch);
    });
  }, [deferredEpciSearch, scopedEpci]);

  const scopedBasins = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.basins.filter(
      (item) => selectedDepartment === "all" || item.dep_code === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const communeTypologyLookup = useMemo(() => {
    const baseCommunes = data?.communes ?? [];
    return new Map(
      baseCommunes
        .filter((item) => selectedDepartment === "all" || item.code_departement === selectedDepartment)
        .map((item) => [item.code_commune, formatCommuneTypology(item.typo)]),
    );
  }, [data, selectedDepartment]);

  const scopedExtendedInventory = useMemo(() => {
    if (!data) {
      return [];
    }

    return (data.extended_inventory ?? []).filter(
      (item) => selectedDepartment === "all" || item.dep_code === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const scopedProjects = useMemo<ProjectInProgressRecord[]>(() => {
    if (!data) {
      return [];
    }

    return data.projects_in_progress.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const filteredProjects = useMemo<ProjectInProgressRecord[]>(() => {
    if (!deferredProjectSearch) {
      return scopedProjects;
    }

    return scopedProjects.filter((item) =>
      [
        item.project_name,
        item.communes_label,
        item.project_owner,
        item.project_nature_label,
        item.public_status,
        item.program_summary,
      ]
        .join(" ")
        .toLowerCase()
        .includes(deferredProjectSearch),
    );
  }, [deferredProjectSearch, scopedProjects]);

  const operationalInventoryByEquipmentId = useMemo(() => {
    const map = new Map<string, ExtendedInventoryRecord>();
    scopedExtendedInventory
      .filter((item) => item.famille_equipement === "Bassin de natation")
      .forEach((item) => {
        map.set(item.id_equipement, item);
      });
    return map;
  }, [scopedExtendedInventory]);

  const basinsBeforeManagementFilter = useMemo(() => {
    return scopedBasins
      .filter((item) => {
        if (basinUsageFilter === "school") {
          return item.usage_scolaires === 1;
        }
        if (basinUsageFilter === "qpv") {
          return item.qpv_flag === 1 || item.qpv_200m_flag === 1;
        }
        return true;
      })
      .filter(
        (item) =>
          localityTypeFilter === "all" ||
          (communeTypologyLookup.get(item.code_commune) ?? "Non renseigné") === localityTypeFilter,
      )
      .filter((item) => {
        const statusCode =
          operationalInventoryByEquipmentId.get(item.id_equipement)?.operational_status_code ?? "verify";
        return matchesFacilityOperationalStatusFilter(statusCode, operationalStatusFilter);
      })
      .filter((item) => {
        if (!deferredBasinSearch) {
          return true;
        }
        return `${item.installation} ${item.equipement} ${item.commune} ${item.epci_nom}`
          .toLowerCase()
          .includes(deferredBasinSearch);
      });
  }, [
    basinUsageFilter,
    communeTypologyLookup,
    deferredBasinSearch,
    localityTypeFilter,
    operationalInventoryByEquipmentId,
    operationalStatusFilter,
    scopedBasins,
  ]);
  const installationManagementLabelLookup = useMemo(() => {
    const labelsByInstallation = new Map<string, Set<string>>();
    basinsBeforeManagementFilter.forEach((item) => {
      const key = item.id_installation || item.id_equipement;
      if (!key) {
        return;
      }
      const labels = labelsByInstallation.get(key) ?? new Set<string>();
      labels.add(item.mode_gestion_calcule);
      labelsByInstallation.set(key, labels);
    });
    return new Map(
      Array.from(labelsByInstallation.entries()).map(([key, labels]) => [key, summarizeMapManagementLabel(Array.from(labels))]),
    );
  }, [basinsBeforeManagementFilter]);
  const filteredBasins = useMemo(() => {
    return basinsBeforeManagementFilter.filter((item) => {
      if (managementFilter === "all") {
        return true;
      }
      if (inventoryCountMode === "installations") {
        const installationKey = item.id_installation || item.id_equipement;
        const label = installationManagementLabelLookup.get(installationKey) ?? item.mode_gestion_calcule;
        return label === managementFilter;
      }
      return item.mode_gestion_calcule === managementFilter;
    });
  }, [basinsBeforeManagementFilter, installationManagementLabelLookup, inventoryCountMode, managementFilter]);

  const filteredExtendedInventory = useMemo(() => {
    return scopedExtendedInventory
      .filter(
        (item) =>
          localityTypeFilter === "all" ||
          (communeTypologyLookup.get(item.code_commune) ??
            formatCommuneTypology(item.typologie_commune_source)) === localityTypeFilter,
      )
      .filter((item) => matchesFacilityOperationalStatusFilter(item.operational_status_code, operationalStatusFilter))
      .filter((item) => {
        if (!deferredBasinSearch) {
          return true;
        }

        return [
          item.installation,
          item.equipement,
          item.commune,
          item.epci_nom,
          item.type_equipement,
          item.famille_equipement,
          item.particularite_installation,
        ]
          .join(" ")
          .toLowerCase()
          .includes(deferredBasinSearch);
      });
  }, [
    communeTypologyLookup,
    deferredBasinSearch,
    localityTypeFilter,
    operationalStatusFilter,
    scopedExtendedInventory,
  ]);

  const filteredOperationalBasins = useMemo<OperationalBasinRecord[]>(
    () =>
      filteredBasins.map((item) => {
        const extra = operationalInventoryByEquipmentId.get(item.id_equipement);
        return {
          ...item,
          uai: extra?.uai ?? null,
          survey_date: extra?.survey_date ?? null,
          state_change_date: extra?.state_change_date ?? null,
          observation_installation: extra?.observation_installation ?? null,
          observation_equipement: extra?.observation_equipement ?? null,
          handicap_access_types: extra?.handicap_access_types ?? null,
          transport_access_modes: extra?.transport_access_modes ?? null,
          opening_authorized_flag: extra?.opening_authorized_flag ?? 0,
          year_service: extra?.year_service ?? null,
          last_major_works_year: extra?.last_major_works_year ?? null,
          energy_sources: extra?.energy_sources ?? null,
          pmr_access_detail: extra?.pmr_access_detail ?? null,
          sensory_access_detail: extra?.sensory_access_detail ?? null,
          seasonal_only_flag: extra?.seasonal_only_flag ?? 0,
          installation_out_of_service_flag: extra?.installation_out_of_service_flag ?? 0,
          operational_status_code: extra?.operational_status_code ?? "verify",
          operational_status_label: extra?.operational_status_label ?? "Statut à vérifier",
          operational_status_reason: extra?.operational_status_reason ?? null,
          status_source: extra?.status_source ?? null,
          status_source_url: extra?.status_source_url ?? null,
          status_reviewed_at: extra?.status_reviewed_at ?? null,
          status_confidence: extra?.status_confidence ?? null,
          status_verified_by: extra?.status_verified_by ?? null,
          status_is_manual: extra?.status_is_manual ?? 0,
          status_override_comment: extra?.status_override_comment ?? null,
        };
      }),
    [filteredBasins, operationalInventoryByEquipmentId],
  );

  const scopedOperationalBasins = useMemo<OperationalBasinRecord[]>(
    () =>
      scopedBasins.map((item) => {
        const extra = operationalInventoryByEquipmentId.get(item.id_equipement);
        return {
          ...item,
          uai: extra?.uai ?? null,
          survey_date: extra?.survey_date ?? null,
          state_change_date: extra?.state_change_date ?? null,
          observation_installation: extra?.observation_installation ?? null,
          observation_equipement: extra?.observation_equipement ?? null,
          handicap_access_types: extra?.handicap_access_types ?? null,
          transport_access_modes: extra?.transport_access_modes ?? null,
          opening_authorized_flag: extra?.opening_authorized_flag ?? 0,
          year_service: extra?.year_service ?? null,
          last_major_works_year: extra?.last_major_works_year ?? null,
          energy_sources: extra?.energy_sources ?? null,
          pmr_access_detail: extra?.pmr_access_detail ?? null,
          sensory_access_detail: extra?.sensory_access_detail ?? null,
          seasonal_only_flag: extra?.seasonal_only_flag ?? 0,
          installation_out_of_service_flag: extra?.installation_out_of_service_flag ?? 0,
          operational_status_code: extra?.operational_status_code ?? "verify",
          operational_status_label: extra?.operational_status_label ?? "Statut à vérifier",
          operational_status_reason: extra?.operational_status_reason ?? null,
          status_source: extra?.status_source ?? null,
          status_source_url: extra?.status_source_url ?? null,
          status_reviewed_at: extra?.status_reviewed_at ?? null,
          status_confidence: extra?.status_confidence ?? null,
          status_verified_by: extra?.status_verified_by ?? null,
          status_is_manual: extra?.status_is_manual ?? 0,
          status_override_comment: extra?.status_override_comment ?? null,
        };
      }),
    [operationalInventoryByEquipmentId, scopedBasins],
  );

  const facilitySheetOptions = useMemo(() => {
    return [...filteredBasins]
      .sort((left, right) => {
        const installationCompare = left.installation.localeCompare(right.installation, "fr");
        if (installationCompare !== 0) {
          return installationCompare;
        }
        const equipmentCompare = left.equipement.localeCompare(right.equipement, "fr");
        if (equipmentCompare !== 0) {
          return equipmentCompare;
        }
        return left.commune.localeCompare(right.commune, "fr");
      })
      .map((item) => ({
        id: item.id_equipement,
        label: `${item.installation} - ${item.equipement}`,
        meta: `${item.commune} - ${shortDepartment(item.departement)}`,
      }));
  }, [filteredBasins]);

  useEffect(() => {
    if (facilitySheetOptions.length === 0) {
      if (selectedFacilityEquipmentId !== "") {
        setSelectedFacilityEquipmentId("");
      }
      return;
    }

    const hasSelectedOption = facilitySheetOptions.some((item) => item.id === selectedFacilityEquipmentId);
    if (!hasSelectedOption) {
      setSelectedFacilityEquipmentId(facilitySheetOptions[0]?.id ?? "");
    }
  }, [facilitySheetOptions, selectedFacilityEquipmentId]);

  const selectedFacilityBasin = useMemo(() => {
    if (filteredBasins.length === 0) {
      return null;
    }

    return filteredBasins.find((item) => item.id_equipement === selectedFacilityEquipmentId) ?? filteredBasins[0];
  }, [filteredBasins, selectedFacilityEquipmentId]);

  const selectedFacilityOperational = useMemo(() => {
    if (!selectedFacilityBasin) {
      return null;
    }

    return (
      filteredOperationalBasins.find((item) => item.id_equipement === selectedFacilityBasin.id_equipement) ?? null
    );
  }, [filteredOperationalBasins, selectedFacilityBasin]);

  const filteredInstallationStatusRows = useMemo(
    () => {
      const fallbackRows = buildInstallationStatusRows(filteredOperationalBasins);
      if (!data || !Array.isArray(data.installation_status) || data.installation_status.length === 0) {
        return fallbackRows;
      }

      const installationIds = new Set(
        filteredOperationalBasins.map((item) => item.id_installation || item.id_equipement).filter(Boolean),
      );
      return data.installation_status.filter((item) => installationIds.has(item.id_installation));
    },
    [data, filteredOperationalBasins],
  );

  const operationalStatusSummary = useMemo(
    () => buildOperationalStatusSummary(filteredInstallationStatusRows),
    [filteredInstallationStatusRows],
  );

  const filteredStatusReviewQueueRows = useMemo<InstallationStatusReviewQueueRecord[]>(() => {
    if (!data || !Array.isArray(data.status_review_queue) || data.status_review_queue.length === 0) {
      return [];
    }

    const installationIds = new Set(filteredInstallationStatusRows.map((item) => item.id_installation));
    return data.status_review_queue.filter((item) => item.id_installation && installationIds.has(item.id_installation));
  }, [data, filteredInstallationStatusRows]);

  const selectedFacilityInstallationStatus = useMemo(() => {
    if (!selectedFacilityBasin) {
      return null;
    }

    return (
      filteredInstallationStatusRows.find((item) => item.id_installation === selectedFacilityBasin.id_installation) ??
      null
    );
  }, [filteredInstallationStatusRows, selectedFacilityBasin]);

  const selectedFacilityInstallationInventory = useMemo(() => {
    if (!selectedFacilityBasin) {
      return [];
    }

    return scopedExtendedInventory
      .filter((item) => item.id_installation === selectedFacilityBasin.id_installation)
      .sort((left, right) => {
        const familyCompare = left.famille_equipement.localeCompare(right.famille_equipement, "fr");
        if (familyCompare !== 0) {
          return familyCompare;
        }
        const typeCompare = left.type_equipement.localeCompare(right.type_equipement, "fr");
        if (typeCompare !== 0) {
          return typeCompare;
        }
        return left.equipement.localeCompare(right.equipement, "fr");
      });
  }, [scopedExtendedInventory, selectedFacilityBasin]);

  const selectedFacilitySiteSummary = useMemo(
    () => buildExtendedInventorySummary(selectedFacilityInstallationInventory),
    [selectedFacilityInstallationInventory],
  );

  const selectedFacilityFamilyRows = useMemo(
    () => buildExtendedInventoryFamilyBreakdownRows(selectedFacilityInstallationInventory, "equipments"),
    [selectedFacilityInstallationInventory],
  );

  const selectedFacilityTypeRows = useMemo(
    () => buildInventoryTypeBreakdownRows(selectedFacilityInstallationInventory, "equipments"),
    [selectedFacilityInstallationInventory],
  );

  const selectedFacilityActivityRows = useMemo(
    () => buildInventoryActivityRows(selectedFacilityInstallationInventory, "equipments"),
    [selectedFacilityInstallationInventory],
  );

  const selectedFacilitySiteRows = useMemo(() => {
    return selectedFacilityInstallationInventory.map((item) => ({
      id: item.id_equipement,
      equipement: item.equipement,
      family: item.famille_equipement,
      type: item.type_equipement,
      dimensions: formatInventoryDimensions(item),
      activities: splitPipeSeparatedValues(item.activites).slice(0, 3).join(" - ") || "n.c.",
    }));
  }, [selectedFacilityInstallationInventory]);

  const selectedFacilityComparablePeers = useMemo(() => {
    if (!selectedFacilityBasin) {
      return [];
    }

    const profile = getDetailedComparableBasinProfile(selectedFacilityBasin);

    return filteredBasins
      .filter((item) => item.id_equipement !== selectedFacilityBasin.id_equipement)
      .filter((item) => getDetailedComparableBasinProfile(item) === profile)
      .sort((left, right) => {
        const surfaceCompare = (right.surface_bassin_m2 ?? -1) - (left.surface_bassin_m2 ?? -1);
        if (surfaceCompare !== 0) {
          return surfaceCompare;
        }
        const lengthCompare = (right.longueur_m ?? -1) - (left.longueur_m ?? -1);
        if (lengthCompare !== 0) {
          return lengthCompare;
        }
        return left.installation.localeCompare(right.installation, "fr");
      })
      .slice(0, 8);
  }, [filteredBasins, selectedFacilityBasin]);

  const selectedFacilityIdentityFacts = useMemo(() => {
    if (!selectedFacilityBasin) {
      return [];
    }

    const localityType = communeTypologyLookup.get(selectedFacilityBasin.code_commune) ?? "Non renseigné";
    const qpvLabel =
      selectedFacilityBasin.qpv_flag === 1
        ? "En QPV"
        : selectedFacilityBasin.qpv_200m_flag === 1
          ? "À 200 m d'un QPV"
          : "Hors QPV";

    return [
      {
        label: "Installation",
        value: selectedFacilityBasin.installation,
        detail: `Site Data ES : ${formatInteger(selectedFacilitySiteSummary.equipmentsTotal)} équipements recensés.`,
      },
      {
        label: "Territoire",
        value: `${selectedFacilityBasin.commune} - ${shortDepartment(selectedFacilityBasin.departement)}`,
        detail: selectedFacilityBasin.epci_nom,
      },
      {
        label: "Typologie communale",
        value: localityType,
        detail: "Lecture utile pour distinguer rural, périurbain et urbain.",
      },
      {
        label: "Mode de gestion",
        value: selectedFacilityBasin.mode_gestion_calcule,
        detail: "Lecture du socle bassin retenu dans le dashboard.",
      },
      {
        label: "Position QPV",
        value: qpvLabel,
        detail: "Signal de proximité sociale au niveau de l'équipement.",
      },
    ];
  }, [communeTypologyLookup, selectedFacilityBasin, selectedFacilitySiteSummary.equipmentsTotal]);

  const selectedFacilityDimensionFacts = useMemo(() => {
    if (!selectedFacilityBasin) {
      return [];
    }

    return [
      {
        label: "Profil comparable",
        value: getDetailedComparableBasinProfile(selectedFacilityBasin),
        detail: "Comparaison avec des bassins de même famille fonctionnelle.",
      },
      {
        label: "Surface",
        value: formatOptionalMeasure(selectedFacilityBasin.surface_bassin_m2 ?? 0, "m²", 0),
        detail: "Surface renseignée sur la ligne équipement.",
      },
      {
        label: "Longueur",
        value: formatOptionalMeasure(selectedFacilityBasin.longueur_m ?? 0, "m", 0),
        detail: "Format majeur pour distinguer bassin sportif, mixte ou ludique.",
      },
      {
        label: "Couloirs",
        value:
          typeof selectedFacilityBasin.nb_couloirs === "number" && Number.isFinite(selectedFacilityBasin.nb_couloirs)
            ? formatInteger(selectedFacilityBasin.nb_couloirs)
            : "n.c.",
        detail: "Capacité de nage lignée quand le champ est disponible.",
      },
      {
        label: "Profondeur max",
        value: formatOptionalMeasure(selectedFacilityBasin.profondeur_max_m ?? 0, "m", 1),
        detail: "Particulièrement utile pour les fosses et bassins spécialisés.",
      },
    ];
  }, [selectedFacilityBasin]);

  const selectedFacilityOperationalFacts = useMemo(() => {
    if (!selectedFacilityOperational) {
      return [];
    }

    const energies = splitPipeSeparatedValues(selectedFacilityOperational.energy_sources).join(" - ") || "n.c.";
    const transportModes =
      splitPipeSeparatedValues(selectedFacilityOperational.transport_access_modes).join(" - ") || "n.c.";
    const accessibilityLabel = hasAccessibilitySupport(selectedFacilityOperational)
      ? "Renseignée"
      : "Non renseignée";
    const schoolLabel =
      selectedFacilityOperational.usage_scolaires === 1
        ? selectedFacilityOperational.site_scolaire_explicit === 1
          ? "Usage scolaire explicite"
          : "Usage scolaire repéré"
        : "Pas de signal scolaire";
    const statusDetail =
      selectedFacilityInstallationStatus?.operational_status_reason ??
      selectedFacilityOperational.operational_status_reason ??
      "Lecture calculée à partir de Data ES.";
    const verificationDetail =
      selectedFacilityOperational.status_is_manual === 1
        ? [
            selectedFacilityOperational.status_source ?? "Source locale renseignée",
            selectedFacilityOperational.status_reviewed_at
              ? `vérifié le ${formatReviewDateLabel(selectedFacilityOperational.status_reviewed_at)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Aucune vérification locale renseignée.";

    return [
      {
        label: "Statut d'exploitation",
        value: selectedFacilityOperational.operational_status_label,
        detail: statusDetail,
      },
      {
        label: "Vérification",
        value:
          selectedFacilityOperational.status_is_manual === 1 ? "Vérifié manuellement" : "Lecture Data ES calculée",
        detail: verificationDetail,
      },
      {
        label: "Mise en service",
        value:
          typeof selectedFacilityOperational.year_service === "number"
            ? formatYear(selectedFacilityOperational.year_service)
            : "n.c.",
        detail: "Permet de lire l'ancienneté du bassin.",
      },
      {
        label: "Derniers gros travaux",
        value:
          typeof selectedFacilityOperational.last_major_works_year === "number"
            ? formatYear(selectedFacilityOperational.last_major_works_year)
            : "n.c.",
        detail: hasRecentWorks(selectedFacilityOperational)
          ? "Signal de travaux récents dans Data ES."
          : "Aucun repère récent dans le brut Data ES.",
      },
      {
        label: "Énergie",
        value: energies,
        detail: "Source d'énergie déclarée sur l'équipement.",
      },
      {
        label: "Transport",
        value: transportModes,
        detail: "Modes de transport collectif déclarés.",
      },
      {
        label: "Accessibilité",
        value: accessibilityLabel,
        detail: selectedFacilityOperational.pmr_access_detail ?? selectedFacilityOperational.sensory_access_detail ?? "",
      },
      {
        label: "Lecture scolaire",
        value: schoolLabel,
        detail:
          selectedFacilityOperational.uai && selectedFacilityOperational.uai.trim().length > 0
            ? `UAI ${selectedFacilityOperational.uai}`
            : selectedFacilityOperational.opening_authorized_flag === 1
              ? "Arrêté d'ouverture renseigné."
              : "Pas d'UAI renseignée.",
      },
    ];
  }, [selectedFacilityInstallationStatus, selectedFacilityOperational]);

  const selectedFacilitySignalPills = useMemo(() => {
    if (!selectedFacilityBasin) {
      return [];
    }

    const pills = [
      {
        label: selectedFacilityBasin.mode_gestion_calcule,
        className: getFacilitySignalPillClassName(),
      },
      {
        label: getDetailedComparableBasinProfile(selectedFacilityBasin),
        className: getFacilitySignalPillClassName(),
      },
      {
        label: communeTypologyLookup.get(selectedFacilityBasin.code_commune) ?? "Typologie non renseignée",
        className: getFacilitySignalPillClassName(),
      },
      {
        label: selectedFacilityBasin.usage_scolaires === 1 ? "Usage scolaire" : "Hors signal scolaire",
        className: getFacilitySignalPillClassName(),
      },
      {
        label:
          selectedFacilityBasin.qpv_flag === 1
            ? "En QPV"
            : selectedFacilityBasin.qpv_200m_flag === 1
              ? "À 200 m QPV"
              : "Hors QPV",
        className: getFacilitySignalPillClassName(),
      },
    ];

    if (selectedFacilityOperational) {
      pills.push({
        label: selectedFacilityOperational.operational_status_label,
        className: getOperationalStatusPillClassName(selectedFacilityOperational.operational_status_code),
      });
      pills.push({
        label: selectedFacilityOperational.status_is_manual === 1 ? "Vérifié" : "Non vérifié",
        className: getFacilitySignalPillClassName(
          selectedFacilityOperational.status_is_manual === 1 ? "verified" : "default",
        ),
      });
      if (hasTransportAccess(selectedFacilityOperational)) {
        pills.push({
          label: "Transport renseigné",
          className: getFacilitySignalPillClassName("transport"),
        });
      }
      if (hasAccessibilitySupport(selectedFacilityOperational)) {
        pills.push({
          label: "Accessibilité renseignée",
          className: getFacilitySignalPillClassName("accessibility"),
        });
      }
      if (hasRecentWorks(selectedFacilityOperational)) {
        pills.push({
          label: "Travaux récents",
          className: getFacilitySignalPillClassName("works"),
        });
      }
    }

    return pills;
  }, [communeTypologyLookup, selectedFacilityBasin, selectedFacilityOperational]);

  const selectedFacilityReadingMessages = useMemo(() => {
    if (!selectedFacilityBasin) {
      return [];
    }

    const operationalYear =
      selectedFacilityOperational && typeof selectedFacilityOperational.year_service === "number"
        ? formatYear(selectedFacilityOperational.year_service)
        : "n.c.";
    const worksYear =
      selectedFacilityOperational && typeof selectedFacilityOperational.last_major_works_year === "number"
        ? formatYear(selectedFacilityOperational.last_major_works_year)
        : "n.c.";
    const schoolLabel =
      selectedFacilityBasin.usage_scolaires === 1
        ? selectedFacilityBasin.site_scolaire_explicit === 1
          ? "Usage scolaire explicite"
          : "Usage scolaire repéré"
        : "Pas de signal scolaire";
    const qpvLabel =
      selectedFacilityBasin.qpv_flag === 1
        ? "Équipement en QPV"
        : selectedFacilityBasin.qpv_200m_flag === 1
          ? "Équipement à 200 m d'un QPV"
          : "Hors proximité QPV";
    const operationalConditions = selectedFacilityOperational
      ? [
          hasTransportAccess(selectedFacilityOperational) ? "transport" : null,
          hasAccessibilitySupport(selectedFacilityOperational) ? "accessibilité" : null,
          selectedFacilityOperational.opening_authorized_flag === 1 ? "ouverture" : null,
        ].filter((item): item is string => item !== null)
      : [];

    return [
      {
        label: "Profil",
        title: getDetailedComparableBasinProfile(selectedFacilityBasin),
        detail: `${selectedFacilityBasin.type_equipement} · ${formatComparableBasinMetrics(selectedFacilityBasin)}`,
      },
      {
        label: "Contexte",
        title: schoolLabel,
        detail: `${qpvLabel} · gestion ${selectedFacilityBasin.mode_gestion_calcule.toLowerCase()}`,
      },
      {
        label: "Exploitation",
        title: selectedFacilityOperational?.operational_status_label ?? `Mise en service ${operationalYear}`,
        detail:
          worksYear !== "n.c."
            ? `Derniers gros travaux ${worksYear} · ${operationalConditions.join(" + ") || "conditions partielles"}`
            : `Derniers gros travaux n.c. · ${operationalConditions.join(" + ") || "conditions partielles"}`,
      },
      {
        label: "Site",
        title: `${formatInteger(selectedFacilitySiteSummary.equipmentsTotal)} équipements sur site`,
        detail: `${formatInteger(selectedFacilitySiteSummary.nonBassinFamilyEquipmentsTotal)} hors bassin · ${formatInteger(
          selectedFacilitySiteSummary.activitiesTotal,
        )} activités recensées`,
      },
    ];
  }, [selectedFacilityBasin, selectedFacilityOperational, selectedFacilitySiteSummary]);

  const comparableScopedBasins = useMemo(() => {
    return scopedBasins
      .filter(
        (item) =>
          localityTypeFilter === "all" ||
          (communeTypologyLookup.get(item.code_commune) ?? "Non renseigné") === localityTypeFilter,
      )
      .filter((item) => {
        if (!deferredBasinSearch) {
          return true;
        }
        return `${item.installation} ${item.equipement} ${item.commune} ${item.epci_nom} ${item.type_equipement}`
          .toLowerCase()
          .includes(deferredBasinSearch);
      });
  }, [communeTypologyLookup, deferredBasinSearch, localityTypeFilter, scopedBasins]);

  const filteredCommunes = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.communes.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const availableLocalityTypes = useMemo(() => {
    return Array.from(new Set(filteredCommunes.map((item) => formatCommuneTypology(item.typo)))).sort((a, b) =>
      a.localeCompare(b, "fr"),
    );
  }, [filteredCommunes]);

  const filteredSex = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.sex_2024.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const currentOverview = useMemo<Overview | null>(() => {
    if (!data) {
      return null;
    }

    if (selectedDepartment === "all") {
      return data.overview;
    }

    const populationTotal = sumBy(filteredDepartments, "population_2023_communes");
    const bassinsTotal = sumBy(filteredDepartments, "bassins_total");
    const licences2023 = sumBy(filteredDepartments, "licences_ffn_2023");
    const licences2024 = sumBy(filteredDepartments, "licences_ffn_2024_dep");
    const femmesTotal = sumBy(filteredSex, "licences_femmes_2024");
    const licencesTotal2024 = sumBy(filteredSex, "licences_total_2024");

    return {
      population_total: populationTotal,
      communes_total: filteredCommunes.length,
      epci_total: scopedEpci.length,
      installations_total: sumBy(scopedEpci, "installations_total"),
      licences_ffn_2023: licences2023,
      licences_ffn_2024: licences2024,
      part_femmes_ffn_2024: licencesTotal2024 > 0 ? femmesTotal / licencesTotal2024 : 0,
      bassins_total: bassinsTotal,
      bassins_dsp: sumBy(filteredDepartments, "bassins_dsp"),
      bassins_regie: sumBy(filteredDepartments, "bassins_regie"),
      bassins_autre: sumBy(filteredDepartments, "bassins_prive_hors_dsp"),
      bassins_usage_scolaires: sumBy(filteredDepartments, "bassins_usage_scolaires"),
      bassins_site_scolaire_explicit: sumBy(filteredDepartments, "bassins_site_scolaire_explicit"),
      bassins_qpv: sumBy(filteredDepartments, "bassins_qpv"),
      bassins_qpv_200m: sumBy(filteredDepartments, "bassins_qpv_200m"),
      surface_totale_bassins_m2: sumBy(filteredDepartments, "surface_totale_bassins_m2"),
      bassins_pour_100k_hab: populationTotal > 0 ? (bassinsTotal / populationTotal) * 100000 : 0,
      licences_ffn_pour_1000hab: populationTotal > 0 ? (licences2024 / populationTotal) * 1000 : 0,
      communes_avec_licences_sans_bassin: filteredCommunes.filter(
        (item) => item.licences_ffn_2023 > 0 && item.bassins_total === 0,
      ).length,
    };
  }, [data, filteredCommunes, filteredDepartments, filteredSex, scopedEpci, selectedDepartment]);

  const scopedSchoolEstablishments = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.school_establishments.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const scopedSchoolDemandEpciRows = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.school_demand_epci.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const scopedSchoolDemandInstallations = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.school_demand_installations.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const schoolDemandEpciByCode = useMemo(
    () => new Map(scopedSchoolDemandEpciRows.map((item) => [item.epci_code, item])),
    [scopedSchoolDemandEpciRows],
  );

  const schoolDemandInstallationById = useMemo(
    () => new Map(scopedSchoolDemandInstallations.map((item) => [item.id_installation, item])),
    [scopedSchoolDemandInstallations],
  );

  const scopedCommuneAccessibility = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.commune_accessibility.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const scopedAccessibilityEpciRows = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.accessibility_epci.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const accessibilityEpciByCode = useMemo(
    () => new Map(scopedAccessibilityEpciRows.map((item) => [item.epci_code, item])),
    [scopedAccessibilityEpciRows],
  );

  const scopedCommuneTransit = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.commune_transit.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const scopedTransitEpciRows = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.transit_epci.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const scopedInstallationTransit = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.installation_transit.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const transitEpciByCode = useMemo(
    () => new Map(scopedTransitEpciRows.map((item) => [item.epci_code, item])),
    [scopedTransitEpciRows],
  );

  const installationTransitById = useMemo(
    () => new Map(scopedInstallationTransit.map((item) => [item.id_installation, item])),
    [scopedInstallationTransit],
  );

  const overviewSchoolDemandSummary = useMemo<SchoolDemandOverview>(() => {
    if (!data) {
      return EMPTY_SCHOOL_DEMAND_SUMMARY;
    }

    if (selectedDepartment === "all") {
      return data.school_demand_overview ?? EMPTY_SCHOOL_DEMAND_SUMMARY;
    }

    return buildSchoolDemandSummary(
      scopedSchoolEstablishments,
      scopedBasins.length,
      countUnique(scopedBasins.map((item) => item.id_installation)),
      scopedBasins.filter((item) => item.usage_scolaires === 1).length,
    );
  }, [data, scopedBasins, scopedSchoolEstablishments, selectedDepartment]);

  const overviewAccessibilitySummary = useMemo<AccessibilityOverview>(() => {
    if (!data) {
      return EMPTY_ACCESSIBILITY_SUMMARY;
    }

    if (selectedDepartment === "all") {
      return data.accessibility_overview ?? EMPTY_ACCESSIBILITY_SUMMARY;
    }

    return buildAccessibilitySummary(
      scopedCommuneAccessibility,
      data.accessibility_overview?.installations_total ?? countUnique(scopedBasins.map((item) => item.id_installation)),
    );
  }, [data, scopedBasins, scopedCommuneAccessibility, selectedDepartment]);

  const overviewTransitSummary = useMemo<TransitOverview>(() => {
    if (!data) {
      return EMPTY_TRANSIT_SUMMARY;
    }

    if (selectedDepartment === "all") {
      return data.transit_overview ?? EMPTY_TRANSIT_SUMMARY;
    }

    return buildTransitSummary(
      scopedCommuneTransit,
      scopedInstallationTransit,
      scopedSchoolEstablishments,
      data.transit_overview?.transit_hubs_total ?? 0,
    );
  }, [
    data,
    scopedCommuneTransit,
    scopedInstallationTransit,
    scopedSchoolEstablishments,
    selectedDepartment,
  ]);

  const selectedFacilityInstallationSchoolDemand = useMemo<SchoolDemandInstallationRecord | null>(() => {
    if (!selectedFacilityBasin) {
      return null;
    }

    return schoolDemandInstallationById.get(selectedFacilityBasin.id_installation) ?? null;
  }, [schoolDemandInstallationById, selectedFacilityBasin]);

  const selectedFacilityTransit = useMemo<InstallationTransitRecord | null>(() => {
    if (!selectedFacilityBasin) {
      return null;
    }

    return installationTransitById.get(selectedFacilityBasin.id_installation) ?? null;
  }, [installationTransitById, selectedFacilityBasin]);

  const selectedFacilityAssignedSchools = useMemo<FacilityAssignedSchoolRow[]>(() => {
    if (!selectedFacilityBasin) {
      return [];
    }

    return scopedSchoolEstablishments
      .filter((item) => item.nearest_installation_id === selectedFacilityBasin.id_installation)
      .sort((left, right) => {
        const studentGap = right.students_total - left.students_total;
        if (studentGap !== 0) {
          return studentGap;
        }
        const driveTimeGap =
          (left.drive_time_to_nearest_installation_min ?? Number.POSITIVE_INFINITY) -
          (right.drive_time_to_nearest_installation_min ?? Number.POSITIVE_INFINITY);
        if (driveTimeGap !== 0) {
          return driveTimeGap;
        }
        return left.school_name.localeCompare(right.school_name, "fr");
      })
      .slice(0, 10)
      .map((item) => ({
        uai: item.uai,
        schoolName: item.school_name,
        schoolLevel: item.school_level,
        commune: item.commune ?? "Commune n.c.",
        studentsTotal: item.students_total,
        distanceToInstallationKm: item.distance_to_nearest_installation_km,
        driveDistanceToInstallationKm: item.drive_distance_to_nearest_installation_km,
        driveTimeToInstallationMin: item.drive_time_to_nearest_installation_min,
      }));
  }, [scopedSchoolEstablishments, selectedFacilityBasin]);

  const selectedFacilitySchoolFacts = useMemo(() => {
    if (!selectedFacilityInstallationSchoolDemand) {
      return [];
    }

    return [
      {
        label: "Établissements rattachés",
        value: formatInteger(selectedFacilityInstallationSchoolDemand.schools_total),
        detail: `${formatInteger(selectedFacilityInstallationSchoolDemand.schools_geolocated_total)} géolocalisés`,
      },
      {
        label: "Élèves potentiels",
        value: formatInteger(selectedFacilityInstallationSchoolDemand.students_total),
        detail: `${formatInteger(selectedFacilityInstallationSchoolDemand.primary_students)} premier degré`,
      },
      {
        label: "Élèves / bassin du site",
        value: formatNumber(selectedFacilityInstallationSchoolDemand.students_per_basin_on_site, 1),
        detail: `${formatInteger(selectedFacilityInstallationSchoolDemand.basins_total_on_site)} bassins sur site`,
      },
      {
        label: "Distance moyenne",
        value: formatKilometers(
          selectedFacilityInstallationSchoolDemand.average_distance_to_installation_km,
        ),
        detail: `${formatPercent(selectedFacilityInstallationSchoolDemand.distance_coverage_share)} des élèves géolocalisés`,
      },
      {
        label: "À moins de 5 km",
        value: formatPercent(
          selectedFacilityInstallationSchoolDemand.students_within_5km_installation_share,
        ),
        detail: "Part des élèves géolocalisés affectés à ce site.",
      },
    ];
  }, [selectedFacilityInstallationSchoolDemand]);

  const selectedFacilitySchoolDriveFacts = useMemo(() => {
    if (!selectedFacilityInstallationSchoolDemand) {
      return [];
    }

    return [
      {
        label: "Établissements rattachés",
        value: formatInteger(selectedFacilityInstallationSchoolDemand.schools_total),
        detail: `${formatInteger(selectedFacilityInstallationSchoolDemand.schools_geolocated_total)} géolocalisés`,
      },
      {
        label: "Élèves potentiels",
        value: formatInteger(selectedFacilityInstallationSchoolDemand.students_total),
        detail: `${formatInteger(selectedFacilityInstallationSchoolDemand.primary_students)} premier degré`,
      },
      {
        label: "Élèves / bassin du site",
        value: formatNumber(selectedFacilityInstallationSchoolDemand.students_per_basin_on_site, 1),
        detail: `${formatInteger(selectedFacilityInstallationSchoolDemand.basins_total_on_site)} bassins sur site`,
      },
      {
        label: "Temps moyen voiture",
        value: formatMinutes(
          selectedFacilityInstallationSchoolDemand.average_drive_time_to_installation_min,
        ),
        detail: `${formatPercent(selectedFacilityInstallationSchoolDemand.drive_time_coverage_share)} des élèves avec temps calculé`,
      },
      {
        label: "Élèves < 15 min",
        value: formatPercent(
          selectedFacilityInstallationSchoolDemand.students_within_15min_installation_share,
        ),
        detail: "Part des élèves avec temps voiture calculé affectés à ce site.",
      },
    ];
  }, [selectedFacilityInstallationSchoolDemand]);

  const selectedFacilityTransitFacts = useMemo(() => {
    if (!selectedFacilityTransit) {
      return [];
    }

    return [
      {
        label: "Arrêt ou gare le plus proche",
        value: formatKilometers(selectedFacilityTransit.nearest_transit_distance_km),
        detail: selectedFacilityTransit.nearest_transit_hub ?? "Repère GTFS non disponible",
      },
      {
        label: "Arrêts actifs < 500 m",
        value: formatInteger(selectedFacilityTransit.active_transit_hubs_within_500m),
        detail: `${formatInteger(selectedFacilityTransit.active_transit_hubs_within_1000m)} arrêts actifs à 1 km`,
      },
      {
        label: "Passages théoriques < 500 m",
        value: formatInteger(selectedFacilityTransit.weekday_trips_within_500m),
        detail: `${formatInteger(selectedFacilityTransit.weekday_trips_within_1000m)} passages théoriques à 1 km`,
      },
      {
        label: "Modes repérés",
        value: selectedFacilityTransit.nearest_transit_modes ?? "n.c.",
        detail: "Lecture GTFS potentielle en semaine, sans calcul porte-à-porte.",
      },
    ];
  }, [selectedFacilityTransit]);

  const licenceTrendSummary = useMemo(() => {
    const licences2023 = sumBy(filteredDepartments, "licences_ffn_2023");
    const licences2024 = sumBy(filteredDepartments, "licences_ffn_2024_dep");
    const delta = licences2024 - licences2023;

    return {
      licences2023,
      licences2024,
      delta,
      deltaShare: safeDivide(delta, licences2023),
    };
  }, [filteredDepartments]);

  const licenceTrendRows = useMemo<LicenceTrendRow[]>(() => {
    return [...filteredDepartments]
      .map((item) => {
        const delta = item.licences_ffn_2024_dep - item.licences_ffn_2023;
        return {
          code: item.code_departement,
          label: item.departement,
          licences2023: item.licences_ffn_2023,
          licences2024: item.licences_ffn_2024_dep,
          delta,
          deltaShare: safeDivide(delta, item.licences_ffn_2023),
        };
      })
      .sort((left, right) => right.delta - left.delta);
  }, [filteredDepartments]);

  const qpvScopeSummary = useMemo(() => {
    const qpvPopulation = sumBy(filteredDepartments, "pop_qpv");
    const qpvCount = sumBy(scopedEpci, "nb_qpv");
    const bassinsQpv = sumBy(scopedEpci, "bassins_qpv");
    const bassinsQpv200m = sumBy(scopedEpci, "bassins_qpv_200m");

    return {
      qpvPopulation,
      qpvCount,
      bassinsQpv,
      bassinsQpv200m,
      qpvPopulationShare: currentOverview ? safeDivide(qpvPopulation, currentOverview.population_total) : 0,
      bassinsParQpv: safeDivide(bassinsQpv200m, qpvCount),
      coveragePer100kQpv: safeDivide(bassinsQpv200m, qpvPopulation) * 100000,
      directCoveragePer100kQpv: safeDivide(bassinsQpv, qpvPopulation) * 100000,
    };
  }, [currentOverview, filteredDepartments, scopedEpci]);

  const qpvFragilityRows = useMemo<QpvFragilityRow[]>(() => {
    const rows = scopedEpci
      .filter((item) => item.pop_qpv > 0 || item.nb_qpv > 0)
      .map((item) => ({
        epci_code: item.epci_code,
        epci_nom: item.epci_nom,
        departement: item.departement,
        qpvCount: item.nb_qpv,
        qpvPopulation: item.pop_qpv,
        qpvShare: item.part_population_qpv,
        bassinsQpv: item.bassins_qpv,
        bassinsQpv200m: item.bassins_qpv_200m,
        bassinsParQpv: safeDivide(item.bassins_qpv_200m, item.nb_qpv),
        coveragePer100kQpv: safeDivide(item.bassins_qpv_200m, item.pop_qpv) * 100000,
        directCoveragePer100kQpv: safeDivide(item.bassins_qpv, item.pop_qpv) * 100000,
        fragilityScore: 0,
      }));

    if (rows.length === 0) {
      return [];
    }

    const qpvShareRankMap = buildRankMap(rows, (item) => item.qpvShare);
    const qpvPopulationRankMap = buildRankMap(rows, (item) => item.qpvPopulation);
    const qpvCoverageRankMap = buildRankMap(rows, (item) => item.coveragePer100kQpv);
    const qpvDirectCoverageRankMap = buildRankMap(rows, (item) => item.directCoveragePer100kQpv);

    return rows
      .map((item) => ({
        ...item,
        fragilityScore:
          average([
            qpvShareRankMap.get(item.epci_code) ?? 0,
            qpvPopulationRankMap.get(item.epci_code) ?? 0,
            1 - (qpvCoverageRankMap.get(item.epci_code) ?? 0),
            1 - (qpvDirectCoverageRankMap.get(item.epci_code) ?? 0),
          ]) * 100,
      }))
      .sort((left, right) => right.fragilityScore - left.fragilityScore);
  }, [scopedEpci]);

  const qpvFragilityChartRows = useMemo(
    () =>
      qpvFragilityRows.slice(0, 8).map((item) => ({
        epci_code: item.epci_code,
        epci_nom: shortenEpci(item.epci_nom, 34),
        fullLabel: `${item.epci_nom} (${shortDepartment(item.departement)})`,
        value: item.fragilityScore,
        kind: "count" as const,
        seriesLabel: "Fragilité sociale QPV",
      })),
    [qpvFragilityRows],
  );

  const activeMetricOption = METRIC_OPTIONS.find((item) => item.key === selectedMetric) ?? METRIC_OPTIONS[0];
  const activeInvestigationLens =
    INVESTIGATION_LENS_OPTIONS.find((item) => item.key === investigationLens) ?? INVESTIGATION_LENS_OPTIONS[0];
  const activeComparableProfileScope =
    COMPARABLE_PROFILE_SCOPE_OPTIONS.find((item) => item.key === comparableProfileScope) ??
    COMPARABLE_PROFILE_SCOPE_OPTIONS[0];
  const activeComparableBasinContext =
    COMPARABLE_BASIN_CONTEXT_OPTIONS.find((item) => item.key === comparableBasinContext) ??
    COMPARABLE_BASIN_CONTEXT_OPTIONS[0];
  const activeOverviewView =
    OVERVIEW_VIEW_OPTIONS.find((item) => item.key === overviewView) ?? OVERVIEW_VIEW_OPTIONS[0];
  const activeTerritoriesView =
    TERRITORIES_VIEW_OPTIONS.find((item) => item.key === territoriesView) ?? TERRITORIES_VIEW_OPTIONS[0];
  const activeFacilitiesView =
    FACILITIES_VIEW_OPTIONS.find((item) => item.key === facilitiesView) ?? FACILITIES_VIEW_OPTIONS[0];

  const epciRanking = useMemo(() => {
    return filteredEpci
      .map((item) => {
        const value = activeMetricOption.getValue(item);
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
          return null;
        }

        return {
          epci_nom: item.epci_nom,
          fullLabel: `${item.epci_nom} (${shortDepartment(item.departement)})`,
          value: Number(value),
          kind: activeMetricOption.kind,
          seriesLabel: activeMetricOption.label,
        };
      })
      .filter(
        (
          item,
        ): item is {
          epci_nom: string;
          fullLabel: string;
          value: number;
          kind: MetricKind;
          seriesLabel: string;
        } => Boolean(item),
      )
      .sort((left, right) => right.value - left.value)
      .slice(0, rankingLimit);
  }, [activeMetricOption, filteredEpci, rankingLimit]);

  const departmentComparison = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.departments.map((item) => ({
      label: shortDepartment(item.departement),
      bassins_pour_100k_hab: item.bassins_pour_100k_hab,
      licences_ffn_pour_1000hab: item.licences_ffn_pour_1000hab,
      highlight: selectedDepartment === "all" || item.code_departement === selectedDepartment,
    }));
  }, [data, selectedDepartment]);

  const ageSeries = useMemo(
    () => buildAgeSeries(data?.age_sex ?? [], selectedDepartment),
    [data, selectedDepartment],
  );

  const comparableScopedInstallationCount = useMemo(
    () => countUnique(comparableScopedBasins.map((item) => item.id_installation)),
    [comparableScopedBasins],
  );

  const inventoryCountModeLabel =
    inventoryCountMode === "equipments" ? "équipements" : "installations";

  const countedTypeBreakdown = useMemo(
    () => buildInventoryTypeBreakdownRows(filteredBasins, inventoryCountMode),
    [filteredBasins, inventoryCountMode],
  );

  const countedActivityBreakdown = useMemo(
    () => buildInventoryActivityRows(filteredBasins, inventoryCountMode),
    [filteredBasins, inventoryCountMode],
  );

  const filteredExtendedInventorySummary = useMemo(
    () => buildExtendedInventorySummary(filteredExtendedInventory),
    [filteredExtendedInventory],
  );

  const extendedFamilyBreakdown = useMemo(
    () => buildExtendedInventoryFamilyBreakdownRows(filteredExtendedInventory, inventoryCountMode),
    [filteredExtendedInventory, inventoryCountMode],
  );

  const extendedTypeBreakdown = useMemo(
    () => buildInventoryTypeBreakdownRows(filteredExtendedInventory, inventoryCountMode),
    [filteredExtendedInventory, inventoryCountMode],
  );

  const extendedActivityBreakdown = useMemo(
    () => buildInventoryActivityRows(filteredExtendedInventory, inventoryCountMode),
    [filteredExtendedInventory, inventoryCountMode],
  );

  const extendedParticularityBreakdown = useMemo(
    () => buildExtendedInventoryParticularityRows(filteredExtendedInventory, inventoryCountMode),
    [filteredExtendedInventory, inventoryCountMode],
  );

  const operationalSummary = useMemo(
    () => buildOperationalSummary(filteredOperationalBasins),
    [filteredOperationalBasins],
  );

  const overviewOperationalSummary = useMemo(
    () => buildOperationalSummary(scopedOperationalBasins),
    [scopedOperationalBasins],
  );

  const schoolOperationalBasins = useMemo(
    () => filteredOperationalBasins.filter((item) => item.usage_scolaires === 1),
    [filteredOperationalBasins],
  );

  const schoolOperationalSummary = useMemo(
    () => buildOperationalSummary(schoolOperationalBasins),
    [schoolOperationalBasins],
  );

  const overviewSchoolOperationalBasins = useMemo(
    () => scopedOperationalBasins.filter((item) => item.usage_scolaires === 1),
    [scopedOperationalBasins],
  );

  const overviewSchoolOperationalSummary = useMemo(
    () => buildOperationalSummary(overviewSchoolOperationalBasins),
    [overviewSchoolOperationalBasins],
  );

  const serviceYearBreakdown = useMemo(
    () => buildOperationalServiceYearRows(filteredOperationalBasins, inventoryCountMode),
    [filteredOperationalBasins, inventoryCountMode],
  );

  const energyBreakdown = useMemo(
    () =>
      buildOperationalMultiValueBreakdownRows(
        filteredOperationalBasins,
        (item) => splitPipeSeparatedValues(item.energy_sources),
        inventoryCountMode,
      ),
    [filteredOperationalBasins, inventoryCountMode],
  );

  const transportBreakdown = useMemo(
    () =>
      buildOperationalMultiValueBreakdownRows(
        filteredOperationalBasins,
        (item) => splitPipeSeparatedValues(item.transport_access_modes),
        inventoryCountMode,
      ),
    [filteredOperationalBasins, inventoryCountMode],
  );

  const schoolConditionRows = useMemo(
    () =>
      buildOperationalConditionRows(
        schoolOperationalBasins,
        [
          { label: "Accès transport renseigné", test: (item) => hasTransportAccess(item) },
          { label: "Accessibilité renseignée", test: (item) => hasAccessibilitySupport(item) },
          { label: "Arrêté d'ouverture", test: (item) => item.opening_authorized_flag === 1 },
          { label: "Travaux depuis 2015", test: (item) => hasRecentWorks(item) },
        ],
        inventoryCountMode,
      ),
    [inventoryCountMode, schoolOperationalBasins],
  );

  const schoolServiceYearBreakdown = useMemo(
    () => buildOperationalServiceYearRows(schoolOperationalBasins, inventoryCountMode),
    [inventoryCountMode, schoolOperationalBasins],
  );

  const territorySurfaceRows = useMemo(() => {
    return [...scopedEpci]
      .filter((item) => item.bassins_total > 0 || item.surface_totale_bassins_m2 > 0)
      .map((item) => ({
        epci_code: item.epci_code,
        epci_nom: item.epci_nom,
        departement: item.departement,
        bassins: item.bassins_total,
        totalSurface: item.surface_totale_bassins_m2,
        surfacePer1000Hab:
          safeDivide(item.surface_totale_bassins_m2, item.population_2023_communes) * 1000,
        averageSurface: safeDivide(item.surface_totale_bassins_m2, item.bassins_total),
      }))
      .sort((left, right) => right.surfacePer1000Hab - left.surfacePer1000Hab);
  }, [scopedEpci]);

  const overviewOperationalTerritoryRows = useMemo(
    () => buildOperationalTerritoryRows(scopedEpci, scopedOperationalBasins),
    [scopedEpci, scopedOperationalBasins],
  );

  const overviewAccessibilityHighlights = useMemo<AccessibilityHighlightRow[]>(() => {
    const remoteEpci =
      [...scopedAccessibilityEpciRows].sort(
        (left, right) =>
          (right.average_drive_time_to_installation_min ?? 0) -
          (left.average_drive_time_to_installation_min ?? 0),
      )[0] ?? null;

    return [
      {
        label: "Temps moyen",
        value: formatMinutes(overviewAccessibilitySummary.average_drive_time_to_installation_min),
        detail: `${formatInteger(overviewAccessibilitySummary.communes_routed_total)} communes calculées`,
      },
      {
        label: "Population < 15 min",
        value: formatPercent(overviewAccessibilitySummary.population_within_15min_share),
        detail: `${formatPercent(overviewAccessibilitySummary.population_within_20min_share)} sous 20 min`,
      },
      {
        label: "Communes < 15 min",
        value: formatPercent(overviewAccessibilitySummary.communes_within_15min_share),
        detail: `${formatInteger(overviewAccessibilitySummary.reachable_installations_total)} installations mobilisées`,
      },
      {
        label: "Point d'attention",
        value: remoteEpci ? shortenEpci(remoteEpci.epci_nom ?? "EPCI", 24) : "n.c.",
        detail: remoteEpci
          ? `${formatMinutes(remoteEpci.average_drive_time_to_installation_min)} de moyenne voiture`
          : "Aucune lecture EPCI n'est disponible sur ce périmètre.",
      },
    ];
  }, [overviewAccessibilitySummary, scopedAccessibilityEpciRows]);

  const overviewTransitHighlights = useMemo<AccessibilityHighlightRow[]>(() => {
    const bestConnectedEpci =
      [...scopedTransitEpciRows].sort(
        (left, right) =>
          (left.average_nearest_stop_distance_km ?? Number.POSITIVE_INFINITY) -
          (right.average_nearest_stop_distance_km ?? Number.POSITIVE_INFINITY),
      )[0] ?? null;

    return [
      {
        label: "Distance moyenne à un arrêt",
        value: formatKilometers(overviewTransitSummary.average_nearest_stop_distance_km),
        detail: `${formatInteger(overviewTransitSummary.transit_hubs_total)} arrêts ou gares actifs`,
      },
      {
        label: "Population < 500 m",
        value: formatPercent(overviewTransitSummary.population_within_500m_share),
        detail: `${formatPercent(overviewTransitSummary.population_within_1000m_share)} à moins d'1 km`,
      },
      {
        label: "Installations < 500 m",
        value: formatPercent(overviewTransitSummary.installations_within_500m_share),
        detail: `${formatPercent(overviewTransitSummary.installations_within_1000m_share)} à moins d'1 km`,
      },
      {
        label: "Point d'appui",
        value: bestConnectedEpci ? shortenEpci(bestConnectedEpci.epci_nom ?? "EPCI", 24) : "n.c.",
        detail: bestConnectedEpci
          ? `${formatKilometers(bestConnectedEpci.average_nearest_stop_distance_km)} de distance moyenne`
          : "Aucune lecture EPCI GTFS n'est disponible sur ce périmètre.",
      },
    ];
  }, [overviewTransitSummary, scopedTransitEpciRows]);

  const specializedEquipmentCount = useMemo(
    () => scopedBasins.filter((item) => !CORE_AQUATIC_TYPES.has(item.type_equipement)).length,
    [scopedBasins],
  );

  const divingEquipmentCount = useMemo(
    () => scopedBasins.filter((item) => isDivingEquipment(item)).length,
    [scopedBasins],
  );

  const physicalStats = useMemo(() => {
    const surfaces = filteredBasins
      .map((item) => item.surface_bassin_m2)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const lengths = filteredBasins
      .map((item) => item.longueur_m)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const lanes = filteredBasins
      .map((item) => item.nb_couloirs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    return {
      totalSurface: surfaces.reduce((total, value) => total + value, 0),
      averageSurface: average(surfaces),
      averageLength: average(lengths),
      averageLanes: average(lanes),
      surfaceCoverage: safeDivide(surfaces.length, filteredBasins.length),
      lengthCoverage: safeDivide(lengths.length, filteredBasins.length),
      lanesCoverage: safeDivide(lanes.length, filteredBasins.length),
    };
  }, [filteredBasins]);

  const surfaceDistribution = useMemo(() => {
    return SURFACE_BUCKETS.map((bucket) => ({
      label: bucket.label,
      value: filteredBasins.filter(
        (item) =>
          typeof item.surface_bassin_m2 === "number" &&
          item.surface_bassin_m2 >= bucket.min &&
          item.surface_bassin_m2 < bucket.max,
      ).length,
      kind: "count" as const,
      seriesLabel: "Équipements",
    }));
  }, [filteredBasins]);

  const lengthDistribution = useMemo(() => {
    return LENGTH_BUCKETS.map((bucket) => ({
      label: bucket.label,
      value: filteredBasins.filter(
        (item) =>
          typeof item.longueur_m === "number" &&
          item.longueur_m >= bucket.min &&
          item.longueur_m < bucket.max,
      ).length,
      kind: "count" as const,
      seriesLabel: "Équipements",
    }));
  }, [filteredBasins]);

  const schoolScopeGap = useMemo(() => {
    if (!currentOverview) {
      return {
        usageCount: 0,
        explicitCount: 0,
        delta: 0,
        explicitShare: 0,
      };
    }

    const usageCount = currentOverview.bassins_usage_scolaires;
    const explicitCount = currentOverview.bassins_site_scolaire_explicit;

    return {
      usageCount,
      explicitCount,
      delta: usageCount - explicitCount,
      explicitShare: safeDivide(explicitCount, usageCount),
    };
  }, [currentOverview]);

  const localitySignals = useMemo(
    () => buildLocalitySignals(data, scopedEpci, scopedBasins),
    [data, scopedBasins, scopedEpci],
  );

  const mapSourcePoints = useMemo<FacilityMapPoint[]>(
    () =>
      inventoryCountMode === "installations"
        ? buildInstallationMapPoints(filteredOperationalBasins)
        : buildEquipmentMapPoints(filteredOperationalBasins),
    [filteredOperationalBasins, inventoryCountMode],
  );
  const mapDisplayPoints = useMemo(
    () => buildFacilityMapDisplayItems(mapSourcePoints, facilityMapZoom),
    [facilityMapZoom, mapSourcePoints],
  );
  const selectedMapPoint = useMemo(
    () => mapSourcePoints.find((item) => item.id === selectedMapPointId) ?? null,
    [mapSourcePoints, selectedMapPointId],
  );
  const mapPointLabel = inventoryCountMode === "equipments" ? "équipements" : "installations";
  const mapSearchSuggestions = useMemo<FacilityMapSearchSuggestion[]>(() => {
    const query = basinSearch.trim().toLowerCase();
    if (query.length < 2) {
      return [];
    }

    const suggestions: FacilityMapSearchSuggestion[] = [];
    const seenInstallations = new Set<string>();
    const communeGroups = new Map<string, FacilityMapPoint[]>();

    mapSourcePoints.forEach((item) => {
      const installationKey = `${item.installation}|${item.commune}|${item.departement}`.toLowerCase();
      const installationText = `${item.installation} ${item.commune}`.toLowerCase();
      if (!seenInstallations.has(installationKey) && installationText.includes(query)) {
        seenInstallations.add(installationKey);
        suggestions.push({
          id: `installation-${item.id}`,
          kind: "installation",
          title: item.installation,
          detail: `${item.commune} · ${shortDepartment(item.departement)} · ${item.managementLabel}`,
          queryValue: item.installation,
          pointId: item.id,
        });
      }

      const communeKey = `${item.commune}|${item.departement}`;
      const rows = communeGroups.get(communeKey) ?? [];
      rows.push(item);
      communeGroups.set(communeKey, rows);
    });

    const communeSuggestions = Array.from(communeGroups.entries())
      .filter(([key]) => key.toLowerCase().includes(query))
      .map(([key, rows]) => {
        const [commune, departement] = key.split("|");
        return {
          id: `commune-${key}`,
          kind: "commune" as const,
          title: commune,
          detail: `${formatInteger(rows.length)} ${mapPointLabel} visibles · ${shortDepartment(departement)}`,
          queryValue: commune,
          pointId: null,
        };
      });

    return [...suggestions.slice(0, 5), ...communeSuggestions.slice(0, 4)].slice(0, 8);
  }, [basinSearch, mapPointLabel, mapSourcePoints]);
  const mapStatusBreakdown = useMemo(
    () =>
      OPERATIONAL_STATUS_LEGEND.map((item) => ({
        name: item.label,
        value: mapSourcePoints.filter((row) => row.operational_status_code === item.key).length,
        color: OPERATIONAL_STATUS_COLORS[item.key],
      })).filter((item) => item.value > 0),
    [mapSourcePoints],
  );
  const mapContextBreakdown = useMemo(() => {
    const definitions = [
      {
        key: "school_qpv",
        name: "Scolaire + QPV",
        color: "#b34000",
        matches: (item: FacilityMapPoint) =>
          item.usage_scolaires === 1 && (item.qpv_flag === 1 || item.qpv_200m_flag === 1),
      },
      {
        key: "school_only",
        name: "Scolaire",
        color: "#6a6af4",
        matches: (item: FacilityMapPoint) =>
          item.usage_scolaires === 1 && item.qpv_flag !== 1 && item.qpv_200m_flag !== 1,
      },
      {
        key: "qpv_only",
        name: "QPV / 200 m",
        color: "#000091",
        matches: (item: FacilityMapPoint) =>
          item.usage_scolaires !== 1 && (item.qpv_flag === 1 || item.qpv_200m_flag === 1),
      },
      {
        key: "standard",
        name: "Sans signal",
        color: "#7a7a7a",
        matches: (item: FacilityMapPoint) =>
          item.usage_scolaires !== 1 && item.qpv_flag !== 1 && item.qpv_200m_flag !== 1,
      },
    ] as const;

    return definitions
      .map((definition) => ({
        name: definition.name,
        value: mapSourcePoints.filter((item) => definition.matches(item)).length,
        color: definition.color,
      }))
      .filter((item) => item.value > 0);
  }, [mapSourcePoints]);
  const managementBreakdown = useMemo(
    () =>
      Array.from(
        mapSourcePoints.reduce((counters, item) => {
          counters.set(item.managementLabel, (counters.get(item.managementLabel) ?? 0) + 1);
          return counters;
        }, new Map<string, number>()).entries(),
      )
        .map(([label, count]) => ({
          name: label,
          value: count,
          color: getManagementColor(label),
        }))
        .sort((left, right) => right.value - left.value),
    [mapSourcePoints],
  );
  const mapPanelFilterPills = useMemo(() => {
    const pills = [inventoryCountMode === "equipments" ? "Maille : équipements" : "Maille : installations"];
    if (managementFilter !== "all") {
      pills.push(`Gestion : ${managementFilter}`);
    }
    if (operationalStatusFilter !== "all") {
      pills.push(`Statut : ${getFacilityOperationalStatusFilterLabel(operationalStatusFilter)}`);
    }
    if (basinUsageFilter === "school") {
      pills.push("Contexte : scolaire");
    }
    if (basinUsageFilter === "qpv") {
      pills.push("Contexte : QPV ou 200 m");
    }
    if (localityTypeFilter !== "all") {
      pills.push(`Typologie : ${localityTypeFilter}`);
    }
    if (basinSearch) {
      pills.push(`Recherche : ${basinSearch}`);
    }
    if (!showProjectMarkers) {
      pills.push("Projets en cours : masqu\u00e9s");
    }
    return pills;
  }, [
    basinSearch,
    basinUsageFilter,
    inventoryCountMode,
    localityTypeFilter,
    managementFilter,
    operationalStatusFilter,
    showProjectMarkers,
  ]);
  const mapCustomFilterCount = useMemo(() => {
    let count = 0;
    if (inventoryCountMode !== "installations") {
      count += 1;
    }
    if (managementFilter !== "all") {
      count += 1;
    }
    if (operationalStatusFilter !== "all") {
      count += 1;
    }
    if (basinUsageFilter !== "all") {
      count += 1;
    }
    if (localityTypeFilter !== "all") {
      count += 1;
    }
    if (basinSearch) {
      count += 1;
    }
    if (!showProjectMarkers) {
      count += 1;
    }
    return count;
  }, [
    basinSearch,
    basinUsageFilter,
    inventoryCountMode,
    localityTypeFilter,
    managementFilter,
    operationalStatusFilter,
    showProjectMarkers,
  ]);
  const mapDisplaySummary = useMemo(() => {
    const clusterCount = mapDisplayPoints.filter((item) => item.kind === "cluster").length;
    const individualCount = mapDisplayPoints.length - clusterCount;
    const closedCount = mapSourcePoints.filter(
      (item) => item.operational_status_code === "closed" || item.operational_status_code === "temporary_closed",
    ).length;
    const verifyCount = mapSourcePoints.filter((item) => item.operational_status_code === "verify").length;
    return {
      clusterCount,
      individualCount,
      closedCount,
      verifyCount,
    };
  }, [mapDisplayPoints, mapSourcePoints]);
  const mapStatusLegendItems = useMemo(
    () =>
      OPERATIONAL_STATUS_LEGEND.map((item) => ({
        ...item,
        color: OPERATIONAL_STATUS_COLORS[item.key],
        count: mapSourcePoints.filter((row) => row.operational_status_code === item.key).length,
      })).filter((item) => item.count > 0),
    [mapSourcePoints],
  );
  const mapManagementFilterOptions = useMemo(
    () =>
      inventoryCountMode === "installations"
        ? [...Object.keys(MANAGEMENT_COLORS), "Gestion mixte"]
        : Object.keys(MANAGEMENT_COLORS),
    [inventoryCountMode],
  );
  const geolocatedProjects = useMemo(
    () =>
      filteredProjects.filter(
        (item) => typeof item.latitude === "number" && typeof item.longitude === "number",
      ),
    [filteredProjects],
  );
  const visibleProjectMarkers = showProjectMarkers ? geolocatedProjects : [];
  const projectBucketBreakdown = useMemo(
    () =>
      PROJECT_BUCKET_OPTIONS.map((item) => ({
        name: item.label,
        value: filteredProjects.filter((row) => row.project_bucket_code === item.key).length,
        color: PROJECT_BUCKET_COLORS[item.key],
      })).filter((item) => item.value > 0),
    [filteredProjects],
  );
  const projectPhaseBreakdown = useMemo(
    () =>
      (
        [
          { key: "works", label: "Travaux en cours" },
          { key: "programming", label: "Programmation" },
          { key: "procedure", label: "Procédure / montage" },
          { key: "consultation", label: "Concertation / étude" },
          { key: "recent_delivery", label: "Livré récemment" },
          { key: "uncertain", label: "Trajectoire incertaine" },
        ] as const
      )
        .map((item) => ({
          name: item.label,
          value: filteredProjects.filter((row) => row.project_phase_code === item.key).length,
          color: PROJECT_PHASE_COLORS[item.key],
        }))
        .filter((item) => item.value > 0),
    [filteredProjects],
  );
  const projectHorizonBreakdown = useMemo(() => {
    const rows = [
      {
        name: "Livrés / imminents",
        value: filteredProjects.filter(
          (item) =>
            item.project_phase_code === "recent_delivery" ||
            (typeof item.opening_sort_value === "number" && item.opening_sort_value <= 202612),
        ).length,
        color: "#18753c",
      },
      {
        name: "Horizon 2027-2028",
        value: filteredProjects.filter(
          (item) =>
            typeof item.opening_sort_value === "number" &&
            item.opening_sort_value >= 202701 &&
            item.opening_sort_value <= 202812,
        ).length,
        color: "#000091",
      },
      {
        name: "2029 et après",
        value: filteredProjects.filter(
          (item) => typeof item.opening_sort_value === "number" && item.opening_sort_value >= 202901,
        ).length,
        color: "#6a6af4",
      },
      {
        name: "Échéance non précisée",
        value: filteredProjects.filter((item) => item.opening_sort_value === null).length,
        color: "#7a7a7a",
      },
    ];
    return rows.filter((item) => item.value > 0);
  }, [filteredProjects]);
  const projectSummaryCards = useMemo<ProjectSummaryCard[]>(
    () => [
      {
        label: "Projets repérés",
        value: formatInteger(filteredProjects.length),
        detail: `${formatInteger(geolocatedProjects.length)} repères cartographiques disponibles.`,
      },
      {
        label: "Constructions neuves",
        value: formatInteger(filteredProjects.filter((item) => item.project_bucket_code === "new").length),
        detail: "Nouveaux équipements ou centres aquatiques annoncés.",
      },
      {
        label: "Réhabilitations lourdes",
        value: formatInteger(filteredProjects.filter((item) => item.project_bucket_code === "rehab").length),
        detail: "Opérations qui transforment fortement l'offre existante.",
      },
      {
        label: "Échéance proche",
        value: formatInteger(
          filteredProjects.filter(
            (item) =>
              item.project_phase_code === "recent_delivery" ||
              (typeof item.opening_sort_value === "number" && item.opening_sort_value <= 202712),
          ).length,
        ),
        detail: "Livraisons, réouvertures ou ouvertures attendues à court terme.",
      },
    ],
    [filteredProjects, geolocatedProjects.length],
  );

  useEffect(() => {
    if (selectedMapPointId === "") {
      return;
    }
    if (!mapSourcePoints.some((item) => item.id === selectedMapPointId)) {
      setSelectedMapPointId("");
    }
  }, [mapSourcePoints, selectedMapPointId]);

  useEffect(() => {
    if (!deferredBasinSearch || mapSourcePoints.length !== 1) {
      return;
    }
    setSelectedMapPointId((current) => (current === mapSourcePoints[0].id ? current : mapSourcePoints[0].id));
  }, [deferredBasinSearch, mapSourcePoints]);

  const topPressureCommunes = useMemo(
    () => buildPressureCommunes(filteredCommunes),
    [filteredCommunes],
  );

  const rawSheets = useMemo<PreparedRawSheet[]>(() => {
    if (!data) {
      return [];
    }

    return RAW_SHEET_DEFINITIONS.map((definition) => ({
      ...definition,
      rows: definition.getRows(data),
      downloadPath: data.downloads.find((download) =>
        download.path.endsWith(`${definition.exportSlug}.csv`),
      )?.path,
    }));
  }, [data]);

  const workbookDownload = data?.downloads.find((download) => download.path.endsWith(".xlsx"));
  const activeRawSheet = rawSheets.find((sheet) => sheet.key === selectedRawSheet) ?? rawSheets[0] ?? null;

  const rawRows = useMemo(() => {
    if (!activeRawSheet) {
      return [];
    }

    const departmentFiltered = filterRowsByDepartment(activeRawSheet.rows, selectedDepartment);
    if (!deferredRawSearch) {
      return departmentFiltered;
    }

    return departmentFiltered.filter((row) => rowMatchesSearch(row, deferredRawSearch));
  }, [activeRawSheet, deferredRawSearch, selectedDepartment]);

  const rawColumns = useMemo(() => {
    const row = activeRawSheet?.rows[0] ?? rawRows[0];
    return row ? Object.keys(row) : [];
  }, [activeRawSheet, rawRows]);

  const rawPageCount = Math.max(1, Math.ceil(rawRows.length / RAW_PAGE_SIZE));
  const currentRawPage = Math.min(rawPage, rawPageCount);
  const rawPageRows = useMemo(() => {
    const startIndex = (currentRawPage - 1) * RAW_PAGE_SIZE;
    return rawRows.slice(startIndex, startIndex + RAW_PAGE_SIZE);
  }, [currentRawPage, rawRows]);

  const rawRangeStart = rawRows.length === 0 ? 0 : (currentRawPage - 1) * RAW_PAGE_SIZE + 1;
  const rawRangeEnd = rawRows.length === 0 ? 0 : Math.min(rawRows.length, currentRawPage * RAW_PAGE_SIZE);

  const territoryEpciOptions = useMemo(() => {
    if (!data) {
      return [];
    }

    return data.epci
      .filter((item) => selectedDepartment === "all" || item.code_departement === selectedDepartment)
      .sort((left, right) => left.epci_nom.localeCompare(right.epci_nom, "fr"));
  }, [data, selectedDepartment]);

  const comparisonEpciOptions = useMemo(
    () => territoryEpciOptions.filter((item) => item.epci_code !== selectedEpciCode),
    [selectedEpciCode, territoryEpciOptions],
  );

  useEffect(() => {
    if (
      selectedEpciCode !== "all" &&
      !territoryEpciOptions.some((item) => item.epci_code === selectedEpciCode)
    ) {
      setSelectedEpciCode("all");
    }
  }, [selectedEpciCode, territoryEpciOptions]);

  useEffect(() => {
    if (selectedEpciCode === "all" && selectedComparisonEpciCode !== "all") {
      setSelectedComparisonEpciCode("all");
    }
  }, [selectedComparisonEpciCode, selectedEpciCode]);

  useEffect(() => {
    if (
      selectedComparisonEpciCode !== "all" &&
      !comparisonEpciOptions.some((item) => item.epci_code === selectedComparisonEpciCode)
    ) {
      setSelectedComparisonEpciCode("all");
    }
  }, [comparisonEpciOptions, selectedComparisonEpciCode]);

  useEffect(() => {
    if (localityTypeFilter !== "all" && !availableLocalityTypes.includes(localityTypeFilter)) {
      setLocalityTypeFilter("all");
    }
  }, [availableLocalityTypes, localityTypeFilter]);

  useEffect(() => {
    if (
      activeTab !== "territories" ||
      territoriesView !== "territory" ||
      selectedEpciCode === "all" ||
      !pendingTerritoryJumpRef.current
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      territoryPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      pendingTerritoryJumpRef.current = false;
    }, 70);

    return () => window.clearTimeout(timeoutId);
  }, [activeTab, selectedEpciCode, territoriesView]);

  const activeEpci = territoryEpciOptions.find((item) => item.epci_code === selectedEpciCode) ?? null;
  const comparisonEpci =
    territoryEpciOptions.find((item) => item.epci_code === selectedComparisonEpciCode) ?? null;

  function resetFacilitiesFilters() {
    setManagementFilter("all");
    setBasinUsageFilter("all");
    setLocalityTypeFilter("all");
    setOperationalStatusFilter("all");
    setBasinSearch("");
    setShowProjectMarkers(true);
  }

  const hasFacilitiesFiltersActive =
    managementFilter !== "all" ||
    basinUsageFilter !== "all" ||
    localityTypeFilter !== "all" ||
    operationalStatusFilter !== "all" ||
    basinSearch !== "";

  function openFacilitySheet(equipmentId: string) {
    setActiveTab("facilities");
    setFacilitiesView("sheet");
    setSelectedFacilityEquipmentId(equipmentId);
  }

  function openProjectsView(initialSearch?: string) {
    setActiveTab("facilities");
    setFacilitiesView("projects");
    if (initialSearch) {
      setProjectSearch(initialSearch);
    }
  }

  function applyMapSearchSuggestion(suggestion: FacilityMapSearchSuggestion) {
    setBasinSearch(suggestion.queryValue);
    setSelectedMapPointId(suggestion.pointId ?? "");
  }

  function openTerritoryCard(epciCode: string) {
    pendingTerritoryJumpRef.current = true;
    setActiveTab("territories");
    setTerritoriesView("territory");
    setSelectedEpciCode(epciCode);

    if (selectedEpciCode === epciCode) {
      window.setTimeout(() => {
        territoryPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  }

  const territoryCommunes = useMemo(() => {
    const baseCommunes = data?.communes ?? [];
    return baseCommunes
      .filter((item) => selectedDepartment === "all" || item.code_departement === selectedDepartment)
      .filter((item) => selectedEpciCode === "all" || item.epci_code === selectedEpciCode);
  }, [data, selectedDepartment, selectedEpciCode]);

  const territoryBasins = useMemo(() => {
    return scopedBasins.filter(
      (item) => selectedEpciCode === "all" || item.epci_code === selectedEpciCode,
    );
  }, [scopedBasins, selectedEpciCode]);

  const territoryOperationalBasins = useMemo(
    () => filteredOperationalBasins.filter((item) => selectedEpciCode === "all" || item.epci_code === selectedEpciCode),
    [filteredOperationalBasins, selectedEpciCode],
  );

  const territorySchoolEstablishments = useMemo(
    () =>
      scopedSchoolEstablishments.filter(
        (item) => selectedEpciCode === "all" || item.epci_code === selectedEpciCode,
      ),
    [scopedSchoolEstablishments, selectedEpciCode],
  );

  const territoryCommuneAccessibility = useMemo(
    () =>
      scopedCommuneAccessibility.filter(
        (item) => selectedEpciCode === "all" || item.epci_code === selectedEpciCode,
      ),
    [scopedCommuneAccessibility, selectedEpciCode],
  );

  const territoryName = activeEpci?.epci_nom ?? departmentLabel;
  const territorySubtitle = activeEpci
    ? `${formatInteger(activeEpci.communes_total)} communes · ${formatInteger(activeEpci.population_2023_communes)} habitants`
    : `Lecture agrégée du périmètre actif : ${departmentLabel}`;

  const territoryPanelEyebrow =
    territoriesView === "comparisons" ? "Comparaisons territoriales" : "Fiche territoire";
  const territoryPanelTitle =
    territoriesView === "comparisons" ? "Comparer des territoires" : territoryName;
  const territoryPanelSubtitle =
    territoriesView === "comparisons"
      ? selectedEpciCode === "all"
        ? "Sélectionne un EPCI principal pour ouvrir un face-à-face plus lisible."
        : comparisonEpci
          ? `${territoryName} face à ${comparisonEpci.epci_nom}.`
          : "Choisis un second EPCI pour lancer la comparaison détaillée."
      : territorySubtitle;

  const territoryKpis = useMemo(() => {
    if (!currentOverview) {
      return [];
    }

    if (activeEpci) {
      return [
        {
          label: "Population",
          value: formatInteger(activeEpci.population_2023_communes),
          detail: `${formatInteger(activeEpci.communes_total)} communes`,
          accent: "lagoon",
        },
        {
          label: "Licences FFN 2023",
          value: formatInteger(activeEpci.licences_ffn_2023),
          detail: `${formatNumber(activeEpci.licences_ffn_pour_1000hab, 2)} pour 1 000 hab.`,
          accent: "coral",
        },
        {
          label: "Bassins",
          value: formatInteger(activeEpci.bassins_total),
          detail: `${formatInteger(activeEpci.installations_total)} installations`,
          accent: "sea",
        },
        {
          label: "Part de DSP",
          value: formatPercent(activeEpci.part_dsp_bassins ?? 0),
          detail: `${formatInteger(activeEpci.bassins_dsp)} bassins`,
          accent: "blue",
        },
        {
          label: "Bassins scolaires",
          value: formatInteger(activeEpci.bassins_usage_scolaires),
          detail: formatPercent(activeEpci.part_bassins_usage_scolaires ?? 0),
          accent: "sand",
        },
        {
          label: "Population QPV",
          value: formatInteger(activeEpci.pop_qpv),
          detail: formatPercent(activeEpci.part_population_qpv),
          accent: "ink",
        },
      ];
    }

    return [
      {
        label: "Population",
        value: formatInteger(currentOverview.population_total),
        detail: `${formatInteger(currentOverview.communes_total)} communes`,
        accent: "lagoon",
      },
      {
        label: "Licences FFN 2024",
        value: formatInteger(currentOverview.licences_ffn_2024),
        detail: `${formatNumber(currentOverview.licences_ffn_pour_1000hab, 2)} pour 1 000 hab.`,
        accent: "coral",
      },
      {
        label: "Bassins",
        value: formatInteger(currentOverview.bassins_total),
        detail: `${formatInteger(currentOverview.installations_total)} installations`,
        accent: "sea",
      },
      {
        label: "Part de DSP",
        value: formatPercent(safeDivide(currentOverview.bassins_dsp, currentOverview.bassins_total)),
        detail: `${formatInteger(currentOverview.bassins_dsp)} bassins`,
        accent: "blue",
      },
      {
        label: "Bassins scolaires",
        value: formatInteger(currentOverview.bassins_usage_scolaires),
        detail: formatPercent(
          safeDivide(currentOverview.bassins_usage_scolaires, currentOverview.bassins_total),
        ),
        accent: "sand",
      },
      {
        label: "Femmes dans les licences 2024",
        value: formatPercent(currentOverview.part_femmes_ffn_2024),
        detail: `${formatInteger(currentOverview.epci_total)} EPCI`,
        accent: "ink",
      },
    ];
  }, [activeEpci, currentOverview]);

  const territoryTopCommunes = useMemo(() => {
    return [...territoryCommunes]
      .sort((left, right) => right.licences_ffn_2023 - left.licences_ffn_2023)
      .slice(0, 8);
  }, [territoryCommunes]);

  const territoryManagementBreakdown = useMemo(() => {
    const counters = new Map<string, number>();
    territoryBasins.forEach((item) => {
      counters.set(item.mode_gestion_calcule, (counters.get(item.mode_gestion_calcule) ?? 0) + 1);
    });

    return Array.from(counters.entries())
      .map(([name, value]) => ({
        name,
        value,
        color: MANAGEMENT_COLORS[name] ?? "#666666",
      }))
      .sort((left, right) => right.value - left.value);
  }, [territoryBasins]);

  const territoryFacts = useMemo(() => {
    const schoolBasins = territoryBasins.filter((item) => item.usage_scolaires === 1).length;
    const qpvBasins = territoryBasins.filter(
      (item) => item.qpv_flag === 1 || item.qpv_200m_flag === 1,
    ).length;
    const communesWithoutBasin = territoryCommunes.filter(
      (item) => item.licences_ffn_2023 > 0 && item.bassins_total === 0,
    ).length;
    const totalSurface = Math.round(sumBy(territoryBasins, "surface_bassin_m2"));

    return [
      {
        label: "Surface cumulée",
        value: totalSurface > 0 ? `${formatInteger(totalSurface)} m²` : "Surface n.c.",
        detail: `${formatInteger(territoryBasins.length)} bassins recensés`,
      },
      {
        label: "Bassins scolaires",
        value: formatPercent(safeDivide(schoolBasins, territoryBasins.length)),
        detail: `${formatInteger(schoolBasins)} bassins identifiés`,
      },
      {
        label: "Bassins proches QPV",
        value: formatPercent(safeDivide(qpvBasins, territoryBasins.length)),
        detail: `${formatInteger(qpvBasins)} bassins dans ou à 200 m d'un QPV`,
      },
      {
        label: "Communes sous pression",
        value: formatInteger(communesWithoutBasin),
        detail: "Licences FFN > 0 sans bassin recensé",
      },
    ];
  }, [territoryBasins, territoryCommunes]);

  const territoryOperationalFacts = useMemo(() => {
    const summary = buildOperationalSummary(territoryOperationalBasins);
    return [
      {
        label: "Mise en service moyenne",
        value:
          summary.averageServiceYear > 0
            ? formatYear(summary.averageServiceYear)
            : "n.c.",
        detail: `${formatPercent(summary.yearCoverageShare)} du parc a ce champ renseigné`,
      },
      {
        label: "Parc antérieur à 2000",
        value: formatPercent(summary.legacyShare),
        detail: "Part des bassins avec année de mise en service antérieure à 2000",
      },
      {
        label: "Travaux depuis 2015",
        value: formatPercent(summary.recentWorksShare),
        detail: "Présence d'une date ou période de gros travaux récente",
      },
      {
        label: "Accès transport",
        value: formatPercent(summary.transportAccessShare),
        detail: "Modes de transport en commun déclarés dans Data ES",
      },
      {
        label: "Accessibilité renseignée",
        value: formatPercent(summary.accessibilityShare),
        detail: "Handicap déclaré ou détail PMR / sensoriel disponible",
      },
      {
        label: "Bassins scolaires avec conditions favorables",
        value: formatPercent(summary.schoolOperationalShare),
        detail: "Parmi les bassins scolaires : transport, accessibilité et arrêté d'ouverture",
      },
    ];
  }, [territoryOperationalBasins]);

  const overviewMarkers = useMemo(() => {
    if (!currentOverview) {
      return [];
    }

    return [
      {
        label: "Surface totale renseignée",
        value:
          currentOverview.surface_totale_bassins_m2 > 0
            ? `${formatInteger(Math.round(currentOverview.surface_totale_bassins_m2))} m²`
            : "Surface n.c.",
        detail: `Sur le périmètre actif ${departmentLabel.toLowerCase()}.`,
      },
      {
        label: "Bassins proches des QPV",
        value: formatInteger(currentOverview.bassins_qpv_200m),
        detail: `${formatInteger(currentOverview.bassins_qpv)} directement situés en QPV.`,
      },
      {
        label: "Communes sans bassin",
        value: formatInteger(currentOverview.communes_avec_licences_sans_bassin),
        detail: "Avec des licences FFN 2023 et aucun bassin recensé.",
      },
      {
        label: "Densité du parc",
        value: formatNumber(currentOverview.bassins_pour_100k_hab, 2),
        detail: "Bassins pour 100 000 habitants.",
      },
    ];
  }, [currentOverview, departmentLabel]);

  const territorySummary = useMemo<TerritoryMetricsSummary>(() => {
    if (!currentOverview) {
      return buildTerritoryMetricsSummary({
        bassinsPour100kHab: 0,
        surface: 0,
        population: 0,
        licences: 0,
        communesWithLicences: 0,
        communesWithoutBasin: 0,
      });
    }

    const communesWithLicences = countCommunesWithLicences(territoryCommunes);
    const communesWithoutBasin = countCommunesWithLicencesSansBassin(territoryCommunes);
    const population = activeEpci?.population_2023_communes ?? currentOverview.population_total;
    const surface = activeEpci?.surface_totale_bassins_m2 ?? currentOverview.surface_totale_bassins_m2;
    const licences = activeEpci?.licences_ffn_2023 ?? currentOverview.licences_ffn_2023;
    const bassinsPour100kHab = activeEpci?.bassins_pour_100k_hab ?? currentOverview.bassins_pour_100k_hab;

    return buildTerritoryMetricsSummary({
      bassinsPour100kHab,
      surface,
      population,
      licences,
      communesWithLicences,
      communesWithoutBasin,
    });
  }, [activeEpci, currentOverview, territoryCommunes]);

  const benchmarkDepartmentCode =
    activeEpci?.code_departement ?? (selectedDepartment === "all" ? null : selectedDepartment);

  const benchmarkDepartmentRecord =
    benchmarkDepartmentCode && data
      ? data.departments.find((item) => item.code_departement === benchmarkDepartmentCode) ?? null
      : null;

  const benchmarkDepartmentCommunes = useMemo(() => {
    if (!data || !benchmarkDepartmentCode) {
      return [];
    }

    return data.communes.filter((item) => item.code_departement === benchmarkDepartmentCode);
  }, [benchmarkDepartmentCode, data]);

  const departmentBenchmarkSummary = useMemo<TerritoryMetricsSummary | null>(() => {
    if (!benchmarkDepartmentRecord) {
      return null;
    }

    return buildTerritoryMetricsSummary({
      bassinsPour100kHab: benchmarkDepartmentRecord.bassins_pour_100k_hab,
      surface: benchmarkDepartmentRecord.surface_totale_bassins_m2,
      population: benchmarkDepartmentRecord.population_2023_communes,
      licences: benchmarkDepartmentRecord.licences_ffn_2023,
      communesWithLicences: countCommunesWithLicences(benchmarkDepartmentCommunes),
      communesWithoutBasin: countCommunesWithLicencesSansBassin(benchmarkDepartmentCommunes),
    });
  }, [benchmarkDepartmentCommunes, benchmarkDepartmentRecord]);

  const regionBenchmarkSummary = useMemo<TerritoryMetricsSummary>(() => {
    if (!data) {
      return buildTerritoryMetricsSummary({
        bassinsPour100kHab: 0,
        surface: 0,
        population: 0,
        licences: 0,
        communesWithLicences: 0,
        communesWithoutBasin: 0,
      });
    }

    return buildTerritoryMetricsSummary({
      bassinsPour100kHab: data.overview.bassins_pour_100k_hab,
      surface: data.overview.surface_totale_bassins_m2,
      population: data.overview.population_total,
      licences: data.overview.licences_ffn_2023,
      communesWithLicences: countCommunesWithLicences(data.communes),
      communesWithoutBasin: countCommunesWithLicencesSansBassin(data.communes),
    });
  }, [data]);

  const territoryBenchmarks = useMemo(
    () => [
      {
        label: "Bassins pour 100 000 hab.",
        kind: "ratio" as const,
        territory: territorySummary.bassinsPour100kHab,
        department: departmentBenchmarkSummary?.bassinsPour100kHab ?? null,
        region: regionBenchmarkSummary.bassinsPour100kHab,
      },
      {
        label: "Surface pour 1 000 hab.",
        kind: "ratio" as const,
        territory: territorySummary.surfaceM2Pour1000Hab,
        department: departmentBenchmarkSummary?.surfaceM2Pour1000Hab ?? null,
        region: regionBenchmarkSummary.surfaceM2Pour1000Hab,
      },
      {
        label: "Licences FFN pour 100 m²",
        kind: "ratio" as const,
        territory: territorySummary.licencesFfnPour100M2,
        department: departmentBenchmarkSummary?.licencesFfnPour100M2 ?? null,
        region: regionBenchmarkSummary.licencesFfnPour100M2,
      },
      {
        label: "Communes licenciées sans bassin",
        kind: "percent" as const,
        territory: territorySummary.communesSansBassinParmiLicenciees,
        department: departmentBenchmarkSummary?.communesSansBassinParmiLicenciees ?? null,
        region: regionBenchmarkSummary.communesSansBassinParmiLicenciees,
      },
    ],
    [departmentBenchmarkSummary, regionBenchmarkSummary, territorySummary],
  );

  const comparisonTerritoryCommunes = useMemo(() => {
    if (!data || selectedComparisonEpciCode === "all") {
      return [];
    }

    return data.communes.filter((item) => item.epci_code === selectedComparisonEpciCode);
  }, [data, selectedComparisonEpciCode]);

  const comparisonTerritoryBasins = useMemo(() => {
    if (selectedComparisonEpciCode === "all") {
      return [];
    }

    return scopedBasins.filter((item) => item.epci_code === selectedComparisonEpciCode);
  }, [scopedBasins, selectedComparisonEpciCode]);

  const comparisonOperationalBasins = useMemo(
    () =>
      selectedComparisonEpciCode === "all"
        ? []
        : filteredOperationalBasins.filter((item) => item.epci_code === selectedComparisonEpciCode),
    [filteredOperationalBasins, selectedComparisonEpciCode],
  );

  const comparisonSchoolEstablishments = useMemo(
    () =>
      selectedComparisonEpciCode === "all"
        ? []
        : scopedSchoolEstablishments.filter((item) => item.epci_code === selectedComparisonEpciCode),
    [scopedSchoolEstablishments, selectedComparisonEpciCode],
  );

  const comparisonCommuneAccessibility = useMemo(
    () =>
      selectedComparisonEpciCode === "all"
        ? []
        : scopedCommuneAccessibility.filter((item) => item.epci_code === selectedComparisonEpciCode),
    [scopedCommuneAccessibility, selectedComparisonEpciCode],
  );

  const comparisonTerritorySummary = useMemo<TerritoryMetricsSummary | null>(() => {
    if (!comparisonEpci) {
      return null;
    }

    return buildTerritoryMetricsSummary({
      bassinsPour100kHab: comparisonEpci.bassins_pour_100k_hab,
      surface: comparisonEpci.surface_totale_bassins_m2,
      population: comparisonEpci.population_2023_communes,
      licences: comparisonEpci.licences_ffn_2023,
      communesWithLicences: countCommunesWithLicences(comparisonTerritoryCommunes),
      communesWithoutBasin: countCommunesWithLicencesSansBassin(comparisonTerritoryCommunes),
    });
  }, [comparisonEpci, comparisonTerritoryCommunes]);

  const territoryOperationalSummary = useMemo(
    () => buildOperationalSummary(territoryOperationalBasins),
    [territoryOperationalBasins],
  );

  const territorySchoolDemand = useMemo<SchoolDemandOverview>(() => {
    if (selectedEpciCode === "all") {
      return overviewSchoolDemandSummary;
    }

    return (
      schoolDemandEpciByCode.get(selectedEpciCode) ??
      buildSchoolDemandSummary(
        territorySchoolEstablishments,
        territoryBasins.length,
        countUnique(territoryBasins.map((item) => item.id_installation)),
        territoryBasins.filter((item) => item.usage_scolaires === 1).length,
      )
    );
  }, [
    overviewSchoolDemandSummary,
    schoolDemandEpciByCode,
    selectedEpciCode,
    territoryBasins,
    territorySchoolEstablishments,
  ]);

  const territoryAccessibilitySummary = useMemo<AccessibilityOverview>(() => {
    if (selectedEpciCode === "all") {
      return overviewAccessibilitySummary;
    }

    return (
      accessibilityEpciByCode.get(selectedEpciCode) ??
      buildAccessibilitySummary(
        territoryCommuneAccessibility,
        overviewAccessibilitySummary.installations_total,
      )
    );
  }, [
    accessibilityEpciByCode,
    overviewAccessibilitySummary,
    selectedEpciCode,
    territoryCommuneAccessibility,
  ]);

  const territoryTransitSummary = useMemo<TransitOverview>(() => {
    if (selectedEpciCode === "all") {
      return overviewTransitSummary;
    }

    return (
      transitEpciByCode.get(selectedEpciCode) ??
      buildTransitSummary(
        scopedCommuneTransit.filter((item) => item.epci_code === selectedEpciCode),
        scopedInstallationTransit.filter((item) => item.epci_code === selectedEpciCode),
        scopedSchoolEstablishments.filter((item) => item.epci_code === selectedEpciCode),
        overviewTransitSummary.transit_hubs_total,
      )
    );
  }, [
    overviewTransitSummary,
    scopedCommuneTransit,
    scopedInstallationTransit,
    scopedSchoolEstablishments,
    selectedEpciCode,
    transitEpciByCode,
  ]);

  const territorySchoolFacts = useMemo(() => {
    return [
      {
        label: "Établissements scolaires",
        value: formatInteger(territorySchoolDemand.schools_total),
        detail: `${formatInteger(territorySchoolDemand.students_total)} élèves potentiels`,
      },
      {
        label: "Premier / second degré",
        value: `${formatInteger(territorySchoolDemand.primary_students)} / ${formatInteger(
          territorySchoolDemand.secondary_students,
        )}`,
        detail: "Lecture des effectifs 2024 intégrés dans le socle scolaire.",
      },
      {
        label: "Élèves / installation",
        value: formatNumber(territorySchoolDemand.students_per_installation, 1),
        detail: `${formatInteger(territorySchoolDemand.installations_total)} installations retenues`,
      },
      {
        label: "Distance moyenne",
        value: formatKilometers(territorySchoolDemand.average_distance_to_installation_km),
        detail: `${formatPercent(territorySchoolDemand.distance_coverage_share)} des élèves géolocalisés`,
      },
      {
        label: "À moins de 5 km d'une installation",
        value: formatPercent(territorySchoolDemand.students_within_5km_installation_share),
        detail: "Part des élèves géolocalisés dans le périmètre retenu.",
      },
    ];
  }, [territorySchoolDemand]);

  const territorySchoolDriveFacts = useMemo(() => {
    return [
      {
        label: "Établissements scolaires",
        value: formatInteger(territorySchoolDemand.schools_total),
        detail: `${formatInteger(territorySchoolDemand.students_total)} élèves potentiels`,
      },
      {
        label: "Premier / second degré",
        value: `${formatInteger(territorySchoolDemand.primary_students)} / ${formatInteger(
          territorySchoolDemand.secondary_students,
        )}`,
        detail: "Lecture des effectifs 2024 intégrés dans le socle scolaire.",
      },
      {
        label: "Élèves / installation",
        value: formatNumber(territorySchoolDemand.students_per_installation, 1),
        detail: `${formatInteger(territorySchoolDemand.installations_total)} installations retenues`,
      },
      {
        label: "Temps moyen voiture",
        value: formatMinutes(territorySchoolDemand.average_drive_time_to_installation_min),
        detail: `${formatPercent(territorySchoolDemand.drive_time_coverage_share)} des élèves avec temps calculé`,
      },
      {
        label: "Élèves < 15 min d'une installation",
        value: formatPercent(territorySchoolDemand.students_within_15min_installation_share),
        detail: "Part des élèves avec temps voiture calculé dans le périmètre retenu.",
      },
    ];
  }, [territorySchoolDemand]);

  const territoryAccessibilityFacts = useMemo(() => {
    const farthestCommune =
      [...territoryCommuneAccessibility]
        .filter(
          (item) =>
            typeof item.drive_time_to_nearest_installation_min === "number" &&
            Number.isFinite(item.drive_time_to_nearest_installation_min),
        )
        .sort(
          (left, right) =>
            (right.drive_time_to_nearest_installation_min ?? 0) -
            (left.drive_time_to_nearest_installation_min ?? 0),
        )[0] ?? null;

    return [
      {
        label: "Temps moyen voiture",
        value: formatMinutes(territoryAccessibilitySummary.average_drive_time_to_installation_min),
        detail: `${formatInteger(territoryAccessibilitySummary.communes_routed_total)} communes calculées`,
      },
      {
        label: "Distance moyenne",
        value: formatKilometers(territoryAccessibilitySummary.average_drive_distance_to_installation_km),
        detail: `${formatInteger(territoryAccessibilitySummary.reachable_installations_total)} sites mobilisés`,
      },
      {
        label: "Population < 15 min",
        value: formatPercent(territoryAccessibilitySummary.population_within_15min_share),
        detail: `${formatPercent(territoryAccessibilitySummary.population_within_20min_share)} sous 20 min`,
      },
      {
        label: "Communes < 15 min",
        value: formatPercent(territoryAccessibilitySummary.communes_within_15min_share),
        detail: farthestCommune
          ? `${farthestCommune.commune ?? "Commune n.c."} reste la plus eloignee (${formatMinutes(
              farthestCommune.drive_time_to_nearest_installation_min,
            )})`
          : "Aucune mesure voiture n'est disponible sur ce périmètre.",
      },
    ];
  }, [territoryAccessibilitySummary, territoryCommuneAccessibility]);

  const territoryTransitFacts = useMemo(() => {
    const bestConnectedCommune =
      [...scopedCommuneTransit]
        .filter(
          (item) =>
            item.epci_code === selectedEpciCode &&
            typeof item.nearest_transit_distance_km === "number" &&
            Number.isFinite(item.nearest_transit_distance_km),
        )
        .sort(
          (left, right) =>
            (left.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY) -
            (right.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY),
        )[0] ?? null;

    return [
      {
        label: "Distance moyenne à un arrêt",
        value: formatKilometers(territoryTransitSummary.average_nearest_stop_distance_km),
        detail: `${formatInteger(territoryTransitSummary.transit_hubs_total)} arrêts ou gares actifs dans le socle GTFS`,
      },
      {
        label: "Population < 500 m",
        value: formatPercent(territoryTransitSummary.population_within_500m_share),
        detail: `${formatPercent(territoryTransitSummary.population_within_1000m_share)} à moins d'1 km`,
      },
      {
        label: "Installations < 500 m",
        value: formatPercent(territoryTransitSummary.installations_within_500m_share),
        detail: `${formatPercent(territoryTransitSummary.installations_within_1000m_share)} à moins d'1 km`,
      },
      {
        label: "Élèves < 500 m",
        value: formatPercent(territoryTransitSummary.students_within_500m_share),
        detail: `${formatPercent(territoryTransitSummary.students_within_1000m_share)} des élèves à moins d'1 km`,
      },
      {
        label: "Passages théoriques à 1 km",
        value: formatInteger(Math.round(territoryTransitSummary.average_weekday_trips_within_1000m)),
        detail: bestConnectedCommune
          ? `${bestConnectedCommune.commune ?? "Commune n.c."} est la mieux ancrée (${formatKilometers(
              bestConnectedCommune.nearest_transit_distance_km,
            )})`
          : "Lecture GTFS potentielle en semaine, sans calcul porte-à-porte.",
      },
    ];
  }, [scopedCommuneTransit, selectedEpciCode, territoryTransitSummary]);

  const comparisonOperationalSummary = useMemo(
    () => buildOperationalSummary(comparisonOperationalBasins),
    [comparisonOperationalBasins],
  );

  const comparisonSchoolDemand = useMemo<SchoolDemandOverview>(() => {
    if (selectedComparisonEpciCode === "all") {
      return EMPTY_SCHOOL_DEMAND_SUMMARY;
    }

    return (
      schoolDemandEpciByCode.get(selectedComparisonEpciCode) ??
      buildSchoolDemandSummary(
        comparisonSchoolEstablishments,
        comparisonTerritoryBasins.length,
        countUnique(comparisonTerritoryBasins.map((item) => item.id_installation)),
        comparisonTerritoryBasins.filter((item) => item.usage_scolaires === 1).length,
      )
    );
  }, [
    comparisonSchoolEstablishments,
    comparisonTerritoryBasins,
    schoolDemandEpciByCode,
    selectedComparisonEpciCode,
  ]);

  const comparisonAccessibilitySummary = useMemo<AccessibilityOverview>(() => {
    if (selectedComparisonEpciCode === "all") {
      return EMPTY_ACCESSIBILITY_SUMMARY;
    }

    return (
      accessibilityEpciByCode.get(selectedComparisonEpciCode) ??
      buildAccessibilitySummary(
        comparisonCommuneAccessibility,
        overviewAccessibilitySummary.installations_total,
      )
    );
  }, [
    accessibilityEpciByCode,
    comparisonCommuneAccessibility,
    overviewAccessibilitySummary.installations_total,
    selectedComparisonEpciCode,
  ]);

  const comparisonTransitSummary = useMemo<TransitOverview>(() => {
    if (selectedComparisonEpciCode === "all") {
      return EMPTY_TRANSIT_SUMMARY;
    }

    return (
      transitEpciByCode.get(selectedComparisonEpciCode) ??
      buildTransitSummary(
        scopedCommuneTransit.filter((item) => item.epci_code === selectedComparisonEpciCode),
        scopedInstallationTransit.filter((item) => item.epci_code === selectedComparisonEpciCode),
        scopedSchoolEstablishments.filter((item) => item.epci_code === selectedComparisonEpciCode),
        overviewTransitSummary.transit_hubs_total,
      )
    );
  }, [
    overviewTransitSummary.transit_hubs_total,
    scopedCommuneTransit,
    scopedInstallationTransit,
    scopedSchoolEstablishments,
    selectedComparisonEpciCode,
    transitEpciByCode,
  ]);

  const filteredComparableTerritoryBasins = useMemo(
    () =>
      territoryBasins.filter(
        (item) =>
          matchesComparableProfileScope(item, comparableProfileScope) &&
          matchesComparableBasinContext(item, comparableBasinContext),
      ),
    [comparableBasinContext, comparableProfileScope, territoryBasins],
  );

  const filteredComparableComparisonBasins = useMemo(
    () =>
      comparisonTerritoryBasins.filter(
        (item) =>
          matchesComparableProfileScope(item, comparableProfileScope) &&
          matchesComparableBasinContext(item, comparableBasinContext),
      ),
    [comparableBasinContext, comparableProfileScope, comparisonTerritoryBasins],
  );

  const filteredComparableProfileRows = useMemo(
    () => buildComparableProfileCoverageRows(filteredComparableTerritoryBasins),
    [filteredComparableTerritoryBasins],
  );

  const filteredComparableProfileComparisonRows = useMemo(
    () =>
      buildComparableProfileComparisonRows(
        filteredComparableTerritoryBasins,
        filteredComparableComparisonBasins,
      ),
    [filteredComparableComparisonBasins, filteredComparableTerritoryBasins],
  );

  const filteredComparableTerritorySummary = useMemo(
    () => buildComparableProfileSummary(filteredComparableTerritoryBasins),
    [filteredComparableTerritoryBasins],
  );

  const filteredComparableComparisonSummary = useMemo(
    () => buildComparableProfileSummary(filteredComparableComparisonBasins),
    [filteredComparableComparisonBasins],
  );

  const filteredComparableTerritoryListRows = useMemo(
    () => buildComparableBasinListRows(filteredComparableTerritoryBasins),
    [filteredComparableTerritoryBasins],
  );

  const filteredComparableComparisonListRows = useMemo(
    () => buildComparableBasinListRows(filteredComparableComparisonBasins),
    [filteredComparableComparisonBasins],
  );

  const countedTerritoryActivityRows = useMemo(
    () => buildInventoryActivityRows(territoryBasins, inventoryCountMode),
    [inventoryCountMode, territoryBasins],
  );

  const countedTerritoryActivityComparisonRows = useMemo(
    () =>
      buildComparableInventoryActivityRows(
        territoryBasins,
        comparisonTerritoryBasins,
        inventoryCountMode,
      ),
    [comparisonTerritoryBasins, inventoryCountMode, territoryBasins],
  );

  const territoryTypologyRows = useMemo(
    () => buildTerritoryTypologyRows(territoryCommunes, territoryBasins),
    [territoryBasins, territoryCommunes],
  );

  const territoryDirectComparisonRows = useMemo(() => {
    if (!activeEpci || !comparisonEpci || !comparisonTerritorySummary) {
      return [];
    }

    return [
      {
        label: "Population",
        kind: "count" as const,
        primary: activeEpci.population_2023_communes,
        comparison: comparisonEpci.population_2023_communes,
      },
      {
        label: "Licences FFN 2023",
        kind: "count" as const,
        primary: activeEpci.licences_ffn_2023,
        comparison: comparisonEpci.licences_ffn_2023,
      },
      {
        label: "Bassins",
        kind: "count" as const,
        primary: activeEpci.bassins_total,
        comparison: comparisonEpci.bassins_total,
      },
      {
        label: "Établissements scolaires",
        kind: "count" as const,
        primary: territorySchoolDemand.schools_total,
        comparison: comparisonSchoolDemand.schools_total,
      },
      {
        label: "Élèves potentiels",
        kind: "count" as const,
        primary: territorySchoolDemand.students_total,
        comparison: comparisonSchoolDemand.students_total,
      },
      {
        label: "Surface pour 1 000 hab.",
        kind: "ratio" as const,
        primary: territorySummary.surfaceM2Pour1000Hab,
        comparison: comparisonTerritorySummary.surfaceM2Pour1000Hab,
      },
      {
        label: "Licences FFN pour 1 000 hab.",
        kind: "ratio" as const,
        primary: activeEpci.licences_ffn_pour_1000hab,
        comparison: comparisonEpci.licences_ffn_pour_1000hab,
      },
      {
        label: "Bassins proches QPV / 100k hab. QPV",
        kind: "ratio" as const,
        primary: safeDivide(activeEpci.bassins_qpv_200m, activeEpci.pop_qpv) * 100000,
        comparison: safeDivide(comparisonEpci.bassins_qpv_200m, comparisonEpci.pop_qpv) * 100000,
      },
      {
        label: "Part de population QPV",
        kind: "percent" as const,
        primary: activeEpci.part_population_qpv,
        comparison: comparisonEpci.part_population_qpv,
      },
      {
        label: "Mise en service moyenne",
        kind: "year" as const,
        primary: territoryOperationalSummary.averageServiceYear,
        comparison: comparisonOperationalSummary.averageServiceYear,
      },
      {
        label: "Parc mis en service avant 2000",
        kind: "percent" as const,
        primary: territoryOperationalSummary.legacyShare,
        comparison: comparisonOperationalSummary.legacyShare,
      },
      {
        label: "Travaux depuis 2015",
        kind: "percent" as const,
        primary: territoryOperationalSummary.recentWorksShare,
        comparison: comparisonOperationalSummary.recentWorksShare,
      },
      {
        label: "Élèves / installation",
        kind: "ratio" as const,
        primary: territorySchoolDemand.students_per_installation,
        comparison: comparisonSchoolDemand.students_per_installation,
      },
      {
        label: "Distance moyenne à une installation",
        kind: "ratio" as const,
        primary: territorySchoolDemand.average_distance_to_installation_km,
        comparison: comparisonSchoolDemand.average_distance_to_installation_km,
      },
      {
        label: "Temps moyen voiture vers une installation",
        kind: "duration" as const,
        primary: territoryAccessibilitySummary.average_drive_time_to_installation_min,
        comparison: comparisonAccessibilitySummary.average_drive_time_to_installation_min,
      },
      {
        label: "Distance moyenne voiture",
        kind: "distance" as const,
        primary: territoryAccessibilitySummary.average_drive_distance_to_installation_km,
        comparison: comparisonAccessibilitySummary.average_drive_distance_to_installation_km,
      },
      {
        label: "Population à moins de 15 min",
        kind: "percent" as const,
        primary: territoryAccessibilitySummary.population_within_15min_share,
        comparison: comparisonAccessibilitySummary.population_within_15min_share,
      },
      {
        label: "Communes à moins de 15 min",
        kind: "percent" as const,
        primary: territoryAccessibilitySummary.communes_within_15min_share,
        comparison: comparisonAccessibilitySummary.communes_within_15min_share,
      },
      {
        label: "Distance moyenne à un arrêt TC",
        kind: "distance" as const,
        primary: territoryTransitSummary.average_nearest_stop_distance_km,
        comparison: comparisonTransitSummary.average_nearest_stop_distance_km,
      },
      {
        label: "Population à moins de 500 m d'un arrêt",
        kind: "percent" as const,
        primary: territoryTransitSummary.population_within_500m_share,
        comparison: comparisonTransitSummary.population_within_500m_share,
      },
      {
        label: "Population à moins d'1 km d'un arrêt",
        kind: "percent" as const,
        primary: territoryTransitSummary.population_within_1000m_share,
        comparison: comparisonTransitSummary.population_within_1000m_share,
      },
      {
        label: "Installations à moins de 500 m d'un arrêt",
        kind: "percent" as const,
        primary: territoryTransitSummary.installations_within_500m_share,
        comparison: comparisonTransitSummary.installations_within_500m_share,
      },
      {
        label: "Élèves à moins de 500 m d'un arrêt",
        kind: "percent" as const,
        primary: territoryTransitSummary.students_within_500m_share,
        comparison: comparisonTransitSummary.students_within_500m_share,
      },
      {
        label: "Accès transport renseigné",
        kind: "percent" as const,
        primary: territoryOperationalSummary.transportAccessShare,
        comparison: comparisonOperationalSummary.transportAccessShare,
      },
      {
        label: "Accessibilité renseignée",
        kind: "percent" as const,
        primary: territoryOperationalSummary.accessibilityShare,
        comparison: comparisonOperationalSummary.accessibilityShare,
      },
      {
        label: "Bassins scolaires avec conditions favorables",
        kind: "percent" as const,
        primary: territoryOperationalSummary.schoolOperationalShare,
        comparison: comparisonOperationalSummary.schoolOperationalShare,
      },
      {
        label: "Élèves à moins de 5 km",
        kind: "percent" as const,
        primary: territorySchoolDemand.students_within_5km_installation_share,
        comparison: comparisonSchoolDemand.students_within_5km_installation_share,
      },
      {
        label: "Communes licenciées sans bassin",
        kind: "percent" as const,
        primary: territorySummary.communesSansBassinParmiLicenciees,
        comparison: comparisonTerritorySummary.communesSansBassinParmiLicenciees,
      },
    ].map((item) => ({
      ...item,
      delta: item.primary - item.comparison,
    }));
  }, [
    activeEpci,
    comparisonEpci,
    comparisonAccessibilitySummary,
    comparisonTransitSummary,
    comparisonSchoolDemand,
    comparisonOperationalSummary,
    comparisonTerritorySummary,
    territoryAccessibilitySummary,
    territoryTransitSummary,
    territoryOperationalSummary,
    territorySchoolDemand,
    territorySummary,
  ]);

  const territoryDirectComparisonRowsWithDrive = useMemo(() => {
    if (territoryDirectComparisonRows.length === 0) {
      return [];
    }

    return [
      ...territoryDirectComparisonRows,
      {
        label: "Temps moyen voiture vers une installation",
        kind: "duration" as const,
        primary: territorySchoolDemand.average_drive_time_to_installation_min,
        comparison: comparisonSchoolDemand.average_drive_time_to_installation_min,
        delta:
          territorySchoolDemand.average_drive_time_to_installation_min -
          comparisonSchoolDemand.average_drive_time_to_installation_min,
      },
      {
        label: "Élèves à moins de 15 min",
        kind: "percent" as const,
        primary: territorySchoolDemand.students_within_15min_installation_share,
        comparison: comparisonSchoolDemand.students_within_15min_installation_share,
        delta:
          territorySchoolDemand.students_within_15min_installation_share -
          comparisonSchoolDemand.students_within_15min_installation_share,
      },
    ];
  }, [comparisonSchoolDemand, territoryDirectComparisonRows, territorySchoolDemand]);

  const investigationRows = useMemo<InvestigationProfileRow[]>(() => {
    if (filteredEpci.length === 0) {
      return [];
    }

    const surfaceRankMap = buildRankMap(filteredEpci, (item) =>
      safeDivide(item.surface_totale_bassins_m2, item.population_2023_communes) * 1000,
    );
    const bassinsRankMap = buildRankMap(filteredEpci, (item) => item.bassins_pour_100k_hab);
    const coverageShareRankMap = buildRankMap(filteredEpci, (item) =>
      safeDivide(item.communes_avec_licences_sans_bassin, item.communes_avec_licences_ffn),
    );
    const coverageVolumeRankMap = buildRankMap(filteredEpci, (item) => item.communes_avec_licences_sans_bassin);
    const pressureSurfaceRankMap = buildRankMap(filteredEpci, (item) =>
      safeDivide(item.licences_ffn_2023, item.surface_totale_bassins_m2) * 100,
    );
    const licencesPerBassinRankMap = buildRankMap(
      filteredEpci,
      (item) => item.licences_ffn_par_bassin ?? safeDivide(item.licences_ffn_2023, item.bassins_total),
    );
    const licencesPer1000RankMap = buildRankMap(filteredEpci, (item) => item.licences_ffn_pour_1000hab);
    const populationRankMap = buildRankMap(filteredEpci, (item) => item.population_2023_communes);
    const licencesVolumeRankMap = buildRankMap(filteredEpci, (item) => item.licences_ffn_2023);
    const qpvVolumeRankMap = buildRankMap(filteredEpci, (item) => item.pop_qpv);
    const qpvRankMap = buildRankMap(filteredEpci, (item) => item.part_population_qpv);

    return filteredEpci
      .map((item) => {
        const bassinsPour100kHab = item.bassins_pour_100k_hab;
        const surfaceM2Pour1000Hab =
          safeDivide(item.surface_totale_bassins_m2, item.population_2023_communes) * 1000;
        const licencesFfnPour1000Hab = item.licences_ffn_pour_1000hab;
        const licencesFfnParBassin =
          item.licences_ffn_par_bassin ?? safeDivide(item.licences_ffn_2023, item.bassins_total);
        const licencesFfnPour100M2 = safeDivide(item.licences_ffn_2023, item.surface_totale_bassins_m2) * 100;
        const communesSansBassinVolume = item.communes_avec_licences_sans_bassin;
        const communesSansBassinShare = safeDivide(
          item.communes_avec_licences_sans_bassin,
          item.communes_avec_licences_ffn,
        );
        const qpvPopulation = item.pop_qpv;
        const qpvShare = item.part_population_qpv;

        const offerGapIndex = average([
          1 - (surfaceRankMap.get(item.epci_code) ?? 0),
          1 - (bassinsRankMap.get(item.epci_code) ?? 0),
          coverageShareRankMap.get(item.epci_code) ?? 0,
          coverageVolumeRankMap.get(item.epci_code) ?? 0,
        ]);
        const pressureIndex = average([
          pressureSurfaceRankMap.get(item.epci_code) ?? 0,
          licencesPerBassinRankMap.get(item.epci_code) ?? 0,
          licencesPer1000RankMap.get(item.epci_code) ?? 0,
        ]);
        const impactIndex = average([
          populationRankMap.get(item.epci_code) ?? 0,
          licencesVolumeRankMap.get(item.epci_code) ?? 0,
          coverageVolumeRankMap.get(item.epci_code) ?? 0,
          qpvVolumeRankMap.get(item.epci_code) ?? 0,
          qpvRankMap.get(item.epci_code) ?? 0,
        ]);
        const priorityScore = calculatePriorityScore({
          offerGapIndex,
          pressureIndex,
          impactIndex,
        });
        const profile = classifyInvestigationProfile(offerGapIndex, pressureIndex, impactIndex);
        const hypothesis = buildInvestigationHypothesis({
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
        });
        const priorityDrivers = buildPriorityDrivers({
          bassinsPour100kHab,
          licencesFfnParBassin,
          licencesFfnPour1000Hab,
          licencesFfnPour100M2,
          communesSansBassinVolume,
          communesSansBassinShare,
          population: item.population_2023_communes,
          licences: item.licences_ffn_2023,
          qpvPopulation,
          qpvShare,
        });

        return {
          epci_code: item.epci_code,
          epci_nom: item.epci_nom,
          departement: item.departement,
          population: item.population_2023_communes,
          bassins: item.bassins_total,
          licences: item.licences_ffn_2023,
          bassinsPour100kHab,
          surfaceM2Pour1000Hab,
          licencesFfnPour1000Hab,
          licencesFfnParBassin,
          licencesFfnPour100M2,
          communesSansBassinShare,
          communesSansBassinVolume,
          qpvPopulation,
          qpvShare,
          selectedMetricValue: activeMetricOption.getValue(item),
          selectedMetricKind: activeMetricOption.kind,
          priorityScore,
          offerGapIndex,
          pressureIndex,
          impactIndex,
          profile,
          hypothesis,
          priorityDrivers,
        };
      })
      .sort((left, right) => right.priorityScore - left.priorityScore);
  }, [activeMetricOption, filteredEpci]);

  const rankedInvestigationRows = useMemo(
    () =>
      [...investigationRows].sort((left, right) => {
        const scoreGap =
          getInvestigationScoreByLens(right, investigationLens) -
          getInvestigationScoreByLens(left, investigationLens);

        if (scoreGap !== 0) {
          return scoreGap;
        }

        return right.priorityScore - left.priorityScore;
      }),
    [investigationLens, investigationRows],
  );

  const investigationPageCount = Math.max(
    1,
    Math.ceil(rankedInvestigationRows.length / INVESTIGATION_PAGE_SIZE),
  );
  const currentInvestigationPage = Math.min(investigationPage, investigationPageCount);
  const pagedInvestigationRows = useMemo(() => {
    const startIndex = (currentInvestigationPage - 1) * INVESTIGATION_PAGE_SIZE;
    return rankedInvestigationRows.slice(startIndex, startIndex + INVESTIGATION_PAGE_SIZE);
  }, [currentInvestigationPage, rankedInvestigationRows]);
  const investigationRangeStart =
    rankedInvestigationRows.length === 0 ? 0 : (currentInvestigationPage - 1) * INVESTIGATION_PAGE_SIZE + 1;
  const investigationRangeEnd =
    rankedInvestigationRows.length === 0
      ? 0
      : Math.min(rankedInvestigationRows.length, currentInvestigationPage * INVESTIGATION_PAGE_SIZE);

  const investigationRankMaps = useMemo<InvestigationRankLookup>(
    () => ({
      priority: buildOrdinalRankMap(investigationRows, (item) => item.priorityScore),
      offer_gap: buildOrdinalRankMap(investigationRows, (item) => item.offerGapIndex * 100),
      pressure: buildOrdinalRankMap(investigationRows, (item) => item.pressureIndex * 100),
      impact: buildOrdinalRankMap(investigationRows, (item) => item.impactIndex * 100),
    }),
    [investigationRows],
  );

  const investigationHighlights = useMemo(
    () => rankedInvestigationRows.slice(0, 3),
    [rankedInvestigationRows],
  );

  const investigationStats = useMemo(() => {
    const highPriorityCount = investigationRows.filter((item) => item.priorityScore >= 70).length;
    const watchCount = investigationRows.filter((item) => item.priorityScore >= 58 && item.priorityScore < 70).length;
    const highOfferGapCount = investigationRows.filter((item) => item.offerGapIndex >= 0.62).length;
    const highPressureCount = investigationRows.filter((item) => item.pressureIndex >= 0.64).length;
    const highImpactCount = investigationRows.filter((item) => item.impactIndex >= 0.7).length;

    return {
      highPriorityCount,
      watchCount,
      highOfferGapCount,
      highPressureCount,
      highImpactCount,
    };
  }, [investigationRows]);

  const activeTerritoryInvestigation = useMemo(
    () => investigationRows.find((item) => item.epci_code === selectedEpciCode) ?? null,
    [investigationRows, selectedEpciCode],
  );

  const quadrantPoints = useMemo(
    () =>
      rankedInvestigationRows.map((item) => ({
        epci_code: item.epci_code,
        epci_nom: item.epci_nom,
        shortLabel: shortenEpci(item.epci_nom, 28),
        fullLabel: `${item.epci_nom} (${shortDepartment(item.departement)})`,
        x: item.offerGapIndex * 100,
        y: item.pressureIndex * 100,
        z: Math.max(12, item.impactIndex * 100),
        priorityScore: item.priorityScore,
        impactIndex: item.impactIndex,
        profile: item.profile,
        color: getQuadrantColor(item),
        isSelected: selectedEpciCode === item.epci_code,
      })),
    [rankedInvestigationRows, selectedEpciCode],
  );

  const quadrantSummaries = useMemo(() => {
    const definitions = [
      {
        key: "critical",
        label: "Sous-équipement + tension",
        description: "Les territoires les plus sensibles, où l'offre et la pression se cumulent.",
      },
      {
        key: "offer_gap",
        label: "Sous-équipement d'abord",
        description: "Territoires plutôt déficitaires en couverture ou en capacité.",
      },
      {
        key: "pressure",
        label: "Tension d'usage d'abord",
        description: "Territoires où l'offre existe mais absorbe une pression élevée.",
      },
      {
        key: "stable",
        label: "Socle plus stable",
        description: "Territoires plutôt moins tendus sur les deux axes principaux.",
      },
    ] as const;

    return definitions.map((definition) => {
      const items = rankedInvestigationRows.filter(
        (item) => getQuadrantBucket(item.offerGapIndex, item.pressureIndex) === definition.key,
      );

      return {
        ...definition,
        count: items.length,
        examples: items.slice(0, 3).map((item) => item.epci_nom),
      };
    });
  }, [rankedInvestigationRows]);

  const activeFilterPills = useMemo(() => {
    const pills = [
      selectedDepartment === "all" ? `Périmètre : Région Hauts-de-France` : `Département : ${departmentLabel}`,
    ];

    if (activeTab === "territories") {
      pills.push(`Lecture : ${activeInvestigationLens.label}`);
      pills.push(`Indicateur : ${activeMetricOption.label}`);
      if (inventoryCountMode !== "equipments") {
        pills.push("Comptage : installations");
      }
      if (selectedEpciCode !== "all") {
        pills.push(`Territoire : ${territoryName}`);
      }
      if (selectedComparisonEpciCode !== "all") {
        const comparisonLabel =
          territoryEpciOptions.find((item) => item.epci_code === selectedComparisonEpciCode)?.epci_nom ??
          "Comparatif";
        pills.push(`Comparaison : ${comparisonLabel}`);
      }
      if (epciSearch) {
        pills.push(`Recherche EPCI : ${epciSearch}`);
      }
    }

    if (activeTab === "facilities") {
      if (inventoryCountMode !== "equipments") {
        pills.push("Comptage : installations");
      }
      if (managementFilter !== "all") {
        pills.push(`Gestion : ${managementFilter}`);
      }
      if (operationalStatusFilter !== "all") {
        pills.push(`Statut : ${getFacilityOperationalStatusFilterLabel(operationalStatusFilter)}`);
      }
      if (basinUsageFilter === "school") {
        pills.push("Usage : scolaires");
      }
      if (basinUsageFilter === "qpv") {
        pills.push("Usage : QPV ou 200 m");
      }
      if (localityTypeFilter !== "all") {
        pills.push(`Typologie : ${localityTypeFilter}`);
      }
      if (basinSearch) {
        pills.push(`Recherche équipement : ${basinSearch}`);
      }
    }

    if (activeTab === "data") {
      pills.push(`Feuille : ${activeRawSheet?.sheetName ?? "Aucune"}`);
      if (rawSearch) {
        pills.push(`Recherche brute : ${rawSearch}`);
      }
    }

    return pills;
  }, [
    activeInvestigationLens.label,
    activeMetricOption.label,
    activeRawSheet,
    activeTab,
    basinSearch,
    basinUsageFilter,
    departmentLabel,
    epciSearch,
    inventoryCountMode,
    localityTypeFilter,
    managementFilter,
    operationalStatusFilter,
    rawSearch,
    selectedDepartment,
    selectedComparisonEpciCode,
    selectedEpciCode,
    territoryEpciOptions,
    territoryName,
  ]);

  const activeTabOption = TAB_OPTIONS.find((item) => item.key === activeTab) ?? TAB_OPTIONS[0];
  const activeSubViewLabel: string | null =
    activeTab === "overview" ? activeOverviewView.label :
    activeTab === "territories" ? activeTerritoriesView.label :
    activeTab === "facilities" ? activeFacilitiesView.label :
    null;
  const epciChartHeight = Math.max(420, epciRanking.length * 40);
  const qpvChartHeight = Math.max(320, qpvFragilityChartRows.length * 42);

  if (error) {
    return (
      <main className="app-shell">
        <section className="panel error-panel">
          <h1>Chargement impossible</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!data || !currentOverview) {
    return (
      <main className="app-shell">
        <section className="hero hero-loading">
          <div className="hero-copy">
            <span className="eyebrow">Panorama aquatique</span>
            <h1>Préparation du dashboard</h1>
            <p>Conversion du socle Excel et chargement des indicateurs régionaux.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">{data.meta.region}</span>
          <h1>{data.meta.title}</h1>
          <p>{data.meta.subtitle}</p>
        </div>

        <div className="hero-meta">
          <div className="meta-card">
            <span className="meta-label">Périmètre actif</span>
            <strong>{departmentLabel}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Source</span>
            <strong>
              {Array.isArray(data.meta.source_labels) && data.meta.source_labels.length > 0
                ? data.meta.source_labels.join(" · ")
                : data.meta.source_summary}
            </strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Dernière actualisation</span>
            <strong>{formatDateOnly(data.meta.generated_at)}</strong>
          </div>
        </div>
      </section>

      <section className="toolbar toolbar-top panel">
        <div className="toolbar-group">
          <label htmlFor="department-filter">Périmètre</label>
          <select
            id="department-filter"
            value={selectedDepartment}
            onChange={(event) => setSelectedDepartment(event.target.value)}
          >
            <option value="all">Région Hauts-de-France</option>
            {departmentOptions.map((item) => (
              <option key={item.code_departement} value={item.code_departement}>
                {item.departement}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-copy">
          <span className="eyebrow">Parcours</span>
          <strong>{activeTabOption.label}</strong>
          <p>
            Le filtre départemental reste global. Les recherches EPCI et bassins sont replacées dans les
            onglets concernés.
          </p>
        </div>
      </section>

      <section className="tabbar panel">
        <div className="tabbar-copy">
          <span className="eyebrow">Navigation</span>
          <strong>{activeTabOption.label}</strong>
          <p>{activeTabOption.description}</p>
        </div>

        <div className="tab-button-row" role="tablist" aria-label="Navigation du dashboard">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? "tab-button active" : "tab-button"}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeSubViewLabel !== null && (
        <nav className="breadcrumb" aria-label="Position actuelle">
          <span className="breadcrumb-tab">{activeTabOption.label}</span>
          <span className="breadcrumb-sep" aria-hidden="true">›</span>
          <span className="breadcrumb-current">{activeSubViewLabel}</span>
        </nav>
      )}

      <section className="active-filters" aria-label="Filtres actifs">
        {activeFilterPills.map((pill) => (
          <span key={pill} className="filter-pill">
            {pill}
          </span>
        ))}
        {activeTab === "facilities" && hasFacilitiesFiltersActive && (
          <button type="button" className="filter-reset-button" onClick={resetFacilitiesFilters}>
            Réinitialiser les filtres
          </button>
        )}
      </section>

      {activeTab === "overview" ? (
        <>
          <section className="panel workspace-nav-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Organisation</span>
                <h2>{"Choisir une lecture synth\u00e8se"}</h2>
              </div>
              <p>
                {
                  "La synth\u00e8se est maintenant r\u00e9partie entre un panorama global, une lecture sociale d\u00e9di\u00e9e QPV et un point de situation sur l'\u00e9tat du parc."
                }
              </p>
            </div>
            <div className="chip-row workspace-nav-row" role="tablist" aria-label="Lecture synthèse">
              {OVERVIEW_VIEW_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={overviewView === option.key}
                  className={overviewView === option.key ? "chip active" : "chip"}
                  onClick={() => setOverviewView(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="chart-note">{activeOverviewView.description}</p>
          </section>

          {overviewView === "panorama" ? (
            <>
          <section className="kpi-grid">
            <StatCard
              label="Bassins recensés"
              value={formatInteger(currentOverview.bassins_total)}
              detail={`sur ${formatInteger(currentOverview.installations_total)} installations`}
              accent="lagoon"
            />
            <StatCard
              label="Licences FFN 2024"
              value={formatInteger(currentOverview.licences_ffn_2024)}
              detail={`${formatNumber(currentOverview.licences_ffn_pour_1000hab, 2)} pour 1 000 habitants`}
              accent="coral"
            />
            <StatCard
              label="Part de DSP"
              value={formatPercent(safeDivide(currentOverview.bassins_dsp, currentOverview.bassins_total))}
              detail={`${formatInteger(currentOverview.bassins_dsp)} bassins`}
              accent="sea"
            />
            <StatCard
              label="Part de régie publique"
              value={formatPercent(
                safeDivide(currentOverview.bassins_regie, currentOverview.bassins_total),
              )}
              detail={`${formatInteger(currentOverview.bassins_regie)} bassins`}
              accent="blue"
            />
            <StatCard
              label="Bassins à usage scolaires"
              value={formatInteger(currentOverview.bassins_usage_scolaires)}
              detail={formatPercent(
                safeDivide(currentOverview.bassins_usage_scolaires, currentOverview.bassins_total),
              )}
              accent="sand"
            />
            <StatCard
              label="Femmes dans les licences 2024"
              value={formatPercent(currentOverview.part_femmes_ffn_2024)}
              detail={`${formatInteger(currentOverview.population_total)} habitants`}
              accent="ink"
            />
          </section>

          <section className="signals-grid">
            {localitySignals.map((signal) => (
              <article key={signal.title} className="signal-card panel">
                <span className="eyebrow">{signal.kicker}</span>
                <h2>{signal.title}</h2>
                <p>{signal.description}</p>
              </article>
            ))}
          </section>

          <section className="content-grid">
            <article className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Lecture départementale</span>
                  <h2>Densité des bassins et intensité FFN</h2>
                </div>
                <p>Comparatif constant sur les cinq départements, avec mise en évidence du périmètre actif.</p>
              </div>

              <div className="chart-wrap tall">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departmentComparison} margin={{ top: 8, right: 10, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#d6d6d6" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" tickLine={false} axisLine={false} width={52} />
                    <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={52} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar yAxisId="left" dataKey="bassins_pour_100k_hab" name="Bassins / 100k" radius={[8, 8, 0, 0]}>
                      {departmentComparison.map((item) => (
                        <Cell
                          key={`${item.label}-bassins`}
                          fill={item.highlight ? "#000091" : "#c5c5fe"}
                        />
                      ))}
                    </Bar>
                    <Bar
                      yAxisId="right"
                      dataKey="licences_ffn_pour_1000hab"
                      name="Licences FFN / 1k"
                      radius={[8, 8, 0, 0]}
                    >
                      {departmentComparison.map((item) => (
                        <Cell
                          key={`${item.label}-licences`}
                          fill={item.highlight ? "#b34000" : "#ffd7cb"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="panel notes-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Repères rapides</span>
                  <h2>Points de lecture du périmètre actif</h2>
                </div>
                <p>Quatre marqueurs utiles avant de basculer vers les vues territoriales, bassins ou licences.</p>
              </div>

              <div className="marker-grid">
                {overviewMarkers.map((marker) => (
                  <div key={marker.label} className="marker-item">
                    <strong>{marker.value}</strong>
                    <span>{marker.label}</span>
                    <small>{marker.detail}</small>
                  </div>
                ))}
              </div>
            </article>
          </section>

            </>
          ) : null}

          {overviewView === "social" ? (
            <>
          <section className="panel overview-section-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Enjeux sociaux</span>
                <h2>Lecture QPV du périmètre actif</h2>
              </div>
              <p>
                Vue dédiée sur la population QPV, la proximité des bassins et les EPCI où la couverture
                sociale paraît la plus fragile.
              </p>
            </div>

            <div className="investigation-summary">
              <article className="summary-chip">
                <span className="summary-chip-label">Population QPV</span>
                <strong>{formatInteger(qpvScopeSummary.qpvPopulation)}</strong>
                <small>{formatPercent(qpvScopeSummary.qpvPopulationShare)} de la population du périmètre.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">QPV recensés</span>
                <strong>{formatInteger(qpvScopeSummary.qpvCount)}</strong>
                <small>Somme des QPV portés par les EPCI du périmètre actif.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Bassins en QPV ou à 200 m</span>
                <strong>{formatInteger(qpvScopeSummary.bassinsQpv200m)}</strong>
                <small>{formatInteger(qpvScopeSummary.bassinsQpv)} sont directement situés en QPV.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Bassins proches par QPV</span>
                <strong>
                  {qpvScopeSummary.qpvCount > 0
                    ? formatNumber(qpvScopeSummary.bassinsParQpv, 2)
                    : "n.c."}
                </strong>
                <small>Rapport entre bassins dans ou à 200 m et nombre de QPV recensés.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Bassins proches / 100k hab. QPV</span>
                <strong>
                  {qpvScopeSummary.qpvPopulation > 0
                    ? formatNumber(qpvScopeSummary.coveragePer100kQpv, 2)
                    : "n.c."}
                </strong>
                <small>Lecture de proximité pour les habitants des quartiers prioritaires.</small>
              </article>
            </div>
          </section>

          <section className="content-grid territory-comparison-grid">
            <article className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Fragilité sociale</span>
                  <h2>EPCI QPV à surveiller</h2>
                </div>
                <p>
                  Le score ci-dessous monte lorsque le poids QPV est élevé et que la couverture en bassins
                  proches recule.
                </p>
              </div>

              {qpvFragilityChartRows.length > 0 ? (
                <div className="chart-wrap ranking-chart" style={{ height: `${qpvChartHeight}px` }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={qpvFragilityChartRows}
                      layout="vertical"
                      margin={{ top: 0, right: 18, bottom: 0, left: 0 }}
                    >
                    <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#d6d6d6" />
                      <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} />
                      <YAxis
                        dataKey="epci_nom"
                        type="category"
                        tickLine={false}
                        axisLine={false}
                        width={290}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="value" name="Fragilité sociale QPV" radius={[0, 10, 10, 0]}>
                        {qpvFragilityChartRows.map((item) => (
                          <Cell
                            key={item.epci_code}
                            fill={Number(item.value) >= 60 ? "#b34000" : "#000091"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="subtle-empty">Aucun EPCI avec enjeu QPV n'est remonté sur le périmètre actif.</p>
              )}
            </article>

            <article className="panel territory-card">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Détail</span>
                  <h2>Couverture QPV par EPCI</h2>
                </div>
                <p>
                  Les premières lignes combinent poids social et faiblesse de couverture QPV dans le
                  périmètre actif.
                </p>
              </div>

              {qpvFragilityRows.length > 0 ? (
                <div className="table-scroll">
                  <table className="raw-table">
                    <thead>
                      <tr>
                        <th>EPCI</th>
                        <th>Pop. QPV</th>
                        <th>Part QPV</th>
                        <th>Bassins à 200 m / QPV</th>
                        <th>Bassins à 200 m / 100k hab. QPV</th>
                        <th>Fiche</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qpvFragilityRows.slice(0, 8).map((item) => (
                        <tr key={item.epci_code}>
                          <td>
                            <span className="cell-text" title={item.epci_nom}>
                              {item.epci_nom}
                            </span>
                          </td>
                          <td>{formatInteger(item.qpvPopulation)}</td>
                          <td>{formatPercent(item.qpvShare)}</td>
                          <td>{item.qpvCount > 0 ? formatNumber(item.bassinsParQpv, 2) : "n.c."}</td>
                          <td>
                            {item.qpvPopulation > 0 ? formatNumber(item.coveragePer100kQpv, 2) : "n.c."}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => openTerritoryCard(item.epci_code)}
                            >
                              Voir la fiche
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="subtle-empty">Aucun EPCI avec données QPV n'est disponible sur le périmètre actif.</p>
              )}
            </article>
          </section>
            </>
          ) : null}

          {overviewView === "operations" ? (
            <>
          <section className="panel overview-section-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">État du parc</span>
                <h2>Lecture d'exploitation du périmètre actif</h2>
              </div>
              <p>
                Cette vue synthétique lit le vieillissement, les travaux, l'accessibilité et les signaux
                scolaires à l'échelle du périmètre départemental actif. Le détail reste dans la vue
                Équipements puis État & scolaire.
              </p>
            </div>

            <div className="investigation-summary">
              <article className="summary-chip">
                <span className="summary-chip-label">Bassins enrichis</span>
                <strong>{formatInteger(overviewOperationalSummary.equipmentCount)}</strong>
                <small>{formatInteger(overviewOperationalSummary.installationCount)} installations sur le périmètre actif.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Mise en service moyenne</span>
                <strong>
                  {overviewOperationalSummary.averageServiceYear > 0
                    ? formatYear(overviewOperationalSummary.averageServiceYear)
                    : "n.c."}
                </strong>
                <small>{formatPercent(overviewOperationalSummary.yearCoverageShare)} du parc renseigne ce champ.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Parc antérieur à 2000</span>
                <strong>{formatPercent(overviewOperationalSummary.legacyShare)}</strong>
                <small>Part des bassins avec une mise en service antérieure à 2000.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Travaux depuis 2015</span>
                <strong>{formatPercent(overviewOperationalSummary.recentWorksShare)}</strong>
                <small>Repère de rénovation récente sur le périmètre actif.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Accessibilité renseignée</span>
                <strong>{formatPercent(overviewOperationalSummary.accessibilityShare)}</strong>
                <small>Signal handicap, PMR ou sensoriel déclaré.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Conditions scolaires favorables</span>
                <strong>{formatPercent(overviewSchoolOperationalSummary.schoolOperationalShare)}</strong>
                <small>Transport, accessibilité et ouverture présents ensemble sur les bassins scolaires.</small>
              </article>
            </div>
          </section>

          <section className="panel notes-panel overview-section-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Repères rapides</span>
                <h2>Comment lire cette vue</h2>
              </div>
              <p>Trois points d'attention utiles avant de basculer vers le détail équipements.</p>
            </div>

            <div className="message-stack">
              <article className="message-item">
                <strong>Vieillissement</strong>
                <div>
                  <span>Regarder ensemble l'année moyenne et la part avant 2000</span>
                  <small>Un parc ancien sans repère de travaux récents mérite une vigilance plus forte.</small>
                </div>
              </article>
              <article className="message-item">
                <strong>Scolaire</strong>
                <div>
                  <span>Les bassins scolaires ne se valent pas tous</span>
                  <small>Le dernier indicateur isole les sites où transport, accessibilité et ouverture sont renseignés.</small>
                </div>
              </article>
              <article className="message-item">
                <strong>Méthode</strong>
                <div>
                  <span>Cette lecture est synthétique et départementale</span>
                  <small>
                    Pour voir l'effet des filtres, des énergies ou des périodes de travaux, utiliser ensuite
                    la vue Équipements puis État & scolaire.
                  </small>
                </div>
              </article>
            </div>
          </section>

          <section className="panel table-panel overview-section-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Fragilité d'exploitation</span>
                  <h2>État du parc et lecture scolaire par EPCI</h2>
                </div>
                <p>
                  Le tableau croise les signaux d'ancienneté, de travaux, d'accessibilité et d'accueil
                  scolaire sans dépendre des filtres internes de la carte équipements.
                </p>
              </div>

              {overviewOperationalTerritoryRows.length > 0 ? (
                <div className="table-scroll">
                  <table className="raw-table">
                    <thead>
                      <tr>
                        <th>EPCI</th>
                        <th>Bassins</th>
                        <th>Mise en service moy.</th>
                        <th>Avant 2000</th>
                        <th>Travaux depuis 2015</th>
                        <th>Accès transport</th>
                        <th>Accessibilité</th>
                        <th>Bassins scolaires</th>
                        <th>Conditions favorables</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewOperationalTerritoryRows.map((item) => (
                        <tr key={item.epci_code}>
                          <td>
                            <strong>{item.epci_nom}</strong>
                            <div>{shortDepartment(item.departement)}</div>
                          </td>
                          <td>{`${formatInteger(item.basins)} · ${formatInteger(item.installations)} sites`}</td>
                          <td>{item.averageServiceYear > 0 ? formatYear(item.averageServiceYear) : "n.c."}</td>
                          <td>{formatPercent(item.legacyShare)}</td>
                          <td>{formatPercent(item.recentWorksShare)}</td>
                          <td>{formatPercent(item.transportAccessShare)}</td>
                          <td>{formatPercent(item.accessibilityShare)}</td>
                          <td>{formatInteger(item.schoolUsageCount)}</td>
                          <td>{formatPercent(item.schoolOperationalShare)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="subtle-empty">Aucun EPCI ne dispose de bassins enrichis sur le périmètre actif.</p>
              )}
          </section>
            </>
          ) : null}

          {overviewView === "school" ? (
            <>
          <section className="panel table-panel overview-section-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Demande scolaire</span>
                <h2>Pression scolaire potentielle par EPCI</h2>
              </div>
              <p>
                Les effectifs scolaires 2024 sont rapprochés de l'installation la plus proche pour lire la
                densité de demande et la proximité physique du parc actuel.
              </p>
            </div>

            <div className="investigation-summary">
              <article className="summary-chip">
                <span className="summary-chip-label">Établissements</span>
                <strong>{formatInteger(overviewSchoolDemandSummary.schools_total)}</strong>
                <small>{formatInteger(overviewSchoolDemandSummary.students_total)} élèves potentiels.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Premier / second degré</span>
                <strong>
                  {formatInteger(overviewSchoolDemandSummary.primary_students)} /{" "}
                  {formatInteger(overviewSchoolDemandSummary.secondary_students)}
                </strong>
                <small>Effectifs 2024 retenus sur le périmètre actif.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Élèves / installation</span>
                <strong>{formatNumber(overviewSchoolDemandSummary.students_per_installation, 1)}</strong>
                <small>{formatInteger(overviewSchoolDemandSummary.installations_total)} installations retenues.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Distance moyenne</span>
                <strong>{formatKilometers(overviewSchoolDemandSummary.average_distance_to_installation_km)}</strong>
                <small>{formatPercent(overviewSchoolDemandSummary.distance_coverage_share)} des élèves géolocalisés.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Élèves &lt; 5 km</span>
                <strong>{formatPercent(overviewSchoolDemandSummary.students_within_5km_installation_share)}</strong>
                <small>Part des élèves géolocalisés proches d'une installation.</small>
              </article>
            </div>

            {scopedSchoolDemandEpciRows.length > 0 ? (
              <div className="table-scroll">
                <table className="raw-table">
                  <thead>
                    <tr>
                      <th>EPCI</th>
                      <th>Établissements</th>
                      <th>Élèves</th>
                      <th>1er degré</th>
                      <th>2nd degré</th>
                      <th>Élèves / installation</th>
                      <th>Distance moy.</th>
                      <th>Élèves &lt; 5 km</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopedSchoolDemandEpciRows.map((item) => (
                      <tr key={item.epci_code}>
                        <td>
                          <strong>{item.epci_nom}</strong>
                          <div>{shortDepartment(item.departement ?? "")}</div>
                        </td>
                        <td>{formatInteger(item.schools_total)}</td>
                        <td>{formatInteger(item.students_total)}</td>
                        <td>{formatInteger(item.primary_students)}</td>
                        <td>{formatInteger(item.secondary_students)}</td>
                        <td>{formatNumber(item.students_per_installation, 1)}</td>
                        <td>{formatKilometers(item.average_distance_to_installation_km)}</td>
                        <td>{formatPercent(item.students_within_5km_installation_share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="subtle-empty">{"Aucune donn\u00e9e scolaire n'est disponible sur le p\u00e9rim\u00e8tre actif."}</p>
            )}
          </section>

            <section className="panel table-panel overview-section-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">{"Acc\u00e8s r\u00e9el scolaire"}</span>
                  <h2>{"Temps voiture des \u00e9l\u00e8ves vers une installation"}</h2>
                </div>
                <p>{"Cette lecture compl\u00e8te la distance \u00e0 vol d'oiseau avec un temps voiture calcul\u00e9 vers l'installation la plus proche."}</p>
              </div>

              <div className="investigation-summary">
                <article className="summary-chip">
                  <span className="summary-chip-label">Temps moyen voiture</span>
                  <strong>{formatMinutes(overviewSchoolDemandSummary.average_drive_time_to_installation_min)}</strong>
                  <small>{`${formatPercent(overviewSchoolDemandSummary.drive_time_coverage_share)} des \u00e9l\u00e8ves avec temps calcul\u00e9.`}</small>
                </article>
                <article className="summary-chip">
                  <span className="summary-chip-label">{"\u00c9l\u00e8ves < 15 min"}</span>
                  <strong>{formatPercent(overviewSchoolDemandSummary.students_within_15min_installation_share)}</strong>
                  <small>{`${formatKilometers(overviewSchoolDemandSummary.average_drive_distance_to_installation_km)} de distance routi\u00e8re moyenne.`}</small>
                </article>
              </div>

              {scopedSchoolDemandEpciRows.length > 0 ? (
                <div className="table-scroll">
                  <table className="raw-table">
                    <thead>
                      <tr>
                        <th>EPCI</th>
                        <th>Temps moy. voiture</th>
                        <th>{"Distance routi\u00e8re moy."}</th>
                        <th>{"\u00c9l\u00e8ves < 15 min"}</th>
                        <th>Couverture temps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedSchoolDemandEpciRows.map((item) => (
                        <tr key={`${item.epci_code}-drive`}>
                          <td>
                            <strong>{item.epci_nom}</strong>
                            <div>{shortDepartment(item.departement ?? "")}</div>
                          </td>
                          <td>{formatMinutes(item.average_drive_time_to_installation_min)}</td>
                          <td>{formatKilometers(item.average_drive_distance_to_installation_km)}</td>
                          <td>{formatPercent(item.students_within_15min_installation_share)}</td>
                          <td>{formatPercent(item.drive_time_coverage_share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="subtle-empty">{"Aucune mesure voiture scolaire n'est disponible sur le p\u00e9rim\u00e8tre actif."}</p>
              )}
            </section>
            </>
          ) : null}

          {overviewView === "access" ? (
            <>
          <section className="panel overview-section-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Accès voiture</span>
                <h2>Lecture d'accessibilité routière du périmètre actif</h2>
              </div>
              <p>
                Les temps sont calculés depuis le centre des communes vers l'installation aquatique la plus
                proche du socle régional. La lecture reste routière et ne couvre pas encore les transports
                collectifs.
              </p>
            </div>

            <div className="investigation-summary">
              <article className="summary-chip">
                <span className="summary-chip-label">Communes calculées</span>
                <strong>{formatInteger(overviewAccessibilitySummary.communes_routed_total)}</strong>
                <small>
                  {formatPercent(
                    safeDivide(
                      overviewAccessibilitySummary.communes_routed_total,
                      overviewAccessibilitySummary.communes_total,
                    ),
                  )}{" "}
                  des communes du périmètre actif.
                </small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Population couverte</span>
                <strong>{formatInteger(overviewAccessibilitySummary.population_routed_total)}</strong>
                <small>
                  {formatPercent(
                    safeDivide(
                      overviewAccessibilitySummary.population_routed_total,
                      overviewAccessibilitySummary.population_total,
                    ),
                  )}{" "}
                  de la population du périmètre actif.
                </small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Temps moyen</span>
                <strong>{formatMinutes(overviewAccessibilitySummary.average_drive_time_to_installation_min)}</strong>
                <small>{formatKilometers(overviewAccessibilitySummary.average_drive_distance_to_installation_km)} de moyenne.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Population &lt; 15 min</span>
                <strong>{formatPercent(overviewAccessibilitySummary.population_within_15min_share)}</strong>
                <small>{formatPercent(overviewAccessibilitySummary.population_within_20min_share)} à moins de 20 min.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Communes &lt; 15 min</span>
                <strong>{formatPercent(overviewAccessibilitySummary.communes_within_15min_share)}</strong>
                <small>{formatInteger(overviewAccessibilitySummary.reachable_installations_total)} installations de proximité mobilisées.</small>
              </article>
            </div>
          </section>

          <section className="panel notes-panel overview-section-panel">
            <div className="panel-heading">
              <div>
                    <span className="eyebrow">Repères rapides</span>
                <h2>Comment lire cette vue</h2>
              </div>
              <p>Trois rep?res pour distinguer vitesse d'acc?s moyenne et poches plus fragiles.</p>
            </div>

            <div className="message-stack">
              {overviewAccessibilityHighlights.map((item) => (
                <article key={item.label} className="message-item">
                  <strong>{item.label}</strong>
                  <div>
                    <span>{item.value}</span>
                    <small>{item.detail}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel table-panel overview-section-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Lecture territoriale</span>
                <h2>Accessibilité voiture par EPCI</h2>
              </div>
              <p>
                Le tableau agrège les temps moyens et les parts de population couvertes pour séparer les
                EPCI vite accessibles de ceux où l'accès routier reste plus fragile.
              </p>
            </div>

            {scopedAccessibilityEpciRows.length > 0 ? (
              <div className="table-scroll">
                <table className="raw-table">
                  <thead>
                    <tr>
                      <th>EPCI</th>
                      <th>Communes calculées</th>
                      <th>Temps moyen</th>
                      <th>Distance moyenne</th>
                      <th>Population &lt; 10 min</th>
                      <th>Population &lt; 15 min</th>
                      <th>Population &lt; 20 min</th>
                      <th>Communes &lt; 15 min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopedAccessibilityEpciRows.map((item) => (
                      <tr key={item.epci_code}>
                        <td>
                          <strong>{item.epci_nom}</strong>
                          <div>{shortDepartment(item.departement ?? "")}</div>
                        </td>
                        <td>{`${formatInteger(item.communes_routed_total)} / ${formatInteger(item.communes_total)}`}</td>
                        <td>{formatMinutes(item.average_drive_time_to_installation_min)}</td>
                        <td>{formatKilometers(item.average_drive_distance_to_installation_km)}</td>
                        <td>{formatPercent(item.population_within_10min_share)}</td>
                        <td>{formatPercent(item.population_within_15min_share)}</td>
                        <td>{formatPercent(item.population_within_20min_share)}</td>
                        <td>{formatPercent(item.communes_within_15min_share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="subtle-empty">Aucune mesure voiture n'est disponible sur le périmètre actif.</p>
            )}
          </section>
            </>
          ) : null}

          {overviewView === "transit" ? (
            <>
              <section className="panel overview-section-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Offre TC potentielle</span>
                    <h2>Lecture GTFS autour du périmètre actif</h2>
                  </div>
                  <p>
                    Cette vue lit la proximité aux arrêts et gares des flux GTFS officiels en Hauts-de-France.
                    Elle mesure une offre potentielle à pied, pas un temps de trajet complet porte-à-porte.
                  </p>
                </div>

                <div className="investigation-summary">
                  <article className="summary-chip">
                    <span className="summary-chip-label">Arrêts ou gares actifs</span>
                    <strong>{formatInteger(overviewTransitSummary.transit_hubs_total)}</strong>
                    <small>Socle GTFS TER et interurbain agrégé sur un jour de semaine théorique.</small>
                  </article>
                  <article className="summary-chip">
                    <span className="summary-chip-label">Distance moyenne à un arrêt</span>
                    <strong>{formatKilometers(overviewTransitSummary.average_nearest_stop_distance_km)}</strong>
                    <small>{formatInteger(overviewTransitSummary.communes_geolocated_total)} communes géolocalisées.</small>
                  </article>
                  <article className="summary-chip">
                    <span className="summary-chip-label">Population &lt; 500 m</span>
                    <strong>{formatPercent(overviewTransitSummary.population_within_500m_share)}</strong>
                    <small>{formatPercent(overviewTransitSummary.population_within_1000m_share)} à moins d'1 km.</small>
                  </article>
                  <article className="summary-chip">
                    <span className="summary-chip-label">Installations &lt; 500 m</span>
                    <strong>{formatPercent(overviewTransitSummary.installations_within_500m_share)}</strong>
                    <small>{formatPercent(overviewTransitSummary.installations_within_1000m_share)} à moins d'1 km.</small>
                  </article>
                  <article className="summary-chip">
                    <span className="summary-chip-label">Élèves &lt; 500 m</span>
                    <strong>{formatPercent(overviewTransitSummary.students_within_500m_share)}</strong>
                    <small>{formatPercent(overviewTransitSummary.students_within_1000m_share)} à moins d'1 km d'un arrêt.</small>
                  </article>
                </div>
              </section>

              <section className="panel notes-panel overview-section-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Repères rapides</span>
                    <h2>Comment lire cette vue</h2>
                  </div>
                  <p>Quatre repères pour distinguer présence d'arrêts proches et intensité minimale de desserte.</p>
                </div>

                <div className="message-stack">
                  {overviewTransitHighlights.map((item) => (
                    <article key={item.label} className="message-item">
                      <strong>{item.label}</strong>
                      <div>
                        <span>{item.value}</span>
                        <small>{item.detail}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel table-panel overview-section-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Lecture territoriale</span>
                    <h2>Offre TC potentielle par EPCI</h2>
                  </div>
                  <p>
                    Le tableau agrège la proximité aux arrêts GTFS, la couverture des installations et
                    l'ancrage potentiel des élèves à pied autour du réseau.
                  </p>
                </div>

                {scopedTransitEpciRows.length > 0 ? (
                  <div className="table-scroll">
                    <table className="raw-table">
                      <thead>
                        <tr>
                          <th>EPCI</th>
                          <th>Distance moyenne à un arrêt</th>
                          <th>Population &lt; 500 m</th>
                          <th>Population &lt; 1 km</th>
                          <th>Installations &lt; 500 m</th>
                          <th>Élèves &lt; 500 m</th>
                          <th>Passages théoriques à 1 km</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scopedTransitEpciRows.map((item) => (
                          <tr key={`${item.epci_code}-transit`}>
                            <td>
                              <strong>{item.epci_nom}</strong>
                              <div>{shortDepartment(item.departement ?? "")}</div>
                            </td>
                            <td>{formatKilometers(item.average_nearest_stop_distance_km)}</td>
                            <td>{formatPercent(item.population_within_500m_share)}</td>
                            <td>{formatPercent(item.population_within_1000m_share)}</td>
                            <td>{formatPercent(item.installations_within_500m_share)}</td>
                            <td>{formatPercent(item.students_within_500m_share)}</td>
                            <td>{formatInteger(Math.round(item.average_weekday_trips_within_1000m))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="subtle-empty">Aucune lecture GTFS n'est disponible sur le périmètre actif.</p>
                )}
              </section>
            </>
          ) : null}
        </>
      ) : null}

      {activeTab === "territories" ? (
        <>
          <section className="panel territory-nav-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Organisation</span>
                <h2>Choisir une vue de travail</h2>
              </div>
              <p>
                L'onglet est maintenant réparti en sous-vues pour éviter une page trop longue à parcourir.
              </p>
            </div>
            <div className="chip-row territory-nav-row" role="tablist" aria-label="Vue de travail territoires">
              {TERRITORIES_VIEW_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={territoriesView === option.key}
                  className={territoriesView === option.key ? "chip active" : "chip"}
                  onClick={() => setTerritoriesView(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="chart-note">{activeTerritoriesView.description}</p>
          </section>

          {territoriesView === "investigation" ? (
            <>
              <section className="panel investigation-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Lecture d'investigation</span>
                <h2>Repérer les EPCI à approfondir</h2>
              </div>
              <p>
                Trois lectures coexistent désormais : sous-équipement, tension d'usage et impact
                territorial. Le composite sert à orienter l'enquête, pas à trancher seul.
              </p>
            </div>

            <div className="investigation-toolbar">
              <div className="investigation-lens-group" role="tablist" aria-label="Lecture de priorisation">
                {INVESTIGATION_LENS_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    role="tab"
                    aria-selected={investigationLens === option.key}
                    className={`rank-limit-button ${investigationLens === option.key ? "active" : ""}`}
                    onClick={() => setInvestigationLens(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="lens-description">{activeInvestigationLens.description}</p>
            </div>

            <article className="score-method-card">
              <div className="score-method-copy">
                <strong>Comment lire le score</strong>
                <p>
                  Le score composite n&apos;est pas un besoin absolu. Il classe les EPCI du périmètre actif
                  à partir de trois sous-scores relatifs. Si l&apos;on passe de la région à un département,
                  les rangs sont recalculés, car le groupe de comparaison change.
                </p>
              </div>
              <div className="score-weight-row">
                {INVESTIGATION_SCORE_DEFINITIONS.map((item) => (
                  <span key={item.lens} className="signal-pill">
                    {formatInteger(Math.round(item.weight * 100))} % {item.label}
                  </span>
                ))}
              </div>
              <p className="score-method-note">
                En pratique : un territoire peut être moyen en sous-équipement mais très haut en tension
                et en impact. C&apos;est précisément ce qui permet de faire remonter des grandes polarités
                comme la MEL sans leur attribuer artificiellement un bonus.
              </p>
              <div className="score-definition-grid">
                {INVESTIGATION_SCORE_DEFINITIONS.map((item) => (
                  <article key={item.lens} className="score-definition-card">
                    <span className="summary-chip-label">{item.label}</span>
                    <strong>{formatInteger(Math.round(item.weight * 100))} % du composite</strong>
                    <p>{item.description}</p>
                    <ul className="score-definition-list">
                      {item.metrics.map((metric) => (
                        <li key={metric}>{metric}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </article>

            <div className="investigation-summary">
              <article className="summary-chip">
                <span className="summary-chip-label">EPCI dans le périmètre</span>
                <strong>{formatInteger(investigationRows.length)}</strong>
                <small>La table ci-dessous reste exhaustive après filtres et recherche.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Très prioritaires</span>
                <strong>{formatInteger(investigationStats.highPriorityCount)}</strong>
                <small>Score composite supérieur ou égal à 70/100.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Sous-équipement marqué</span>
                <strong>{formatInteger(investigationStats.highOfferGapCount)}</strong>
                <small>Déficit d'offre, de densité ou de capacité plus net sur le périmètre.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Sous tension</span>
                <strong>{formatInteger(investigationStats.highPressureCount)}</strong>
                <small>Territoires plus exposés à la saturation, aux licences et aux usages.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Fort impact</span>
                <strong>{formatInteger(investigationStats.highImpactCount)}</strong>
                <small>Territoires lourds en population, en licences ou en enjeux sociaux touchés.</small>
              </article>
            </div>

            {investigationHighlights.length > 0 ? (
              <div className="investigation-cards">
                {investigationHighlights.map((item, index) => (
                  <article key={item.epci_code} className="investigation-card">
                    <div className="investigation-card-top">
                      <span
                        className={`score-pill ${getPriorityToneClass(
                          getInvestigationScoreByLens(item, investigationLens),
                        )}`}
                      >
                        #{index + 1} {activeInvestigationLens.label} ·{" "}
                        {formatScore(getInvestigationScoreByLens(item, investigationLens))}
                      </span>
                      <span className={`profile-pill ${getProfileToneClass(item.profile)}`}>
                        {item.profile}
                      </span>
                    </div>
                    <h3>{item.epci_nom}</h3>
                    <p className="investigation-card-meta">
                      {shortDepartment(item.departement)} · {formatInteger(item.population)} hab. ·{" "}
                      {formatInteger(item.bassins)} bassins
                    </p>
                    <p className="investigation-hypothesis">{item.hypothesis}</p>
                    <div className="signal-pill-row">
                      <span className="signal-pill">
                        {activeMetricOption.label} :{" "}
                        {formatOptionalMetric(item.selectedMetricValue, item.selectedMetricKind)}
                      </span>
                      <span className="signal-pill">Priorité {formatScore(item.priorityScore)}</span>
                      <span className="signal-pill">Sous-équipement {formatIndexScore(item.offerGapIndex)}</span>
                      <span className="signal-pill">
                        Pression {formatIndexScore(item.pressureIndex)}
                      </span>
                      <span className="signal-pill">Impact {formatIndexScore(item.impactIndex)}</span>
                    </div>
                    <div className="signal-pill-row">
                      <span className="signal-pill">
                        Licences / bassin {formatNumber(item.licencesFfnParBassin, 1)}
                      </span>
                      <span className="signal-pill">
                        Surface / 1 000 hab. {formatNumber(item.surfaceM2Pour1000Hab, 2)}
                      </span>
                      <span className="signal-pill">
                        Licences / 100 m2 {formatNumber(item.licencesFfnPour100M2, 2)}
                      </span>
                      <span className="signal-pill">
                        Communes sans bassin {formatPercent(item.communesSansBassinShare)}
                      </span>
                    </div>
                    <div className="reason-list">
                      {item.priorityDrivers.slice(0, 3).map((reason) => (
                        <span key={reason} className="reason-item">
                          {reason}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => openTerritoryCard(item.epci_code)}
                    >
                      Ouvrir la fiche territoire
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="subtle-empty">Aucun EPCI ne correspond au périmètre ou à la recherche active.</p>
            )}
          </section>

          <section className="content-grid territory-comparison-grid">
            <article className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">EPCI</span>
                  <h2>Repérage rapide sur l'indicateur actif</h2>
                </div>
                <div className="panel-heading-actions">
                  <div className="compact-control">
                    <label htmlFor="epci-search">Recherche EPCI</label>
                    <input
                      id="epci-search"
                      type="search"
                      placeholder="Lille, Beauvaisis, Dunkerque..."
                      value={epciSearch}
                      onChange={(event) => setEpciSearch(event.target.value)}
                    />
                  </div>
                  <div className="compact-control">
                    <label htmlFor="metric-select">Indicateur</label>
                    <select
                      id="metric-select"
                      value={selectedMetric}
                      onChange={(event) => setSelectedMetric(event.target.value as MetricKey)}
                    >
                      {METRIC_OPTIONS.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="compact-control">
                    <label>Vue rapide</label>
                    <div className="rank-limit-group" aria-label="Nombre d'EPCI visibles dans le graphique">
                      {RANKING_LIMIT_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`rank-limit-button ${rankingLimit === option ? "active" : ""}`}
                          onClick={() => setRankingLimit(option)}
                        >
                          {option === 100 ? "Tous" : `Top ${option}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {epciRanking.length > 0 ? (
                <div className="chart-wrap ranking-chart" style={{ height: `${epciChartHeight}px` }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={epciRanking} layout="vertical" margin={{ top: 0, right: 18, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#d6d6d6" />
                      <XAxis
                        type="number"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) =>
                          formatMetricByKind(Number(value), activeMetricOption.kind)
                        }
                      />
                      <YAxis
                        dataKey="epci_nom"
                        type="category"
                        tickLine={false}
                        axisLine={false}
                        width={290}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        dataKey="value"
                        name={activeMetricOption.label}
                        fill="#000091"
                        radius={[0, 10, 10, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="subtle-empty">Aucun EPCI ne correspond à la recherche ou au périmètre actif.</p>
              )}
              <p className="chart-note">
                Le graphique affiche {rankingLimit === 100 ? "l'ensemble des EPCI visibles" : `un top ${rankingLimit}`}. La table de priorisation plus bas liste l'ensemble des EPCI filtrés.
              </p>
            </article>

            <article className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Messages clés</span>
                  <h2>Hypothèses à tester</h2>
                </div>
                <p>
                  La priorisation combine plusieurs signaux croisés pour faire émerger des
                  territoires à vérifier en entretien.
                </p>
              </div>

              <div className="message-stack">
                <article className="message-item">
                  <strong>{formatInteger(investigationStats.highPriorityCount)}</strong>
                  <div>
                    <span>EPCI très prioritaires</span>
                    <small>
                      Les plus urgents à qualifier à la fois sur l'offre, la pression et la
                      couverture.
                    </small>
                  </div>
                </article>
                <article className="message-item">
                  <strong>{formatInteger(investigationStats.watchCount)}</strong>
                  <div>
                    <span>EPCI à investiguer</span>
                    <small>
                      Territoires intermédiaires où une lecture terrain peut faire basculer
                      l'interprétation.
                    </small>
                  </div>
                </article>
                <article className="message-item">
                  <strong>{activeInvestigationLens.label}</strong>
                  <div>
                    <span>Lecture actuellement mise en avant</span>
                    <small>
                      {activeInvestigationLens.description}
                    </small>
                  </div>
                </article>
                {selectedEpciCode !== "all" ? (
                  <article className="message-item">
                    <strong>{territoryName}</strong>
                    <div>
                      <span>Territoire de lecture active</span>
                      <small>
                        La fiche ci-dessous compare ce territoire à son département et à la région.
                      </small>
                    </div>
                  </article>
                ) : null}
              </div>
            </article>
          </section>

              <section className="panel quadrant-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Positionnement</span>
                <h2>Quadrants sous-équipement × tension</h2>
              </div>
              <p>
                Axe horizontal : déficit d'offre. Axe vertical : tension d'usage. La taille de la
                bulle traduit l'impact territorial.
              </p>
            </div>

            {quadrantPoints.length > 0 ? (
              <>
                <div className="chart-wrap quadrant-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 12, right: 20, bottom: 20, left: 10 }}>
                      <CartesianGrid strokeDasharray="4 4" stroke="#d6d6d6" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        domain={[0, 100]}
                        tickLine={false}
                        axisLine={false}
                        ticks={[0, 20, 40, 60, 80, 100]}
                        name="Sous-équipement"
                        unit="/100"
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        domain={[0, 100]}
                        tickLine={false}
                        axisLine={false}
                        ticks={[0, 20, 40, 60, 80, 100]}
                        width={48}
                        name="Pression"
                        unit="/100"
                      />
                      <ZAxis type="number" dataKey="z" range={[120, 900]} />
                      <ReferenceLine x={QUADRANT_THRESHOLD} stroke="#b1b1ff" strokeDasharray="6 6" />
                      <ReferenceLine y={QUADRANT_THRESHOLD} stroke="#b1b1ff" strokeDasharray="6 6" />
                      <Tooltip content={<QuadrantTooltip />} cursor={{ strokeDasharray: "4 4" }} />
                      <Scatter
                        data={quadrantPoints}
                        shape={(props) => <QuadrantBubble {...props} onSelect={openTerritoryCard} />}
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>

                <p className="chart-note">
                  En haut à droite : les territoires à regarder en premier. En bas à droite : déficit
                  d'offre à confirmer. En haut à gauche : tension d'usage sur une offre existante.
                </p>

                <div className="quadrant-summary-grid">
                  {quadrantSummaries.map((item) => (
                    <article key={item.key} className="quadrant-card">
                      <span className="summary-chip-label">{item.label}</span>
                      <strong>{formatInteger(item.count)}</strong>
                      <p>{item.description}</p>
                      <small>
                        {item.examples.length > 0 ? item.examples.join(" · ") : "Aucun EPCI sur le périmètre actif."}
                      </small>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="subtle-empty">Aucun EPCI n'est disponible pour tracer le quadrant sur le périmètre actif.</p>
            )}
          </section>

              <section className="panel investigation-table-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Exhaustif</span>
                <h2>Table d'investigation des EPCI</h2>
              </div>
              <p>
                {formatInteger(rankedInvestigationRows.length)} EPCI listés sur le périmètre actif.
                La lecture active trie la table, avec pagination de 10 lignes pour faciliter le parcours.
              </p>
            </div>

            {rankedInvestigationRows.length > 0 ? (
              <>
                <div className="table-scroll">
                  <div className="investigation-table">
                    <div className="investigation-head-row">
                      <span>Rang</span>
                      <span>EPCI</span>
                      <span>Lecture du score</span>
                      <span>Indicateurs actifs et signaux</span>
                      <span>Hypothèse d&apos;investigation</span>
                    </div>
                    {pagedInvestigationRows.map((item, index) => (
                      <div
                        key={item.epci_code}
                        className={`investigation-row ${selectedEpciCode === item.epci_code ? "selected" : ""}`}
                      >
                        <div className="investigation-rank">
                          <strong>#{investigationRangeStart + index}</strong>
                          <span
                            className={`score-pill ${getPriorityToneClass(
                              getInvestigationScoreByLens(item, investigationLens),
                            )}`}
                          >
                            {formatScore(getInvestigationScoreByLens(item, investigationLens))}
                          </span>
                          <small>Priorité {formatScore(item.priorityScore)}</small>
                        </div>
                        <div className="investigation-territory">
                          <strong>{item.epci_nom}</strong>
                          <small className="investigation-territory-meta">
                            {shortDepartment(item.departement)} · {formatInteger(item.population)} hab.
                            · {formatInteger(item.bassins)} b. · {formatInteger(item.licences)} lic.
                          </small>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => openTerritoryCard(item.epci_code)}
                          >
                            Voir la fiche territoire
                          </button>
                        </div>
                        <div className="investigation-score-column">
                          <InvestigationScoreBreakdown
                            item={item}
                            rankMaps={investigationRankMaps}
                            total={investigationRows.length}
                            compact
                          />
                        </div>
                        <div className="investigation-signals investigation-signals-column">
                          <span>
                            {activeMetricOption.label}{" "}
                            {formatOptionalMetric(item.selectedMetricValue, item.selectedMetricKind)}
                          </span>
                          <span>Licences / bassin {formatNumber(item.licencesFfnParBassin, 1)}</span>
                          <span>Surface / 1 000 hab. {formatNumber(item.surfaceM2Pour1000Hab, 2)}</span>
                          <span>Licences / 100 m2 {formatNumber(item.licencesFfnPour100M2, 2)}</span>
                          <span>
                            Communes sans bassin {formatInteger(item.communesSansBassinVolume)} ·{" "}
                            {formatPercent(item.communesSansBassinShare)}
                          </span>
                        </div>
                        <div className="investigation-profile">
                          <span className={`profile-pill ${getProfileToneClass(item.profile)}`}>
                            {item.profile}
                          </span>
                          <small>{item.hypothesis}</small>
                          <div className="reason-list">
                            {item.priorityDrivers.slice(0, 3).map((reason) => (
                              <span key={reason} className="reason-item">
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pager">
                  <span>
                    EPCI {formatInteger(investigationRangeStart)} à {formatInteger(investigationRangeEnd)} sur{" "}
                    {formatInteger(rankedInvestigationRows.length)}
                  </span>
                  <div className="pager-actions">
                    <button
                      type="button"
                      className="pager-button"
                      onClick={() => setInvestigationPage((page) => Math.max(1, page - 1))}
                      disabled={currentInvestigationPage === 1}
                    >
                      Précédent
                    </button>
                    <strong>
                      Page {formatInteger(currentInvestigationPage)} / {formatInteger(investigationPageCount)}
                    </strong>
                    <button
                      type="button"
                      className="pager-button"
                      onClick={() => setInvestigationPage((page) => Math.min(investigationPageCount, page + 1))}
                      disabled={currentInvestigationPage === investigationPageCount}
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="subtle-empty">Aucun EPCI n'est disponible dans le périmètre actif.</p>
            )}
          </section>

            </>
          ) : null}

          {territoriesView !== "investigation" ? (
            <section ref={territoryPanelRef} className="panel territory-panel">
            <div className="territory-header">
              <div>
                <span className="eyebrow">{territoryPanelEyebrow}</span>
                <h2>{territoryPanelTitle}</h2>
                <p>{territoryPanelSubtitle}</p>
              </div>

              <div className="panel-heading-actions">
                <div className="compact-control territory-selector">
                  <label htmlFor="territory-select">Territoire</label>
                  <select
                    id="territory-select"
                    value={selectedEpciCode}
                    onChange={(event) => setSelectedEpciCode(event.target.value)}
                  >
                    <option value="all">
                      {selectedDepartment === "all" ? "Vue régionale" : `Vue ${departmentLabel}`}
                    </option>
                    {territoryEpciOptions.map((item) => (
                      <option key={item.epci_code} value={item.epci_code}>
                        {item.epci_nom}
                      </option>
                    ))}
                  </select>
                </div>

                {territoriesView === "comparisons" ? (
                  <div className="compact-control territory-selector">
                    <label htmlFor="territory-compare-select">Comparer avec</label>
                    <select
                      id="territory-compare-select"
                      value={selectedComparisonEpciCode}
                      onChange={(event) => setSelectedComparisonEpciCode(event.target.value)}
                      disabled={selectedEpciCode === "all"}
                    >
                      <option value="all">
                        {selectedEpciCode === "all" ? "Sélectionne d'abord un EPCI" : "Aucun comparatif"}
                      </option>
                      {comparisonEpciOptions.map((item) => (
                        <option key={item.epci_code} value={item.epci_code}>
                          {item.epci_nom}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {territoriesView === "comparisons" ? (
                  <div className="compact-control territory-selector">
                    <label htmlFor="territory-count-mode">Compter en</label>
                    <select
                      id="territory-count-mode"
                      value={inventoryCountMode}
                      onChange={(event) => setInventoryCountMode(event.target.value as InventoryCountMode)}
                    >
                      <option value="equipments">Équipements</option>
                      <option value="installations">Installations</option>
                    </select>
                  </div>
                ) : null}
              </div>
            </div>

            {territoriesView === "territory" ? (
              <div className="territory-kpi-grid">
                {territoryKpis.map((item) => (
                  <StatCard
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    detail={item.detail}
                    accent={item.accent}
                  />
                ))}
              </div>
            ) : (
              <p className="chart-note">
                Cette vue regroupe uniquement les comparaisons directes, les bassins équivalents et les
                lectures de structure du parc.
              </p>
            )}

            {territoriesView === "comparisons" && selectedEpciCode === "all" ? (
              <p className="subtle-empty">
                Sélectionne un EPCI principal pour afficher les comparaisons détaillées.
              </p>
            ) : null}

            <div className="territory-detail-grid">
              {territoriesView === "territory" ? (
              <div className="territory-card">
                <h3>État d'exploitation et lecture scolaire</h3>
                <div className="fact-list">
                  {territoryOperationalFacts.map((fact) => (
                    <div key={fact.label} className="fact-item">
                      <div>
                        <span>{fact.label}</span>
                        <small>{fact.detail}</small>
                      </div>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
              ) : null}

              {territoriesView === "territory" ? (
              <div className="territory-card">
                <h3>Accessibilité voiture</h3>
                <div className="fact-list">
                  {territoryAccessibilityFacts.map((fact) => (
                    <div key={fact.label} className="fact-item">
                      <div>
                        <span>{fact.label}</span>
                        <small>{fact.detail}</small>
                      </div>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
              ) : null}

              {territoriesView === "territory" ? (
              <div className="territory-card">
                <h3>Offre TC potentielle</h3>
                <div className="fact-list">
                  {territoryTransitFacts.map((fact) => (
                    <div key={fact.label} className="fact-item">
                      <div>
                        <span>{fact.label}</span>
                        <small>{fact.detail}</small>
                      </div>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
              ) : null}

              {territoriesView === "territory" ? (
              <div className="territory-card">
                <h3>Pression scolaire potentielle</h3>
                <div className="fact-list">
                  {territorySchoolDriveFacts.map((fact) => (
                    <div key={fact.label} className="fact-item">
                      <div>
                        <span>{fact.label}</span>
                        <small>{fact.detail}</small>
                      </div>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
              ) : null}

              {territoriesView === "territory" ? (
              <div className="territory-card">
                <h3>Repères territoriaux</h3>
                <div className="fact-list">
                  {territoryFacts.map((fact) => (
                    <div key={fact.label} className="fact-item">
                      <div>
                        <span>{fact.label}</span>
                        <small>{fact.detail}</small>
                      </div>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
              ) : null}

              {territoriesView === "territory" ? (
              <div className="territory-card">
                <h3>Comparatifs territoire / département / région</h3>
                <div className="benchmark-table">
                  <div className="benchmark-head-row">
                    <span>Indicateur</span>
                    <span>Territoire</span>
                    <span>Dépt.</span>
                    <span>Région</span>
                  </div>
                  {territoryBenchmarks.map((item) => (
                    <div key={item.label} className="benchmark-row">
                      <span>{item.label}</span>
                      <strong>{formatMetricByKind(item.territory, item.kind)}</strong>
                      <span>
                        {item.department === null ? "n.c." : formatMetricByKind(item.department, item.kind)}
                      </span>
                      <span>{formatMetricByKind(item.region, item.kind)}</span>
                    </div>
                  ))}
                </div>
              </div>
              ) : null}

              {territoriesView === "comparisons" && selectedEpciCode !== "all" ? (
              <div className="territory-card territory-card-wide">
                <h3>Comparaison directe entre deux EPCI</h3>
                {activeEpci && comparisonEpci && territoryDirectComparisonRowsWithDrive.length > 0 ? (
                  <div className="table-scroll">
                    <table className="raw-table">
                      <thead>
                        <tr>
                          <th>Indicateur</th>
                          <th>{activeEpci.epci_nom}</th>
                          <th>{comparisonEpci.epci_nom}</th>
                          <th>Écart</th>
                        </tr>
                      </thead>
                      <tbody>
                        {territoryDirectComparisonRowsWithDrive.map((item) => (
                          <tr key={item.label}>
                            <td>{item.label}</td>
                            <td>{formatMetricByKind(item.primary, item.kind)}</td>
                            <td>{formatMetricByKind(item.comparison, item.kind)}</td>
                            <td>{`${getDeltaArrow(item.delta)} ${formatSignedMetricByKind(item.delta, item.kind)}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="subtle-empty">
                    Sélectionne un EPCI principal puis un second EPCI pour afficher un face-à-face direct
                    sur les indicateurs les plus structurants.
                  </p>
                )}
              </div>
              ) : null}

              {territoriesView === "comparisons" && selectedEpciCode !== "all" ? (
              <div className="territory-card territory-card-wide">
                <div className="territory-card-header">
                  <div>
                    <h3>Comparer des bassins équivalents</h3>
                    <p className="subtle-empty">
                      Profils construits à partir du type d'équipement, de la longueur, de la surface, des
                      couloirs quand ils existent, et de la profondeur pour les fosses.
                    </p>
                  </div>
                  <div className="territory-comparable-controls">
                    <div className="compact-control territory-comparable-select">
                      <label htmlFor="territory-comparable-scope">Famille comparable</label>
                      <select
                        id="territory-comparable-scope"
                        value={comparableProfileScope}
                        onChange={(event) => setComparableProfileScope(event.target.value as ComparableProfileScope)}
                      >
                        {COMPARABLE_PROFILE_SCOPE_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="compact-control territory-comparable-select">
                      <label htmlFor="territory-comparable-context">Contexte</label>
                      <select
                        id="territory-comparable-context"
                        value={comparableBasinContext}
                        onChange={(event) => setComparableBasinContext(event.target.value as ComparableBasinContext)}
                      >
                        {COMPARABLE_BASIN_CONTEXT_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="chip-row compact-chip-row">
                  {COMPARABLE_PROFILE_SCOPE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={comparableProfileScope === option.key ? "chip active" : "chip"}
                      onClick={() => setComparableProfileScope(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="chip-row compact-chip-row">
                  {COMPARABLE_BASIN_CONTEXT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={comparableBasinContext === option.key ? "chip active" : "chip"}
                      onClick={() => setComparableBasinContext(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <p className="chart-note">
                  {activeComparableProfileScope.description} {activeComparableBasinContext.description}
                </p>

                {filteredComparableTerritoryBasins.length > 0 ? (
                  <>
                    <div className="investigation-summary">
                      <article className="summary-chip">
                        <span className="summary-chip-label">{activeEpci?.epci_nom ?? territoryName}</span>
                          <strong>{formatInteger(filteredComparableTerritorySummary.equipmentCount)}</strong>
                          <small>
                            {formatInteger(filteredComparableTerritorySummary.installationCount)} installations ·{" "}
                            {filteredComparableTerritorySummary.averageLength > 0
                              ? `${formatOptionalMeasure(filteredComparableTerritorySummary.averageLength, "m", 1)} de longueur moyenne`
                              : "longueur moyenne n.c."}
                          </small>
                        </article>
                      {comparisonEpci ? (
                        <article className="summary-chip">
                          <span className="summary-chip-label">{comparisonEpci.epci_nom}</span>
                          <strong>{formatInteger(filteredComparableComparisonSummary.equipmentCount)}</strong>
                          <small>
                            {formatInteger(filteredComparableComparisonSummary.installationCount)} installations ·{" "}
                            {filteredComparableComparisonSummary.averageLength > 0
                              ? `${formatOptionalMeasure(filteredComparableComparisonSummary.averageLength, "m", 1)} de longueur moyenne`
                              : "longueur moyenne n.c."}
                          </small>
                        </article>
                      ) : null}
                      <article className="summary-chip">
                        <span className="summary-chip-label">Surface moyenne</span>
                        <strong>{formatOptionalMeasure(filteredComparableTerritorySummary.averageSurface, "m²", 0)}</strong>
                        <small>
                          {comparisonEpci
                            ? filteredComparableComparisonSummary.averageSurface > 0
                              ? `${formatOptionalMeasure(filteredComparableComparisonSummary.averageSurface, "m²", 0)} pour ${comparisonEpci.epci_nom}`
                              : `surface moyenne n.c. pour ${comparisonEpci.epci_nom}`
                            : "Lecture à la maille équipement pour voir les bassins réellement comparés."}
                        </small>
                      </article>
                      <article className="summary-chip">
                        <span className="summary-chip-label">Écart équipements</span>
                        <strong>
                          {comparisonEpci
                            ? formatSignedInteger(
                                filteredComparableTerritorySummary.equipmentCount -
                                  filteredComparableComparisonSummary.equipmentCount,
                              )
                            : formatInteger(filteredComparableTerritorySummary.equipmentCount)}
                        </strong>
                        <small>
                          {comparisonEpci
                            ? "Différence brute entre les bassins comparables sélectionnés."
                            : filteredComparableTerritorySummary.averageMaxDepth > 0
                              ? `${formatOptionalMeasure(filteredComparableTerritorySummary.averageMaxDepth, "m", 1)} de profondeur max moyenne quand elle est renseignée.`
                              : "Profondeur maximale moyenne non renseignée sur cette sélection."}
                        </small>
                      </article>
                    </div>

                    {activeEpci && comparisonEpci && filteredComparableProfileComparisonRows.length > 0 ? (
                      <div className="table-scroll">
                        <table className="raw-table">
                          <thead>
                            <tr>
                              <th>Profil détaillé</th>
                              <th>{activeEpci.epci_nom} équipements</th>
                              <th>{activeEpci.epci_nom} installations</th>
                              <th>{comparisonEpci.epci_nom} équipements</th>
                              <th>{comparisonEpci.epci_nom} installations</th>
                              <th>Écart équipements</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredComparableProfileComparisonRows.map((item) => (
                              <tr key={item.label}>
                                <td>{item.label}</td>
                                <td>{`${formatInteger(item.primaryEquipmentCount)} (${formatPercent(item.primaryEquipmentShare)})`}</td>
                                <td>{`${formatInteger(item.primaryInstallationCount)} (${formatPercent(item.primaryInstallationShare)})`}</td>
                                <td>{`${formatInteger(item.comparisonEquipmentCount)} (${formatPercent(item.comparisonEquipmentShare)})`}</td>
                                <td>{`${formatInteger(item.comparisonInstallationCount)} (${formatPercent(item.comparisonInstallationShare)})`}</td>
                                <td>{`${getDeltaArrow(item.deltaEquipmentCount)} ${formatSignedInteger(item.deltaEquipmentCount)}`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : filteredComparableProfileRows.length > 0 ? (
                      <div className="table-scroll">
                        <table className="raw-table">
                          <thead>
                            <tr>
                              <th>Profil détaillé</th>
                              <th>Équipements</th>
                              <th>Installations</th>
                              <th>Part équipements</th>
                              <th>Part installations</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredComparableProfileRows.map((item) => (
                              <tr key={item.label}>
                                <td>{item.label}</td>
                                <td>{formatInteger(item.equipmentCount)}</td>
                                <td>{formatInteger(item.installationCount)}</td>
                                <td>{formatPercent(item.equipmentShare)}</td>
                                <td>{formatPercent(item.installationShare)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    <div className="territory-comparable-list-grid">
                      <div className="territory-comparable-list">
                        <h4>{activeEpci?.epci_nom ?? territoryName}</h4>
                        <p className="subtle-empty">
                          Liste détaillée des équipements correspondant au filtre sélectionné.
                        </p>
                        <div className="table-scroll comparable-list-scroll">
                          <table className="raw-table">
                            <thead>
                              <tr>
                                <th>Équipement</th>
                                <th>Profil</th>
                                <th>Commune</th>
                                <th>Caractéristiques</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredComparableTerritoryListRows.map((item) => (
                                <tr key={item.id}>
                                  <td>
                                    <strong>{item.equipement}</strong>
                                    <div>{item.installation}</div>
                                  </td>
                                  <td>{item.profile}</td>
                                  <td>{item.commune}</td>
                                  <td>{item.metricsLabel}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {comparisonEpci ? (
                        <div className="territory-comparable-list">
                          <h4>{comparisonEpci.epci_nom}</h4>
                          <p className="subtle-empty">
                            Lecture symétrique pour vérifier que la comparaison porte sur les mêmes formats.
                          </p>
                          <div className="table-scroll comparable-list-scroll">
                            <table className="raw-table">
                              <thead>
                                <tr>
                                  <th>Équipement</th>
                                  <th>Profil</th>
                                  <th>Commune</th>
                                  <th>Caractéristiques</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredComparableComparisonListRows.map((item) => (
                                  <tr key={item.id}>
                                    <td>
                                      <strong>{item.equipement}</strong>
                                      <div>{item.installation}</div>
                                    </td>
                                    <td>{item.profile}</td>
                                    <td>{item.commune}</td>
                                    <td>{item.metricsLabel}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="subtle-empty">
                    Aucun bassin n'est disponible pour cette famille comparable sur le territoire actif.
                  </p>
                )}
              </div>
              ) : null}

              {territoriesView === "comparisons" && selectedEpciCode !== "all" ? (
              <div className="territory-card">
                <h3>Couverture selon la typologie des communes</h3>
                {territoryTypologyRows.length > 0 ? (
                  <div className="table-scroll">
                    <table className="raw-table">
                      <thead>
                        <tr>
                          <th>Typologie</th>
                          <th>Communes</th>
                          <th>Licences 2023</th>
                          <th>Bassins</th>
                          <th>Bassins / 100 000 hab.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {territoryTypologyRows.map((item) => (
                          <tr key={item.label}>
                            <td>{item.label}</td>
                            <td>{formatInteger(item.communes)}</td>
                            <td>{formatInteger(item.licences)}</td>
                            <td>{formatInteger(item.bassins)}</td>
                            <td>{formatNumber(item.bassinsPer100kHab, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="subtle-empty">
                    Aucune lecture par typologie communale n'est disponible sur le territoire actif.
                  </p>
                )}
              </div>
              ) : null}

              {territoriesView === "comparisons" && selectedEpciCode !== "all" ? (
              <div className="territory-card">
                <h3>Activités aquatiques présentes</h3>
                {activeEpci && comparisonEpci && countedTerritoryActivityComparisonRows.length > 0 ? (
                  <div className="table-scroll">
                    <table className="raw-table">
                      <thead>
                        <tr>
                          <th>Activité</th>
                          <th>{activeEpci.epci_nom}</th>
                          <th>{comparisonEpci.epci_nom}</th>
                          <th>Écart</th>
                        </tr>
                      </thead>
                      <tbody>
                        {countedTerritoryActivityComparisonRows.slice(0, 10).map((item) => (
                          <tr key={item.label}>
                            <td>{item.label}</td>
                            <td>{`${formatInteger(item.primaryCount)} (${formatPercent(item.primaryShare)})`}</td>
                            <td>{`${formatInteger(item.comparisonCount)} (${formatPercent(item.comparisonShare)})`}</td>
                            <td>{`${getDeltaArrow(item.deltaCount)} ${formatSignedInteger(item.deltaCount)}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : countedTerritoryActivityRows.length > 0 ? (
                  <div className="mini-table compact-mini-table">
                    <div className="mini-table-head">
                      <span>Activité</span>
                      <span>{inventoryCountMode === "equipments" ? "Équipements" : "Installations"}</span>
                      <span>Part</span>
                    </div>
                    {countedTerritoryActivityRows.slice(0, 10).map((item) => (
                      <div key={item.name} className="mini-table-row">
                        <span>{item.name}</span>
                        <span>{formatInteger(item.value)}</span>
                        <span>{formatPercent(item.share)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-empty">
                    Aucune activité n'est disponible pour construire une lecture territoriale sur le périmètre actif.
                  </p>
                )}
              </div>
              ) : null}

              {territoriesView === "territory" ? (
              <div className="territory-card">
                <h3>Pourquoi ce territoire remonte ?</h3>
                {activeTerritoryInvestigation ? (
                  <div className="territory-investigation">
                    <InvestigationScoreBreakdown
                      item={activeTerritoryInvestigation}
                      rankMaps={investigationRankMaps}
                      total={investigationRows.length}
                    />
                    <p className="territory-investigation-copy">{activeTerritoryInvestigation.hypothesis}</p>
                    <div className="reason-list">
                      {activeTerritoryInvestigation.priorityDrivers.map((reason) => (
                        <span key={reason} className="reason-item">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="subtle-empty">
                    Sélectionne un EPCI dans la table d'investigation pour lire les raisons de sa
                    remontée et ses signaux de tension.
                  </p>
                )}
              </div>
              ) : null}

              {territoriesView === "territory" ? (
              <div className="territory-card">
                <h3>Mix de gestion local</h3>
                {territoryManagementBreakdown.length > 0 ? (
                  <div className="fact-list">
                    {territoryManagementBreakdown.map((item) => (
                      <div key={item.name} className="fact-item fact-item-color">
                        <div className="fact-label-with-dot">
                          <span className="legend-swatch" style={{ backgroundColor: item.color }} />
                          <div>
                            <span>{item.name}</span>
                            <small>{formatPercent(safeDivide(item.value, territoryBasins.length))} du parc local</small>
                          </div>
                        </div>
                        <strong>{formatInteger(item.value)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-empty">Aucun bassin recensé sur le territoire sélectionné.</p>
                )}
              </div>
              ) : null}

              {territoriesView === "territory" ? (
              <div className="territory-card">
                <h3>Communes motrices</h3>
                {territoryTopCommunes.length > 0 ? (
                  <div className="mini-table compact-mini-table">
                    <div className="mini-table-head">
                      <span>Commune</span>
                      <span>Licences 2023</span>
                      <span>Licences / 1 000 hab.</span>
                    </div>
                    {territoryTopCommunes.map((item) => (
                      <div key={item.code_commune} className="mini-table-row">
                        <span>
                          <strong>{item.commune}</strong>
                          <small>{formatCommuneTypology(item.typo)}</small>
                        </span>
                        <span>{formatInteger(item.licences_ffn_2023)}</span>
                        <span>{formatNumber(item.licences_ffn_pour_1000hab, 2)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-empty">Aucune commune licenciée n'est disponible avec la sélection actuelle.</p>
                )}
              </div>
              ) : null}
            </div>
          </section>
          ) : null}
        </>
      ) : null}

      {activeTab === "facilities" ? (
        <>
          <section className="panel workspace-nav-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Organisation</span>
                <h2>Choisir une lecture équipements</h2>
              </div>
              <p>
                L&apos;onglet est réparti en sous-vues pour éviter d&apos;empiler carte, périmètre, propriétés
                physiques et tableaux sur une seule page.
              </p>
            </div>
            <div className="chip-row workspace-nav-row" role="tablist" aria-label="Lecture équipements">
              {FACILITIES_VIEW_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="tab"
                  aria-selected={facilitiesView === option.key}
                  className={facilitiesView === option.key ? "chip active" : "chip"}
                  onClick={() => setFacilitiesView(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="chart-note">{activeFacilitiesView.description}</p>
          </section>

          {facilitiesView === "sheet" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel table-panel territory-card-wide">
            <div className="territory-header">
              <div>
                <span className="eyebrow">Fiche équipement</span>
                <h2>{selectedFacilityBasin ? selectedFacilityBasin.equipement : "Choisir un équipement"}</h2>
                <p>
                  Lecture fine d'un bassin: dimensions, exploitation, contexte scolaire et composition du
                  site qui l'accueille.
                </p>
              </div>

              <div className="panel-heading-actions facility-sheet-actions">
                <div className="compact-control territory-selector">
                  <label htmlFor="facility-sheet-select">Équipement</label>
                  <select
                    id="facility-sheet-select"
                    value={selectedFacilityBasin?.id_equipement ?? ""}
                    onChange={(event) => setSelectedFacilityEquipmentId(event.target.value)}
                    disabled={facilitySheetOptions.length === 0}
                  >
                    {facilitySheetOptions.length === 0 ? (
                      <option value="">Aucun équipement visible</option>
                    ) : null}
                    {facilitySheetOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedFacilityBasin?.epci_code ? (
                  <button
                    type="button"
                    className="rank-limit-button facility-sheet-button"
                    onClick={() => openTerritoryCard(selectedFacilityBasin.epci_code)}
                  >
                    Ouvrir la fiche territoire
                  </button>
                ) : null}
              </div>
            </div>

            {selectedFacilityBasin ? (
              <>
                <div className="investigation-summary">
                  <article className="summary-chip">
                    <span className="summary-chip-label">Installation</span>
                    <strong>{selectedFacilityBasin.installation}</strong>
                    <small>{facilitySheetOptions.find((item) => item.id === selectedFacilityBasin.id_equipement)?.meta}</small>
                  </article>
                  <article className="summary-chip">
                    <span className="summary-chip-label">Profil comparable</span>
                    <strong>{getDetailedComparableBasinProfile(selectedFacilityBasin)}</strong>
                    <small>{formatComparableBasinMetrics(selectedFacilityBasin)}</small>
                  </article>
                  <article className="summary-chip">
                    <span className="summary-chip-label">Site Data ES</span>
                    <strong>{formatInteger(selectedFacilitySiteSummary.equipmentsTotal)} équipements</strong>
                    <small>
                      {formatInteger(selectedFacilitySiteSummary.familiesTotal)} familles et{" "}
                      {formatInteger(selectedFacilitySiteSummary.activitiesTotal)} activités recensées.
                    </small>
                  </article>
                  <article className="summary-chip">
                    <span className="summary-chip-label">Mise en service</span>
                    <strong>
                      {selectedFacilityOperational?.year_service
                        ? formatYear(selectedFacilityOperational.year_service)
                        : "n.c."}
                    </strong>
                    <small>Repère d'ancienneté au niveau équipement.</small>
                  </article>
                  <article className="summary-chip">
                    <span className="summary-chip-label">Pairs comparables</span>
                    <strong>{formatInteger(selectedFacilityComparablePeers.length)}</strong>
                    <small>Dans le parc filtré actuel, hors équipement sélectionné.</small>
                  </article>
                </div>

                <p className="chart-note">
                  La fiche suit le périmètre départemental et les filtres actifs. La composition du site
                  reste lue à l'échelle de l'installation pour ne pas masquer les équipements voisins.
                </p>

                <div className="signal-pill-row facility-sheet-badges" aria-label="Repères rapides équipement">
                  {selectedFacilitySignalPills.map((item, index) => (
                    <span key={`${item.label}-${index}`} className={item.className}>
                      {item.label}
                    </span>
                  ))}
                </div>

                <div className="facility-sheet-message-grid">
                  {selectedFacilityReadingMessages.map((item) => (
                    <article key={item.label} className="message-item">
                      <strong>{item.label}</strong>
                      <div>
                        <span>{item.title}</span>
                        <small>{item.detail}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="subtle-empty">Aucun équipement n'est disponible avec les filtres actifs.</p>
            )}
          </article>

          {selectedFacilityBasin ? (
            <>
              <article className="territory-card territory-card-wide facility-sheet-section-card">
                <span className="eyebrow">Détail</span>
                <h3>Lire l'équipement sous quatre angles</h3>
                <p>
                  Identité territoriale, dimensions, exploitation et composition du site sont séparées pour
                  éviter l'effet bloc et faciliter le repérage.
                </p>
              </article>

              <article className="territory-card">
                <h3>Identité et territoire</h3>
                <div className="fact-list">
                  {selectedFacilityIdentityFacts.map((fact) => (
                    <div key={fact.label} className="fact-item">
                      <div>
                        <span>{fact.label}</span>
                        <small>{fact.detail}</small>
                      </div>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="territory-card">
                <h3>Dimensions et profil</h3>
                <div className="fact-list">
                  {selectedFacilityDimensionFacts.map((fact) => (
                    <div key={fact.label} className="fact-item">
                      <div>
                        <span>{fact.label}</span>
                        <small>{fact.detail}</small>
                      </div>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="territory-card">
                <h3>Exploitation et accueil</h3>
                <div className="fact-list">
                  {selectedFacilityOperationalFacts.map((fact) => (
                    <div key={fact.label} className="fact-item">
                      <div>
                        <span>{fact.label}</span>
                        <small>{fact.detail}</small>
                      </div>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="territory-card">
                <h3>Pression scolaire rattachée</h3>
                {selectedFacilitySchoolDriveFacts.length > 0 ? (
                  <div className="fact-list">
                    {selectedFacilitySchoolDriveFacts.map((fact) => (
                      <div key={fact.label} className="fact-item">
                        <div>
                          <span>{fact.label}</span>
                          <small>{fact.detail}</small>
                        </div>
                        <strong>{fact.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-empty">Aucun rattachement scolaire n'est disponible pour ce site.</p>
                )}
              </article>

              <article className="territory-card">
                <h3>Offre TC potentielle</h3>
                {selectedFacilityTransitFacts.length > 0 ? (
                  <div className="fact-list">
                    {selectedFacilityTransitFacts.map((fact) => (
                      <div key={fact.label} className="fact-item">
                        <div>
                          <span>{fact.label}</span>
                          <small>{fact.detail}</small>
                        </div>
                        <strong>{fact.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="subtle-empty">Aucun repère GTFS n'est disponible pour ce site.</p>
                )}
              </article>

              <article className="territory-card">
                <h3>Ce que contient le site</h3>
                <div className="fact-list">
                  <div className="fact-item">
                    <div>
                      <span>Équipements bassins</span>
                      <small>Lecture du site au sens Data ES, pas seulement du bassin sélectionné.</small>
                    </div>
                    <strong>{formatInteger(selectedFacilitySiteSummary.bassinFamilyEquipmentsTotal)}</strong>
                  </div>
                  <div className="fact-item">
                    <div>
                      <span>Équipements hors bassin</span>
                      <small>Permet de voir si le site combine d'autres composantes aquatiques.</small>
                    </div>
                    <strong>{formatInteger(selectedFacilitySiteSummary.nonBassinFamilyEquipmentsTotal)}</strong>
                  </div>
                  <div className="fact-item">
                    <div>
                      <span>Familles présentes</span>
                      <small>Diversité interne du site observé.</small>
                    </div>
                    <strong>{formatInteger(selectedFacilitySiteSummary.familiesTotal)}</strong>
                  </div>
                  <div className="fact-item">
                    <div>
                      <span>Activités recensées</span>
                      <small>Lecture par pratiques déclarées dans Data ES.</small>
                    </div>
                    <strong>{formatInteger(selectedFacilitySiteSummary.activitiesTotal)}</strong>
                  </div>
                </div>
              </article>

              <article className="panel table-panel territory-card-wide">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Composition du site</span>
                    <h2>Équipements recensés dans l'installation</h2>
                  </div>
                  <p>
                    Cette table remet le bassin sélectionné dans son installation pour comprendre ce que le
                    site propose vraiment.
                  </p>
                </div>

                {selectedFacilitySiteRows.length > 0 ? (
                  <div className="table-scroll">
                    <table className="raw-table">
                      <thead>
                        <tr>
                          <th>Équipement</th>
                          <th>Famille</th>
                          <th>Type</th>
                          <th>Dimensions</th>
                          <th>Activités</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedFacilitySiteRows.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.equipement}</strong>
                            </td>
                            <td>{item.family}</td>
                            <td>{item.type}</td>
                            <td>{item.dimensions}</td>
                            <td>{item.activities}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="subtle-empty">Aucune ligne d'installation n'est disponible pour cet équipement.</p>
                )}

                <div className="territory-detail-grid">
                  <div className="breakdown-section">
                    <h3>Familles présentes</h3>
                    <BreakdownTable
                      rows={selectedFacilityFamilyRows}
                      labelHeader="Famille"
                      countHeader="Équipements"
                      emptyMessage="Aucune famille n'est disponible pour ce site."
                    />
                  </div>
                  <div className="breakdown-section">
                    <h3>Activités du site</h3>
                    <BreakdownTable
                      rows={selectedFacilityActivityRows}
                      labelHeader="Activité"
                      countHeader="Équipements"
                      emptyMessage="Aucune activité n'est disponible pour ce site."
                    />
                  </div>
                </div>
              </article>

              <article className="panel table-panel territory-card-wide">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Scolaire</span>
                    <h2>Établissements rattachés à ce site</h2>
                  </div>
                  <p>
                    Le rattachement suit l'installation aquatique la plus proche dans le socle bassin retenu.
                  </p>
                </div>

                {selectedFacilityAssignedSchools.length > 0 ? (
                  <div className="table-scroll">
                    <table className="raw-table">
                      <thead>
                        <tr>
                          <th>Établissement</th>
                          <th>Niveau</th>
                          <th>Commune</th>
                          <th>Élèves</th>
                          <th>Temps voiture</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedFacilityAssignedSchools.map((item) => (
                          <tr key={item.uai}>
                            <td>
                              <strong>{item.schoolName}</strong>
                            </td>
                            <td>{item.schoolLevel}</td>
                            <td>{item.commune}</td>
                            <td>{formatInteger(item.studentsTotal)}</td>
                            <td>
                              {formatMinutes(item.driveTimeToInstallationMin)}
                              {item.driveDistanceToInstallationKm !== null ? (
                                <div>{formatKilometers(item.driveDistanceToInstallationKm)}</div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="subtle-empty">
                    Aucun établissement géolocalisé n'est rattaché à cette installation dans le périmètre actif.
                  </p>
                )}
              </article>

              <article className="panel table-panel territory-card-wide">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Comparables</span>
                    <h2>Bassins équivalents dans le parc filtré</h2>
                  </div>
                  <p>
                    La comparaison reste volontairement serrée : même profil comparable, puis lecture des
                    dimensions et du contexte territorial.
                  </p>
                </div>

                {selectedFacilityComparablePeers.length > 0 ? (
                  <div className="table-scroll">
                    <table className="raw-table">
                      <thead>
                        <tr>
                          <th>Équipement</th>
                          <th>Installation</th>
                          <th>Commune</th>
                          <th>Profil</th>
                          <th>Dimensions</th>
                          <th>Gestion</th>
                          <th>Fiche</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedFacilityComparablePeers.map((item) => (
                          <tr key={item.id_equipement}>
                            <td>
                              <strong>{item.equipement}</strong>
                            </td>
                            <td>{item.installation}</td>
                            <td>{item.commune}</td>
                            <td>{getDetailedComparableBasinProfile(item)}</td>
                            <td>{formatComparableBasinMetrics(item)}</td>
                            <td>{item.mode_gestion_calcule}</td>
                            <td>
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => openFacilitySheet(item.id_equipement)}
                              >
                                Voir cet équipement
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="subtle-empty">
                    Aucun autre bassin comparable n'est visible avec les filtres actifs. Élargis les
                    filtres pour ouvrir la comparaison.
                  </p>
                )}

                <div className="breakdown-section">
                    <h3>Types recensés dans l'installation</h3>
                  <BreakdownTable
                    rows={selectedFacilityTypeRows}
                    labelHeader="Type"
                    countHeader="Équipements"
                    emptyMessage="Aucun type d'équipement n'est disponible pour ce site."
                  />
                </div>
              </article>
            </>
          ) : null}
        </section>
          ) : null}

          {facilitiesView === "map" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel map-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Cartographie équipements</span>
                <h2>Localisation des équipements aquatiques</h2>
              </div>
              <p>
                {formatInteger(mapDisplayPoints.length)} repères visibles à ce zoom pour{" "}
                {formatInteger(mapSourcePoints.length)} {mapPointLabel} après filtres.
              </p>
            </div>

            <div className="panel-heading-actions">
              <div className="compact-control compact-control-wide">
                <label htmlFor="basin-search">Recherche équipement</label>
                <input
                  id="basin-search"
                  type="search"
                  placeholder="Commune, installation, équipement..."
                  value={basinSearch}
                  onChange={(event) => setBasinSearch(event.target.value)}
                />
                {mapSearchSuggestions.length > 0 ? (
                  <div className="map-search-suggestions" role="listbox" aria-label="Suggestions cartographiques">
                    {mapSearchSuggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="map-search-suggestion"
                        onClick={() => applyMapSearchSuggestion(item)}
                      >
                        <span className="map-search-suggestion-copy">
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <span className="map-search-suggestion-kind">
                          {item.kind === "commune" ? "Commune" : "Site"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

            </div>

            <p className="chart-note">
              Le mode de comptage agit aussi sur la carte : lecture par équipement ou par installation.
              Les repères se regroupent automatiquement aux petits zooms. Les projets en cours
              restent lus comme une surcouche distincte.
            </p>

            <div className="map-summary-grid">
              <article className="map-summary-card">
                <span className="map-summary-label">Maille affichée</span>
                <strong>{inventoryCountMode === "equipments" ? "Équipements" : "Installations"}</strong>
                <small>{formatInteger(mapSourcePoints.length)} éléments après filtres.</small>
              </article>
              <article className="map-summary-card">
                <span className="map-summary-label">Repères à ce zoom</span>
                <strong>{formatInteger(mapDisplayPoints.length)}</strong>
                <small>
                  {formatInteger(mapDisplaySummary.individualCount)} repères directs
                  {mapDisplaySummary.clusterCount > 0
                    ? ` · ${formatInteger(mapDisplaySummary.clusterCount)} regroupements`
                    : ""}
                </small>
              </article>
              <article className="map-summary-card">
                <span className="map-summary-label">Fermés / travaux</span>
                <strong>{formatInteger(mapDisplaySummary.closedCount)}</strong>
                <small>Lecture consolidée sur le périmètre visible.</small>
              </article>
              <article className="map-summary-card">
                <span className="map-summary-label">À vérifier</span>
                <strong>{formatInteger(mapDisplaySummary.verifyCount)}</strong>
                <small>Cas à confirmer avant diffusion locale.</small>
              </article>
              <article className="map-summary-card">
                <span className="map-summary-label">Projets en cours</span>
                <strong>{formatInteger(geolocatedProjects.length)}</strong>
                <small>
                  {showProjectMarkers
                    ? "Rep\u00e8res affich\u00e9s sur la carte."
                    : "Surcouche masqu\u00e9e."}
                </small>
              </article>
            </div>

            <div className="chip-row">
              <button
                type="button"
                className={managementFilter === "all" ? "chip active" : "chip"}
                onClick={() => setManagementFilter("all")}
              >
                Toutes gestions
              </button>
              {mapManagementFilterOptions.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={managementFilter === mode ? "chip active" : "chip"}
                  onClick={() => setManagementFilter(mode)}
                >
                  {mode}
                </button>
              ))}
              <button
                type="button"
                className={basinUsageFilter === "school" ? "chip active" : "chip"}
                onClick={() => setBasinUsageFilter((current) => (current === "school" ? "all" : "school"))}
              >
                Usage scolaires
              </button>
              <button
                type="button"
                className={basinUsageFilter === "qpv" ? "chip active" : "chip"}
                onClick={() => setBasinUsageFilter((current) => (current === "qpv" ? "all" : "qpv"))}
              >
                QPV ou 200 m
              </button>
              {FACILITY_OPERATIONAL_STATUS_FILTER_OPTIONS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={operationalStatusFilter === item.key ? "chip active" : "chip"}
                  onClick={() => setOperationalStatusFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className={isMapFilterPanelOpen ? "map-layout" : "map-layout map-layout-collapsed"}>
              <aside
                className={
                  isMapFilterPanelOpen ? "map-filter-panel" : "map-filter-panel map-filter-panel-collapsed"
                }
              >
                {isMapFilterPanelOpen ? (
                  <>
                    <div className="map-filter-panel-header">
                      <div>
                        <span className="eyebrow">Filtres carte</span>
                        <h3>Lecture rapide</h3>
                        <p>Réglages visuels dédiés à la carte et à son aperçu local.</p>
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setIsMapFilterPanelOpen(false)}
                      >
                        Replier
                      </button>
                    </div>

                    <div className="sheet-chip-row map-filter-pill-row">
                      {mapPanelFilterPills.map((pill) => (
                        <span key={pill} className="sheet-chip">
                          {pill}
                        </span>
                      ))}
                    </div>

                    <div className="map-filter-section">
                      <span className="map-filter-section-label">Maille</span>
                      <div className="chip-row compact-chip-row">
                        <button
                          type="button"
                          className={inventoryCountMode === "installations" ? "chip active" : "chip"}
                          onClick={() => setInventoryCountMode("installations")}
                        >
                          Installations
                        </button>
                        <button
                          type="button"
                          className={inventoryCountMode === "equipments" ? "chip active" : "chip"}
                          onClick={() => setInventoryCountMode("equipments")}
                        >
                          Équipements
                        </button>
                      </div>
                    </div>

                    <div className="map-filter-section">
                      <span className="map-filter-section-label">Typologie</span>
                      <div className="compact-control">
                        <select
                          id="map-locality-type-filter"
                          value={localityTypeFilter}
                          onChange={(event) => setLocalityTypeFilter(event.target.value)}
                        >
                          <option value="all">Toutes typologies</option>
                          {availableLocalityTypes.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="map-filter-section">
                      <span className="map-filter-section-label">Projets en cours</span>
                      <div className="chip-row compact-chip-row">
                        <button
                          type="button"
                          className={showProjectMarkers ? "chip active" : "chip"}
                          onClick={() => setShowProjectMarkers(true)}
                        >
                          {"Affich\u00e9s"}
                        </button>
                        <button
                          type="button"
                          className={!showProjectMarkers ? "chip active" : "chip"}
                          onClick={() => setShowProjectMarkers(false)}
                        >
                          {"Masqu\u00e9s"}
                        </button>
                      </div>
                      <small className="chart-note">
                        {formatInteger(geolocatedProjects.length)} projets ont un repère cartographique exploitable.
                      </small>
                    </div>

                    <div className="map-filter-panel-footer">
                      <span>{formatInteger(mapSourcePoints.length)} éléments</span>
                      <button
                        type="button"
                        className="text-button"
                        onClick={resetFacilitiesFilters}
                        disabled={!hasFacilitiesFiltersActive}
                      >
                        Réinitialiser
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="map-filter-panel-toggle"
                    onClick={() => setIsMapFilterPanelOpen(true)}
                  >
                    <strong>Filtres</strong>
                    <small>{mapCustomFilterCount > 0 ? `${mapCustomFilterCount} actifs` : "Ouvrir"}</small>
                  </button>
                )}
              </aside>

              <div className="map-canvas-panel">

            <div className="map-inline-legend-stack" aria-label="Légende de la carte">
              <div className="map-inline-legend-group">
                <span className="map-inline-legend-label">Fond : gestion</span>
                <div className="map-inline-legend">
                  {MANAGEMENT_LEGEND_ITEMS.map(({ label, color }) => (
                    <span key={label} className="map-inline-legend-item">
                      <span className="map-inline-legend-swatch" style={{ backgroundColor: color }} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="map-inline-legend-group">
                <span className="map-inline-legend-label">Contour : statut</span>
                <div className="map-inline-legend">
                  {mapStatusLegendItems.map((item) => (
                    <span key={item.key} className="map-inline-legend-item">
                      <span
                        className="map-inline-legend-swatch map-inline-legend-swatch-outline"
                        style={{ borderColor: item.color }}
                      />
                      {item.label}
                      <strong className="map-inline-legend-count">{formatInteger(item.count)}</strong>
                    </span>
                  ))}
                </div>
              </div>
              {geolocatedProjects.length > 0 ? (
                <div className="map-inline-legend-group">
                  <span className="map-inline-legend-label">Repère complémentaire</span>
                  <div className="map-inline-legend">
                    <span className="map-inline-legend-item">
                      <span className="project-map-legend-swatch" />
                      Projet en cours
                      <strong className="map-inline-legend-count">{formatInteger(geolocatedProjects.length)}</strong>
                    </span>
                  </div>
                </div>
              ) : null}
              <span className="map-inline-legend-hint">Ctrl + molette ou pinch pour zoomer</span>
            </div>

            <div className="map-wrap">
              <MapContainer center={[50.35, 2.84]} zoom={8} scrollWheelZoom={false}>
                <MapZoomTracker onZoomChange={setFacilityMapZoom} />
                <MapAutoFocusController
                  points={mapSourcePoints}
                  searchTerm={deferredBasinSearch}
                  focusedPoint={selectedMapPoint}
                />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {mapDisplayPoints.map((item) =>
                  item.kind === "cluster" ? (
                    <FacilityMapClusterMarker key={item.id} cluster={item} />
                  ) : (
                    <CircleMarker
                      key={item.id}
                      center={[item.latitude, item.longitude]}
                      radius={inventoryCountMode === "installations" ? 5.8 : 4.5}
                      eventHandlers={{
                        click() {
                          setSelectedMapPointId(item.id);
                        },
                      }}
                      pathOptions={{
                        color: OPERATIONAL_STATUS_COLORS[item.operational_status_code] ?? "#666666",
                        weight: inventoryCountMode === "installations" ? 2.8 : 2.4,
                        fillColor: getManagementColor(item.managementLabel),
                        fillOpacity: 0.92,
                      }}
                    >
                      <Popup>
                        <div className="popup-card popup-card-map">
                          <div className="popup-card-header">
                            <strong>{item.installation}</strong>
                            <span
                              className={`status-pill status-pill-${item.operational_status_code.replace(/_/g, "-")}`}
                            >
                              {item.operational_status_label}
                            </span>
                          </div>
                          <div className="popup-card-meta">
                            <span>{item.commune}</span>
                            <span>{item.managementLabel}</span>
                          </div>
                          {item.displayMode === "equipments" ? (
                            <>
                              <div className="popup-card-primary">
                                <span>{item.equipment}</span>
                                <span>{item.typeLabel}</span>
                              </div>
                              <span className="popup-card-detail">
                                {item.surface_bassin_m2
                                  ? `${formatNumber(item.surface_bassin_m2, 0)} m²`
                                  : "Surface n.c."}
                              </span>
                            </>
                          ) : (
                            <span className="popup-card-detail">
                              {formatInteger(item.basinCount)} bassins · {formatInteger(item.equipmentCount)} équipements
                            </span>
                          )}
                          {(item.usage_scolaires === 1 || item.qpv_flag === 1 || item.qpv_200m_flag === 1) && (
                            <div className="popup-tags">
                              {item.usage_scolaires === 1 && (
                                <span className="popup-tag popup-tag-school">Scolaires</span>
                              )}
                              {item.qpv_flag === 1 && (
                                <span className="popup-tag popup-tag-qpv">En QPV</span>
                              )}
                              {item.qpv_flag !== 1 && item.qpv_200m_flag === 1 && (
                                <span className="popup-tag popup-tag-qpv">À 200 m QPV</span>
                              )}
                            </div>
                          )}
                          {item.equipmentId ? (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => openFacilitySheet(item.equipmentId)}
                            >
                              {item.displayMode === "installations"
                                ? "Ouvrir un équipement du site"
                                : "Ouvrir la fiche équipement"}
                            </button>
                          ) : null}
                        </div>
                      </Popup>
                    </CircleMarker>
                  ),
                )}
                {visibleProjectMarkers.map((project) => (
                  <Marker
                    key={project.project_id}
                    position={[project.latitude as number, project.longitude as number]}
                    icon={createProjectMarkerIcon(project.project_bucket_code)}
                    zIndexOffset={1200}
                  >
                    <Popup>
                      <div className="popup-card popup-card-map popup-card-project">
                        <div className="popup-card-header">
                          <strong>{project.project_name}</strong>
                          <span className={getProjectBucketPillClassName(project.project_bucket_code)}>
                            {project.project_bucket_label}
                          </span>
                        </div>
                        <div className="popup-card-meta">
                          <span>{project.communes_label}</span>
                          <span>{project.project_phase_label}</span>
                        </div>
                        {project.opening_label ? (
                          <span className="popup-card-detail">Horizon : {project.opening_label}</span>
                        ) : null}
                        {project.project_owner ? (
                          <span className="popup-card-detail">Maîtrise d’ouvrage : {project.project_owner}</span>
                        ) : null}
                        {project.budget_label ? (
                          <span className="popup-card-detail">Budget : {project.budget_label}</span>
                        ) : null}
                        {project.program_summary ? <p className="popup-card-note">{project.program_summary}</p> : null}
                        <div className="popup-tags">
                          <span className="project-phase-pill">{project.project_phase_label}</span>
                          <span className="popup-tag popup-tag-project">{project.location_precision_label}</span>
                        </div>
                        {project.public_status ? (
                          <p className="popup-card-note">
                            <strong>Statut public :</strong> {project.public_status}
                          </p>
                        ) : null}
                        <button type="button" className="text-button" onClick={() => openProjectsView(project.project_name)}>
                          Voir dans Projets en cours
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>

            {selectedMapPoint ? (
              <div className="map-mini-sheet" aria-live="polite">
                <div className="map-mini-sheet-header">
                  <div>
                    <span className="eyebrow">Aperçu cartographique</span>
                    <h3>
                      {selectedMapPoint.displayMode === "installations"
                        ? selectedMapPoint.installation
                        : selectedMapPoint.equipment ?? selectedMapPoint.installation}
                    </h3>
                    <p>
                      {selectedMapPoint.commune} · {shortDepartment(selectedMapPoint.departement)} ·{" "}
                      {selectedMapPoint.managementLabel}
                    </p>
                  </div>
                  <div className="map-mini-sheet-actions">
                    <span className={getOperationalStatusPillClassName(selectedMapPoint.operational_status_code)}>
                      {selectedMapPoint.operational_status_label}
                    </span>
                    {selectedMapPoint.equipmentId ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => openFacilitySheet(selectedMapPoint.equipmentId)}
                      >
                        {selectedMapPoint.displayMode === "installations"
                          ? "Ouvrir un équipement du site"
                          : "Ouvrir la fiche équipement"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="map-mini-sheet-grid">
                  <article className="map-mini-sheet-card">
                    <span className="map-mini-sheet-label">Maille</span>
                    <strong>{selectedMapPoint.displayMode === "installations" ? "Installation" : "Équipement"}</strong>
                    <small>
                      {formatInteger(selectedMapPoint.basinCount)} bassins ·{" "}
                      {formatInteger(selectedMapPoint.equipmentCount)} équipements
                    </small>
                  </article>
                  <article className="map-mini-sheet-card">
                    <span className="map-mini-sheet-label">Surface lue</span>
                    <strong>{formatOptionalMeasure(selectedMapPoint.surface_bassin_m2 ?? 0, "m²", 0)}</strong>
                    <small>
                      {selectedMapPoint.displayMode === "installations"
                        ? "Surface agrégée des bassins du site."
                        : "Surface du bassin sélectionné."}
                    </small>
                  </article>
                  <article className="map-mini-sheet-card">
                    <span className="map-mini-sheet-label">Contexte</span>
                    <strong>
                      {selectedMapPoint.usage_scolaires === 1
                        ? "Signal scolaire"
                        : selectedMapPoint.qpv_flag === 1 || selectedMapPoint.qpv_200m_flag === 1
                          ? "Proximité QPV"
                          : "Lecture standard"}
                    </strong>
                    <small>
                      {selectedMapPoint.qpv_flag === 1
                        ? "Le site est implanté en QPV."
                        : selectedMapPoint.qpv_200m_flag === 1
                          ? "Le site est situé à 200 m d'un QPV."
                          : "Pas de contrainte sociale immédiate détectée."}
                    </small>
                  </article>
                  <article className="map-mini-sheet-card">
                    <span className="map-mini-sheet-label">Source du statut</span>
                    <strong>{selectedMapPoint.status_source ?? "Lecture Data.Sports"}</strong>
                    <small>Le contour du repère reprend ce statut d'exploitation.</small>
                  </article>
                </div>

                <div className="signal-pill-row">
                  <span className="signal-pill">{selectedMapPoint.managementLabel}</span>
                  {selectedMapPoint.usage_scolaires === 1 ? <span className="signal-pill">Usage scolaire</span> : null}
                  {selectedMapPoint.qpv_flag === 1 ? <span className="signal-pill">En QPV</span> : null}
                  {selectedMapPoint.qpv_flag !== 1 && selectedMapPoint.qpv_200m_flag === 1 ? (
                    <span className="signal-pill">À 200 m QPV</span>
                  ) : null}
                </div>

                {selectedMapPoint.operational_status_reason ? (
                  <p className="map-mini-sheet-note">
                    <strong>Lecture du statut :</strong> {selectedMapPoint.operational_status_reason}
                  </p>
                ) : null}
              </div>
            ) : mapSourcePoints.length > 0 ? (
              <div className="map-mini-sheet map-mini-sheet-empty">
                <strong>Aperçu rapide</strong>
                <p>Clique sur un repère pour afficher un résumé du site directement sous la carte.</p>
              </div>
            ) : null}
              </div>
            </div>
          </article>

          <article className="panel chart-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Gestion des équipements</span>
                <h2>Lectures rapides du parc filtré</h2>
              </div>
              <p>
                Trois lectures complémentaires au même périmètre cartographique : gestion, statut
                d'exploitation et contexte d'usage.
              </p>
            </div>

            {managementBreakdown.length > 0 ? (
              <div className="map-dashboard-grid">
                <article className="map-dashboard-card">
                  <div className="map-dashboard-card-header">
                    <h3>Gestion</h3>
                    <p>Répartition administrative du parc visible.</p>
                  </div>
                  <div className="chart-wrap map-chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={managementBreakdown}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={56}
                          outerRadius={88}
                          paddingAngle={3}
                        >
                          {managementBreakdown.map((item) => (
                            <Cell key={item.name} fill={item.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="legend">
                    {managementBreakdown.map((item) => (
                      <div key={item.name} className="legend-item">
                        <span className="legend-swatch" style={{ backgroundColor: item.color }} />
                        <span>{item.name}</span>
                        <strong>{formatInteger(item.value)}</strong>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="map-dashboard-card">
                  <div className="map-dashboard-card-header">
                    <h3>Statut d'exploitation</h3>
                    <p>Lecture rapide des ouvertures, travaux et fermetures.</p>
                  </div>
                  <div className="chart-wrap map-chart-wrap-compact">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mapStatusBreakdown} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#d6d6d6" />
                        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={132} tick={{ fontSize: 12 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name={inventoryCountMode === "equipments" ? "Équipements" : "Installations"} radius={[0, 10, 10, 0]}>
                          {mapStatusBreakdown.map((item) => (
                            <Cell key={item.name} fill={item.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>

                <article className="map-dashboard-card">
                  <div className="map-dashboard-card-header">
                    <h3>Contexte des sites</h3>
                    <p>Présence scolaire et proximité sociale dans le parc filtré.</p>
                  </div>
                  <div className="chart-wrap map-chart-wrap-compact">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mapContextBreakdown} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#d6d6d6" />
                        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={118} tick={{ fontSize: 12 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name={inventoryCountMode === "equipments" ? "Équipements" : "Installations"} radius={[0, 10, 10, 0]}>
                          {mapContextBreakdown.map((item) => (
                            <Cell key={item.name} fill={item.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>
              </div>
            ) : (
              <p className="subtle-empty">Aucun équipement ne correspond aux filtres actuels.</p>
            )}
          </article>

        </section>
          ) : null}

          {facilitiesView === "projects" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel table-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Veille projets</span>
                <h2>Projets aquatiques en cours</h2>
              </div>
              <p>
                Tous les projets répertoriés dans le rapport sont repris ici, en distinguant
                constructions neuves, réhabilitations lourdes et dossiers encore incertains.
              </p>
            </div>

            <div className="panel-heading-actions">
              <div className="compact-control compact-control-wide">
                <label htmlFor="project-search">Recherche projet</label>
                <input
                  id="project-search"
                  type="search"
                  placeholder="Commune, projet, maître d’ouvrage..."
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                />
              </div>
            </div>

            <div className="investigation-summary">
              {projectSummaryCards.map((item) => (
                <article key={item.label} className="summary-chip">
                  <span className="summary-chip-label">{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </article>
              ))}
            </div>

            <p className="chart-note">
              Le repère cartographique est posé au centre communal de référence quand l’emprise
              exacte du projet n’est pas publiée. La carte distingue donc un signal de projet, pas
              une implantation juridique opposable.
            </p>
          </article>

          <article className="panel chart-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Lectures rapides</span>
                <h2>Répartition des projets suivis</h2>
              </div>
              <p>
                Triple lecture du portefeuille suivi : nature, phase d’avancement et horizon
                d’ouverture ou de réouverture.
              </p>
            </div>

            {filteredProjects.length > 0 ? (
              <div className="map-dashboard-grid">
                <article className="map-dashboard-card">
                  <div className="map-dashboard-card-header">
                    <h3>Nature des opérations</h3>
                    <p>Constructions neuves, réhabilitations lourdes et cas très incertains.</p>
                  </div>
                  <div className="chart-wrap map-chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={projectBucketBreakdown}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={56}
                          outerRadius={88}
                          paddingAngle={3}
                        >
                          {projectBucketBreakdown.map((item) => (
                            <Cell key={item.name} fill={item.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="legend">
                    {projectBucketBreakdown.map((item) => (
                      <div key={item.name} className="legend-item">
                        <span className="legend-swatch" style={{ backgroundColor: item.color }} />
                        <span>{item.name}</span>
                        <strong>{formatInteger(item.value)}</strong>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="map-dashboard-card">
                  <div className="map-dashboard-card-header">
                    <h3>Phase d’avancement</h3>
                    <p>Chantiers, programmation, procédures et dossiers encore fragiles.</p>
                  </div>
                  <div className="chart-wrap map-chart-wrap-compact">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={projectPhaseBreakdown} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#d6d6d6" />
                        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={136} tick={{ fontSize: 12 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name="Projets" radius={[0, 10, 10, 0]}>
                          {projectPhaseBreakdown.map((item) => (
                            <Cell key={item.name} fill={item.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>

                <article className="map-dashboard-card">
                  <div className="map-dashboard-card-header">
                    <h3>Horizon de mise en service</h3>
                    <p>Lecture pratique des échéances proches, intermédiaires et lointaines.</p>
                  </div>
                  <div className="chart-wrap map-chart-wrap-compact">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={projectHorizonBreakdown} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#d6d6d6" />
                        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={126} tick={{ fontSize: 12 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="value" name="Projets" radius={[0, 10, 10, 0]}>
                          {projectHorizonBreakdown.map((item) => (
                            <Cell key={item.name} fill={item.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </article>
              </div>
            ) : (
              <p className="subtle-empty">Aucun projet ne correspond au périmètre ou à la recherche active.</p>
            )}
          </article>

          <article className="panel table-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Liste complète</span>
                <h2>Table des projets suivis</h2>
              </div>
              <p>
                La lecture reprend le projet, son horizon, son statut public, le maître d’ouvrage
                et le programme tel qu’il ressort du rapport de veille.
              </p>
            </div>

            {filteredProjects.length > 0 ? (
              <div className="table-scroll">
                <table className="raw-table">
                  <thead>
                    <tr>
                      <th>Projet</th>
                      <th>Communes</th>
                      <th>Nature</th>
                      <th>Avancement</th>
                      <th>Horizon</th>
                      <th>Maîtrise d’ouvrage</th>
                      <th>Programme</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProjects.map((item) => (
                      <tr key={item.project_id}>
                        <td>
                          <strong>{item.project_name}</strong>
                          <div className="table-inline-pills">
                            <span className={getProjectBucketPillClassName(item.project_bucket_code)}>
                              {item.project_bucket_label}
                            </span>
                            <span className="project-phase-pill">{item.project_phase_label}</span>
                          </div>
                          {item.public_status ? <small className="table-subcopy">{item.public_status}</small> : null}
                        </td>
                        <td>
                          <strong>{item.communes_label}</strong>
                          <div>{item.departement ?? "Département n.c."}</div>
                          <small className="table-subcopy">{item.location_precision_label}</small>
                        </td>
                        <td>{item.project_nature_label ?? item.project_bucket_label}</td>
                        <td>{item.project_phase_label}</td>
                        <td>{item.opening_label ?? "Échéance non précisée"}</td>
                        <td>
                          <strong>{item.project_owner ?? "n.c."}</strong>
                          {item.budget_label ? <small className="table-subcopy">{item.budget_label}</small> : null}
                        </td>
                        <td>
                          <strong>{item.program_summary ?? "Programme non détaillé dans le rapport."}</strong>
                          {item.source_summary ? <small className="table-subcopy">{item.source_summary}</small> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="subtle-empty">Aucun projet ne correspond au périmètre ou à la recherche active.</p>
            )}
          </article>
        </section>
          ) : null}

          {facilitiesView === "scope" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel table-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Périmètre retenu</span>
                <h2>Socle bassins et lecture Data ES élargie</h2>
              </div>
              <p>
                Le socle historique reste centré sur la famille « Bassin de natation ». L'extraction
                complémentaire montre ce que les mêmes sites accueillent au-delà de ce seul périmètre.
              </p>
            </div>

            <div className="investigation-summary">
              <article className="summary-chip">
                <span className="summary-chip-label">Socle bassins</span>
                <strong>{formatInteger(comparableScopedBasins.length)}</strong>
                <small>Équipements de la famille bassin sur le champ courant.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Sites du socle</span>
                <strong>{formatInteger(comparableScopedInstallationCount)}</strong>
                <small>Installations couvertes par ce socle sur le même champ.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Extraction élargie</span>
                <strong>{formatInteger(filteredExtendedInventorySummary.equipmentsTotal)}</strong>
                <small>Équipements recensés sans se limiter à la seule famille bassin.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Sites de l'extraction</span>
                <strong>{formatInteger(filteredExtendedInventorySummary.installationsTotal)}</strong>
                <small>Sites distincts concernés par cette lecture complémentaire.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Écart équipements</span>
                <strong>
                  {formatSignedInteger(
                    filteredExtendedInventorySummary.equipmentsTotal - comparableScopedBasins.length,
                  )}
                </strong>
                <small>Le différentiel vient surtout de la diversification interne des sites.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Écart sites</span>
                <strong>
                  {formatSignedInteger(
                    filteredExtendedInventorySummary.installationsTotal - comparableScopedInstallationCount,
                  )}
                </strong>
                <small>La différence est faible au niveau site, plus forte au niveau équipement.</small>
              </article>
            </div>

            <div className="fact-list">
              <div className="fact-item">
                <div>
                  <span>Équipements hors bassin</span>
                  <small>Volume complémentaire apporté par l'extraction Data ES élargie.</small>
                </div>
                <strong>{formatInteger(filteredExtendedInventorySummary.nonBassinFamilyEquipmentsTotal)}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Sites avec hors bassin</span>
                  <small>Installations où l'offre ne se limite pas à des bassins de natation.</small>
                </div>
                <strong>{formatInteger(filteredExtendedInventorySummary.nonBassinFamilyInstallationsTotal)}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Familles distinctes</span>
                  <small>Lecture complète de la diversité d'équipements présents dans les sites piscine.</small>
                </div>
                <strong>{formatInteger(filteredExtendedInventorySummary.familiesTotal)}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Activités distinctes</span>
                  <small>Pratiques déclarées dans Data ES sur l'extraction élargie.</small>
                </div>
                <strong>{formatInteger(filteredExtendedInventorySummary.activitiesTotal)}</strong>
              </div>
            </div>

            <p className="chart-note">
              Cette comparaison suit le département, la typologie communale et la recherche libre. Les
              filtres de gestion et d'usage scolaires restent propres au socle bassins.
            </p>

            <div className="fact-list">
              <div className="fact-item">
                <div>
                  <span>Surface pour 1 000 hab.</span>
                  <small>Lecture agrégée sur le périmètre territorial actif.</small>
                </div>
                <strong>
                  {currentOverview
                    ? `${formatNumber(
                        safeDivide(currentOverview.surface_totale_bassins_m2, currentOverview.population_total) *
                          1000,
                        2,
                      )} m²`
                    : "n.c."}
                </strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Usages scolaires repérés</span>
                  <small>Signal large fondé sur le type d'utilisation.</small>
                </div>
                <strong>{formatInteger(schoolScopeGap.usageCount)}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Sites scolaires explicites</span>
                  <small>Signal beaucoup plus restrictif, fondé sur un marquage explicite.</small>
                </div>
                <strong>{formatInteger(schoolScopeGap.explicitCount)}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Écart de signalement scolaire</span>
                  <small>
                    {formatPercent(schoolScopeGap.explicitShare)} des usages scolaires seulement sont
                    explicites.
                  </small>
                </div>
                <strong>{formatInteger(schoolScopeGap.delta)}</strong>
              </div>
            </div>
            <p className="chart-note">
              Le socle bassin conserve bien les fosses à plongée et les équipements spécialisés
              aquatiques : {formatInteger(divingEquipmentCount)} fosses et {formatInteger(specializedEquipmentCount)}{" "}
              équipements spécialisés sur le périmètre bassin.
            </p>
          </article>
        </section>
          ) : null}

          {facilitiesView === "physical" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel chart-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Propriétés physiques</span>
                <h2>Tailles, longueurs et intensité du parc affiché</h2>
              </div>
              <p>
                Les dimensions sont lues sur les équipements filtrés pour relier volumes, usages et
                caractéristiques physiques.
              </p>
            </div>

            <div className="chart-wrap tall">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={surfaceDistribution} margin={{ top: 4, right: 10, bottom: 24, left: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#d6d6d6" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="value" fill="#000091" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="fact-list">
              <div className="fact-item">
                <div>
                  <span>Surface totale affichée</span>
                  <small>Somme des surfaces renseignées sur les équipements visibles.</small>
                </div>
                <strong>{`${formatNumber(physicalStats.totalSurface, 0)} m²`}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Surface moyenne</span>
                  <small>{formatPercent(physicalStats.surfaceCoverage)} des équipements ont une surface renseignée.</small>
                </div>
                <strong>{`${formatNumber(physicalStats.averageSurface, 0)} m²`}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Longueur moyenne</span>
                  <small>{formatPercent(physicalStats.lengthCoverage)} des équipements ont une longueur renseignée.</small>
                </div>
                <strong>{`${formatNumber(physicalStats.averageLength, 1)} m`}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Nombre moyen de couloirs</span>
                  <small>{formatPercent(physicalStats.lanesCoverage)} des équipements ont ce champ renseigné.</small>
                </div>
                <strong>{formatNumber(physicalStats.averageLanes, 1)}</strong>
              </div>
            </div>

            <div className="mini-table compact-mini-table">
              <div className="mini-table-head">
                <span>Format de longueur</span>
                <span>Équipements</span>
                <span>Part</span>
              </div>
              {lengthDistribution.map((item) => (
                <div key={item.label} className="mini-table-row">
                  <span>{item.label}</span>
                  <span>{formatInteger(item.value)}</span>
                  <span>{formatPercent(safeDivide(item.value, filteredBasins.length))}</span>
                </div>
              ))}
            </div>
          </article>
        </section>
          ) : null}

          {facilitiesView === "operations" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel table-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">État d'exploitation</span>
                <h2>Ancienneté, travaux et conditions d'ouverture</h2>
              </div>
              <p>
                Lecture construite sur le socle bassins filtré, enrichi par les champs d'exploitation déjà
                présents dans le brut Data ES.
              </p>
            </div>

            <div className="investigation-summary">
              <article className="summary-chip">
                <span className="summary-chip-label">Bassins enrichis</span>
                <strong>{formatInteger(operationalSummary.equipmentCount)}</strong>
                <small>{formatInteger(operationalSummary.installationCount)} installations sur la sélection active.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Mise en service moyenne</span>
                <strong>
                  {operationalSummary.averageServiceYear > 0
                    ? formatYear(operationalSummary.averageServiceYear)
                    : "n.c."}
                </strong>
                <small>{formatPercent(operationalSummary.yearCoverageShare)} du parc renseigne ce champ.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Parc antérieur à 2000</span>
                <strong>{formatPercent(operationalSummary.legacyShare)}</strong>
                <small>Part des bassins avec mise en service antérieure à 2000.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Travaux depuis 2015</span>
                <strong>{formatPercent(operationalSummary.recentWorksShare)}</strong>
                <small>Date ou période de gros travaux récente renseignée.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Accès transport</span>
                <strong>{formatPercent(operationalSummary.transportAccessShare)}</strong>
                <small>Modes de transport en commun déclarés.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Accessibilité renseignée</span>
                <strong>{formatPercent(operationalSummary.accessibilityShare)}</strong>
                <small>Handicap déclaré ou détail PMR / sensoriel disponible.</small>
              </article>
            </div>

            <div className="fact-list">
              <div className="fact-item">
                <div>
                  <span>Arrêté d'ouverture</span>
                  <small>Part du parc avec ouverture au public explicitement renseignée.</small>
                </div>
                <strong>{formatPercent(operationalSummary.openingAuthorizedShare)}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Ouverture saisonnière</span>
                  <small>Part des bassins ouverts exclusivement sur une période saisonnière.</small>
                </div>
                <strong>{formatPercent(operationalSummary.seasonalShare)}</strong>
              </div>
              <div className="fact-item">
                <div>
                  <span>Hors service</span>
                  <small>Installations signalées hors service dans le brut Data ES.</small>
                </div>
                <strong>{formatPercent(operationalSummary.outOfServiceShare)}</strong>
              </div>
            </div>

            <div className="breakdown-section">
              <h3>Statut d'exploitation des installations</h3>
              <div className="investigation-summary">
                <article className="summary-chip">
                  <span className="summary-chip-label">Ouvert probable</span>
                  <strong>{formatInteger(operationalStatusSummary.openProbable)}</strong>
                  <small>Sans signal de fermeture détecté dans Data ES.</small>
                </article>
                <article className="summary-chip">
                  <span className="summary-chip-label">Fermé temporairement</span>
                  <strong>{formatInteger(operationalStatusSummary.temporaryClosed)}</strong>
                  <small>Travaux ou fermeture temporaire repérés.</small>
                </article>
                <article className="summary-chip">
                  <span className="summary-chip-label">Fermé / hors service</span>
                  <strong>{formatInteger(operationalStatusSummary.closed)}</strong>
                  <small>Signal fort de fermeture ou hors service.</small>
                </article>
                <article className="summary-chip">
                  <span className="summary-chip-label">Saisonnier</span>
                  <strong>{formatInteger(operationalStatusSummary.seasonal)}</strong>
                  <small>Ouverture exclusivement saisonnière.</small>
                </article>
              <article className="summary-chip">
                <span className="summary-chip-label">À vérifier</span>
                <strong>{formatInteger(operationalStatusSummary.verify)}</strong>
                <small>Observation à confirmer localement.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Vérifiés manuellement</span>
                <strong>{formatInteger(operationalStatusSummary.verifiedManual)}</strong>
                <small>Statuts déjà contrôlés dans la surcouche locale.</small>
              </article>
            </div>

            <div className="table-scroll">
              <table className="raw-table">
                <thead>
                    <tr>
                      <th>Installation</th>
                      <th>Commune</th>
                      <th>Statut</th>
                      <th>Vérification</th>
                      <th>Confiance</th>
                      <th>Bassins</th>
                      <th>Source</th>
                      <th>Mise à jour</th>
                      <th>Repère</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInstallationStatusRows.map((row) => (
                      <tr key={row.id_installation}>
                        <td>
                          <strong>{row.installation ?? "Installation non renseignée"}</strong>
                          <br />
                          <small>{row.epci_nom ?? "EPCI non renseigné"}</small>
                        </td>
                        <td>
                          {row.commune ?? "n.c."}
                          <br />
                          <small>{row.departement ?? "n.c."}</small>
                        </td>
                        <td>
                          <span className={`status-pill status-pill-${row.operational_status_code.replace(/_/g, "-")}`}>
                            {row.operational_status_label}
                          </span>
                        </td>
                        <td>{getStatusVerificationLabel(row)}</td>
                        <td>{row.status_confidence ?? "n.c."}</td>
                        <td>{formatInteger(row.bassins_total)}</td>
                        <td>
                          {row.status_source ?? "Data ES calculé"}
                          {row.status_source_url ? (
                            <>
                              <br />
                              <a href={row.status_source_url} target="_blank" rel="noreferrer">
                                Ouvrir la source
                              </a>
                            </>
                          ) : null}
                        </td>
                        <td>{formatReviewDateLabel(formatOperationalStatusUpdate(row))}</td>
                        <td>
                          <span className="cell-text">
                            {row.operational_status_reason ?? row.status_override_comment ?? "Aucun détail disponible."}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredInstallationStatusRows.length === 0 ? (
                  <div className="empty-table">Aucune installation n'est disponible sur la sélection active.</div>
                ) : null}
              </div>
            </div>

            <div className="breakdown-section">
              <h3>File de contrôle prioritaire</h3>
              <div className="table-scroll">
                <table className="raw-table">
                  <thead>
                    <tr>
                      <th>Priorité</th>
                      <th>Installation</th>
                      <th>Statut</th>
                      <th>Pourquoi contrôler</th>
                      <th>Dernier repère</th>
                      <th>Recherche conseillée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStatusReviewQueueRows.slice(0, 30).map((row) => (
                      <tr key={`${row.id_installation}-${row.priority_score}`}>
                        <td>{row.priority_label}</td>
                        <td>
                          <strong>{row.installation ?? "Installation non renseignée"}</strong>
                          <br />
                          <small>
                            {row.commune ?? "n.c."} · {row.departement ?? "n.c."}
                          </small>
                        </td>
                        <td>{row.operational_status_label ?? "n.c."}</td>
                        <td>
                          <span className="cell-text">
                            {row.queue_reason ?? row.operational_status_reason ?? "Contrôle recommandé."}
                          </span>
                        </td>
                        <td>
                          {row.state_change_date_latest
                            ? formatReviewDateLabel(row.state_change_date_latest)
                            : row.survey_date_latest
                              ? formatReviewDateLabel(row.survey_date_latest)
                              : "n.c."}
                        </td>
                        <td>
                          <span className="cell-text">{row.search_hint ?? "n.c."}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredStatusReviewQueueRows.length === 0 ? (
                  <div className="empty-table">
                    Aucun contrôle prioritaire n'est remonté sur la sélection active.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="breakdown-section">
              <h3>Ancienneté du parc</h3>
              <BreakdownTable
                rows={serviceYearBreakdown}
                labelHeader="Période"
                countHeader={inventoryCountMode === "equipments" ? "Équipements" : "Installations"}
                emptyMessage="Aucune année de mise en service n'est disponible sur le parc filtré."
              />
            </div>

            <div className="breakdown-section">
              <h3>Énergies déclarées</h3>
              <BreakdownTable
                rows={energyBreakdown}
                labelHeader="Énergie"
                countHeader={inventoryCountMode === "equipments" ? "Équipements" : "Installations"}
                emptyMessage="Aucune source d'énergie n'est disponible sur la sélection active."
              />
            </div>
          </article>

          <article className="panel table-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Lecture scolaire</span>
                <h2>Conditions d'accueil scolaire du parc</h2>
              </div>
              <p>
                Faute d'effectifs élèves dans le dépôt actuel, cette vue qualifie les bassins à usage
                scolaire et les conditions matérielles qui les accompagnent.
              </p>
            </div>

            <div className="investigation-summary">
              <article className="summary-chip">
                <span className="summary-chip-label">Bassins scolaires</span>
                <strong>{formatInteger(schoolOperationalSummary.equipmentCount)}</strong>
                <small>{formatPercent(operationalSummary.schoolUsageShare)} du parc filtré.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Sites explicites</span>
                <strong>{formatInteger(schoolOperationalSummary.schoolExplicitCount)}</strong>
                <small>Marquage établissement scolaire explicite dans Data ES.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">UAI renseignée</span>
                <strong>{formatInteger(schoolOperationalSummary.uaiCount)}</strong>
                <small>Repère très rare, donc à lire comme un signal fort plutôt qu'exhaustif.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Accès transport</span>
                <strong>{formatPercent(schoolOperationalSummary.schoolTransportShare)}</strong>
                <small>Part des bassins scolaires avec un mode TC déclaré.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Accessibilité renseignée</span>
                <strong>{formatPercent(schoolOperationalSummary.schoolAccessibilityShare)}</strong>
                <small>Part des bassins scolaires avec signal handicap / PMR / sensoriel.</small>
              </article>
              <article className="summary-chip">
                <span className="summary-chip-label">Conditions favorables</span>
                <strong>{formatPercent(schoolOperationalSummary.schoolOperationalShare)}</strong>
                <small>Transport, accessibilité et arrêté d'ouverture présents ensemble.</small>
              </article>
            </div>

            <div className="breakdown-section">
              <h3>Conditions observées sur les bassins scolaires</h3>
              <BreakdownTable
                rows={schoolConditionRows}
                labelHeader="Condition"
                countHeader={inventoryCountMode === "equipments" ? "Bassins" : "Installations"}
                emptyMessage="Aucun bassin scolaire n'est disponible sur la sélection active."
              />
            </div>

            <div className="breakdown-section">
              <h3>Ancienneté des bassins scolaires</h3>
              <BreakdownTable
                rows={schoolServiceYearBreakdown}
                labelHeader="Période"
                countHeader={inventoryCountMode === "equipments" ? "Bassins" : "Installations"}
                emptyMessage="Aucune année de mise en service n'est disponible sur les bassins scolaires."
              />
            </div>

            <div className="breakdown-section">
              <h3>Modes de transport déclarés</h3>
              <BreakdownTable
                rows={transportBreakdown}
                labelHeader="Mode"
                countHeader={inventoryCountMode === "equipments" ? "Équipements" : "Installations"}
                emptyMessage="Aucun mode de transport n'est renseigné sur la sélection active."
              />
            </div>
          </article>
        </section>
          ) : null}

          {facilitiesView === "inventory" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel table-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Familles et types</span>
                <h2>Socle bassin et extraction complémentaire</h2>
              </div>
              <p>
                Les tableaux ci-dessous montrent l'ensemble des lignes disponibles, pas seulement les
                postes dominants.
              </p>
            </div>

            <p className="chart-note">Le comptage affiché dans cette table est lu en {inventoryCountModeLabel}.</p>

            <div className="breakdown-section">
              <h3>Socle bassins retenu</h3>
              <BreakdownTable
                rows={countedTypeBreakdown}
                labelHeader="Type d'équipement"
                countHeader={inventoryCountMode === "equipments" ? "Équipements" : "Installations"}
                emptyMessage="Aucun type d'équipement n'est disponible sur les filtres actifs."
              />
            </div>

            <div className="breakdown-section">
              <h3>Familles dans l'extraction Data ES élargie</h3>
              <BreakdownTable
                rows={extendedFamilyBreakdown}
                labelHeader="Famille d'équipement"
                countHeader={inventoryCountMode === "equipments" ? "Équipements" : "Installations"}
                emptyMessage="Aucune famille n'est disponible sur le champ de comparaison courant."
              />
            </div>

            <div className="breakdown-section">
              <h3>Types dans l'extraction Data ES élargie</h3>
              <BreakdownTable
                rows={extendedTypeBreakdown}
                labelHeader="Type d'équipement"
                countHeader={inventoryCountMode === "equipments" ? "Équipements" : "Installations"}
                emptyMessage="Aucun type n'est disponible dans l'extraction Data ES élargie."
              />
            </div>

            <div className="breakdown-section">
              <h3>Configurations de site</h3>
              <BreakdownTable
                rows={extendedParticularityBreakdown}
                labelHeader="Configuration"
                countHeader={inventoryCountMode === "equipments" ? "Équipements" : "Installations"}
                emptyMessage="Aucune configuration de site n'est disponible dans l'extraction élargie."
              />
            </div>
          </article>

          <article className="panel table-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Activités recensées</span>
                <h2>Lecture complète des pratiques déclarées</h2>
              </div>
              <p>
                Les activités permettent de raisonner comme Data ES : site, équipements présents, puis
                pratiques effectivement associées.
              </p>
            </div>

            <p className="chart-note">Le comptage affiché dans cette table est lu en {inventoryCountModeLabel}.</p>

            <div className="breakdown-section">
              <h3>Socle bassins retenu</h3>
              <BreakdownTable
                rows={countedActivityBreakdown}
                labelHeader="Activité"
                countHeader={inventoryCountMode === "equipments" ? "Équipements" : "Installations"}
                emptyMessage="Aucune activité n'est disponible sur les filtres actifs."
              />
            </div>

            <div className="breakdown-section">
              <h3>Extraction Data ES élargie</h3>
              <BreakdownTable
                rows={extendedActivityBreakdown}
                labelHeader="Activité"
                countHeader={inventoryCountMode === "equipments" ? "Équipements" : "Installations"}
                emptyMessage="Aucune activité n'est disponible dans l'extraction Data ES élargie."
              />
            </div>
          </article>
        </section>
          ) : null}

          {facilitiesView === "territories" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel table-panel territory-card-wide">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Lecture territoriale</span>
                <h2>Surface par habitant selon les EPCI</h2>
              </div>
              <p>
                Le ratio surface / population apporte une lecture plus physique que le simple nombre
                d'équipements. Il est calculé à partir des surfaces agrégées du socle EPCI.
              </p>
            </div>

            {territorySurfaceRows.length > 0 ? (
              <div className="table-scroll">
                <table className="raw-table">
                  <thead>
                    <tr>
                      <th>EPCI</th>
                      <th>Surface totale</th>
                      <th>Surface / 1 000 hab.</th>
                      <th>Équipements</th>
                      <th>Surface moyenne</th>
                    </tr>
                  </thead>
                  <tbody>
                    {territorySurfaceRows.map((item) => (
                      <tr key={item.epci_code}>
                        <td>
                          <strong>{item.epci_nom}</strong>
                          <div>{shortDepartment(item.departement)}</div>
                        </td>
                        <td>{`${formatNumber(item.totalSurface, 0)} m²`}</td>
                        <td>{`${formatNumber(item.surfacePer1000Hab, 2)} m²`}</td>
                        <td>{formatInteger(item.bassins)}</td>
                        <td>{`${formatNumber(item.averageSurface, 0)} m²`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="subtle-empty">Aucun EPCI avec surface agrégée n'est disponible sur le périmètre actif.</p>
            )}
          </article>
        </section>
          ) : null}
        </>
      ) : null}

      {activeTab === "licences" ? (
        <>
          <section className="content-grid content-grid-wide">
            <article className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Licences 2024</span>
                  <h2>Structure par ?ge et sexe</h2>
                </div>
                <p>
                  Distribution FFN à l'échelle {selectedDepartment === "all" ? "régionale" : "départementale"}.
                </p>
              </div>

              <div className="chart-wrap tall">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ageSeries} margin={{ top: 4, right: 10, bottom: 24, left: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#d6d6d6" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                      height={84}
                    />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Femmes" stackId="a" fill="#b34000" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Hommes" stackId="a" fill="#000091" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="panel table-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Évolution 2023 → 2024</span>
                  <h2>Delta départemental des licences</h2>
                </div>
                <p>
                  Les deux millésimes sont disponibles à la maille départementale. Le delta met en évidence
                  les dynamiques de progression ou de repli.
                </p>
              </div>

              <div className="investigation-summary">
                <article className="summary-chip">
                  <span className="summary-chip-label">Licences 2023</span>
                  <strong>{formatInteger(licenceTrendSummary.licences2023)}</strong>
                  <small>Base de comparaison du périmètre actif.</small>
                </article>
                <article className="summary-chip">
                  <span className="summary-chip-label">Licences 2024</span>
                  <strong>{formatInteger(licenceTrendSummary.licences2024)}</strong>
                  <small>Millésime le plus récent disponible dans le dashboard.</small>
                </article>
                <article className="summary-chip">
                  <span className="summary-chip-label">Delta brut</span>
                  <strong>{formatSignedInteger(licenceTrendSummary.delta)}</strong>
                  <small>{formatSignedPercent(licenceTrendSummary.deltaShare)} par rapport à 2023.</small>
                </article>
              </div>

              {licenceTrendRows.length > 0 ? (
                <div className="table-scroll">
                  <table className="raw-table">
                    <thead>
                      <tr>
                        <th>Département</th>
                        <th>Licences 2023</th>
                        <th>Licences 2024</th>
                        <th>Delta</th>
                        <th>Évolution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {licenceTrendRows.map((item) => (
                        <tr key={item.code}>
                          <td>{item.label}</td>
                          <td>{formatInteger(item.licences2023)}</td>
                          <td>{formatInteger(item.licences2024)}</td>
                          <td>{formatSignedInteger(item.delta)}</td>
                          <td>{`${getDeltaArrow(item.delta)} ${formatSignedPercent(item.deltaShare)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="subtle-empty">Aucune évolution départementale n'est disponible sur le périmètre actif.</p>
              )}
            </article>
          </section>

          <section className="panel table-panel overview-section-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Pression territoriale</span>
                <h2>Communes à licences sans bassin</h2>
              </div>
              <p>{formatInteger(currentOverview.communes_avec_licences_sans_bassin)} communes concernées.</p>
            </div>

            {topPressureCommunes.length > 0 ? (
              <div className="mini-table">
                <div className="mini-table-head">
                  <span>Commune</span>
                  <span>Licences 2023</span>
                  <span>Licences / 1 000 hab.</span>
                </div>
                {topPressureCommunes.map((item) => (
                  <div key={item.code_commune} className="mini-table-row">
                    <span>
                      <strong>{item.commune}</strong>
                      <small>{shortDepartment(item.departement)}</small>
                    </span>
                    <span>{formatInteger(item.licences_ffn_2023)}</span>
                    <span>{formatNumber(item.licences_ffn_pour_1000hab, 2)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="subtle-empty">Aucune commune sous pression n'est remontée sur le périmètre actif.</p>
            )}
          </section>
        </>
      ) : null}

      {activeTab === "data" ? (
        <>
          <section className="content-grid">
            <article className="panel notes-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Méthode</span>
                  <h2>Repères de lecture</h2>
                </div>
              </div>

              <div className="note-list">
                {data.notes.map((note) => (
                  <div key={note.label} className="note-item">
                    <strong>{note.label}</strong>
                    <p>{note.value}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel notes-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Exports</span>
                  <h2>Données et sources</h2>
                </div>
              </div>

              <div className="download-list">
                {data.downloads.map((download) => (
                  <a
                    key={download.path}
                    className="download-link"
                    href={`${import.meta.env.BASE_URL}${download.path}`}
                  >
                    {download.label}
                  </a>
                ))}
              </div>

              <div className="sources-list">
                {data.sources.map((source) => (
                  <div key={source.jeu} className="source-item">
                    <strong>{source.jeu}</strong>
                    <p>{source.usage_principal}</p>
                    <small>
                      {source.source} · {source.maille} · {source.millesime}
                    </small>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="panel data-explorer">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Données brutes</span>
                <h2>Explorateur des feuilles Excel</h2>
              </div>
              <p>
                Les feuilles <code>00_Lisez_moi</code> et la feuille de synthèse du classeur alimentent les
                onglets de lecture. Les tables exportées restent consultables et téléchargeables ici.
              </p>
            </div>

            <div className="explorer-meta">
              <div className="meta-pill">
                <span>Feuille active</span>
                <strong>{activeRawSheet?.sheetName ?? "Aucune"}</strong>
              </div>
              <div className="meta-pill">
                <span>Lignes filtrées</span>
                <strong>{formatInteger(rawRows.length)}</strong>
              </div>
              <div className="meta-pill">
                <span>Colonnes</span>
                <strong>{formatInteger(rawColumns.length)}</strong>
              </div>
              {workbookDownload ? (
                <a className="download-link" href={`${import.meta.env.BASE_URL}${workbookDownload.path}`}>
                  Télécharger le classeur Excel
                </a>
              ) : null}
            </div>

            <div className="sheet-chip-row">
              {rawSheets.map((sheet) => (
                <button
                  key={sheet.key}
                  type="button"
                  className={selectedRawSheet === sheet.key ? "sheet-chip active" : "sheet-chip"}
                  onClick={() => setSelectedRawSheet(sheet.key)}
                >
                  {sheet.label}
                </button>
              ))}
            </div>

            {activeRawSheet ? (
              <>
                <div className="sheet-toolbar">
                  <div className="sheet-description">
                    <strong>{activeRawSheet.description}</strong>
                    <span>
                      Filtre départemental appliqué : {departmentLabel}. Recherche texte sur toutes les colonnes.
                    </span>
                  </div>

                  <div className="sheet-controls">
                    <input
                      type="search"
                      placeholder="Rechercher une valeur, un code, une commune..."
                      value={rawSearch}
                      onChange={(event) => setRawSearch(event.target.value)}
                    />
                    {activeRawSheet.downloadPath ? (
                      <a
                        className="download-link"
                        href={`${import.meta.env.BASE_URL}${activeRawSheet.downloadPath}`}
                      >
                        Télécharger le CSV
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="table-scroll">
                  <table className="raw-table">
                    <thead>
                      <tr>
                        {rawColumns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rawPageRows.length === 0 ? (
                        <tr>
                          <td className="empty-table" colSpan={Math.max(rawColumns.length, 1)}>
                            Aucun enregistrement ne correspond au filtre actuel.
                          </td>
                        </tr>
                      ) : (
                        rawPageRows.map((row, rowIndex) => (
                          <tr key={`${currentRawPage}-${rowIndex}`}>
                            {rawColumns.map((column) => {
                              const cellValue = formatRawValue(row[column]);
                              return (
                                <td key={`${rowIndex}-${column}`}>
                                  <span className="cell-text" title={cellValue}>
                                    {cellValue}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="pager">
                  <span>
                    Lignes {formatInteger(rawRangeStart)} à {formatInteger(rawRangeEnd)} sur {formatInteger(rawRows.length)}
                  </span>
                  <div className="pager-actions">
                    <button
                      type="button"
                      className="pager-button"
                      onClick={() => setRawPage((page) => Math.max(1, page - 1))}
                      disabled={currentRawPage === 1}
                    >
                      Précédent
                    </button>
                    <strong>
                      Page {formatInteger(currentRawPage)} / {formatInteger(rawPageCount)}
                    </strong>
                    <button
                      type="button"
                      className="pager-button"
                      onClick={() => setRawPage((page) => Math.min(rawPageCount, page + 1))}
                      disabled={currentRawPage === rawPageCount}
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}

function StatCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <article className={`stat-card accent-${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function InvestigationScoreBreakdown({
  item,
  rankMaps,
  total,
  compact = false,
}: {
  item: InvestigationProfileRow;
  rankMaps: InvestigationRankLookup;
  total: number;
  compact?: boolean;
}) {
  return (
    <div className={`score-breakdown ${compact ? "compact" : ""}`}>
      <div className="score-breakdown-row score-breakdown-row-primary">
        <div className="score-breakdown-copy">
          <strong>Composite</strong>
          <small>
            {formatInteger(Math.round(SCORING_CONFIG.priorityWeights.offer_gap * 100))} % sous-équipement
            {" + "}
            {formatInteger(Math.round(SCORING_CONFIG.priorityWeights.pressure * 100))} % tension +{" "}
            {formatInteger(Math.round(SCORING_CONFIG.priorityWeights.impact * 100))} % impact
          </small>
        </div>
        <strong className="score-breakdown-value">{formatScore(item.priorityScore)}</strong>
        <small className="score-breakdown-rank">{formatRankPosition(rankMaps.priority.get(item.epci_code), total)}</small>
        <div className="score-breakdown-track">
          <span style={{ width: `${Math.max(0, Math.min(100, item.priorityScore))}%` }} />
        </div>
      </div>

      {INVESTIGATION_SCORE_DEFINITIONS.map((definition) => {
        const score = getInvestigationScoreByLens(item, definition.lens);
        const contribution = getInvestigationContribution(score, definition.lens);
        const rank = rankMaps[definition.lens].get(item.epci_code);

        return (
          <div key={definition.lens} className="score-breakdown-row">
            <div className="score-breakdown-copy">
              <strong>{definition.label}</strong>
              <small>
                {formatInteger(Math.round(definition.weight * 100))} % du composite · contribution{" "}
                {formatNumber(contribution, 1)}/100
              </small>
            </div>
            <strong className="score-breakdown-value">{formatScore(score)}</strong>
            <small className="score-breakdown-rank">{formatRankPosition(rank, total)}</small>
            <div className="score-breakdown-track">
              <span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownTable({
  rows,
  labelHeader,
  countHeader,
  emptyMessage,
}: {
  rows: Array<{ name: string; value: number; share: number }>;
  labelHeader: string;
  countHeader: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <p className="subtle-empty">{emptyMessage}</p>;
  }

  return (
    <div className="table-scroll breakdown-table-scroll">
      <table className="raw-table">
        <thead>
          <tr>
            <th>{labelHeader}</th>
            <th>{countHeader}</th>
            <th>Part</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.name}>
              <td>{item.name}</td>
              <td>{formatInteger(item.value)}</td>
              <td>{formatPercent(item.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: Record<string, unknown> }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const tooltipLabel =
    typeof payload[0]?.payload?.fullLabel === "string" ? String(payload[0].payload.fullLabel) : label;

  return (
    <div className="chart-tooltip">
      {tooltipLabel ? <strong>{tooltipLabel}</strong> : null}
      {payload.map((entry) => {
        const kind: MetricKind =
          entry.payload?.kind === "percent" ||
          entry.payload?.kind === "ratio" ||
          entry.payload?.kind === "count" ||
          entry.payload?.kind === "duration" ||
          entry.payload?.kind === "distance"
            ? entry.payload.kind
            : "count";
        const entryName =
          typeof entry.name === "string" && entry.name !== "value"
            ? entry.name
            : typeof entry.payload?.seriesLabel === "string"
              ? String(entry.payload.seriesLabel)
              : "Indicateur";
        return (
          <span key={`${entry.name}-${entry.value}`}>
            {entryName} : {formatMetricByKind(Number(entry.value ?? 0), kind)}
          </span>
        );
      })}
    </div>
  );
}

function QuadrantTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: {
      fullLabel?: string;
      profile?: string;
      priorityScore?: number;
      x?: number;
      y?: number;
      impactIndex?: number;
    };
  }>;
}) {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
    return null;
  }

  const point = payload[0].payload;

  return (
    <div className="chart-tooltip">
      {point.fullLabel ? <strong>{point.fullLabel}</strong> : null}
      {point.profile ? <span>{point.profile}</span> : null}
      <span>Priorité : {formatScore(Number(point.priorityScore ?? 0))}</span>
      <span>Sous-équipement : {formatScore(Number(point.x ?? 0))}</span>
      <span>Pression : {formatScore(Number(point.y ?? 0))}</span>
      <span>Impact : {formatScore(Number(point.impactIndex ?? 0) * 100)}</span>
    </div>
  );
}

function QuadrantBubble({
  cx,
  cy,
  size,
  payload,
  onSelect,
}: {
  cx?: number;
  cy?: number;
  size?: number;
  payload?: { color?: string; isSelected?: boolean; epci_code?: string };
  onSelect: (epciCode: string) => void;
}) {
  if (typeof cx !== "number" || typeof cy !== "number" || !payload?.epci_code) {
    return null;
  }

  const radius = Math.max(7, Math.sqrt(size ?? 0) / 2.6);

  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
                    fill={payload.color ?? "#000091"}
      fillOpacity={0.82}
      stroke={payload.isSelected ? "#161616" : "rgba(255, 255, 255, 0.96)"}
      strokeWidth={payload.isSelected ? 3 : 1.4}
      style={{ cursor: "pointer" }}
      onClick={() => onSelect(payload.epci_code ?? "")}
    />
  );
}

function buildAgeSeries(ageSex: AgeSexRecord[], selectedDepartment: string) {
  const filtered = ageSex.filter(
    (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
  );
  const byAge = new Map<string, { label: string; Femmes: number; Hommes: number }>();

  filtered.forEach((item) => {
    const current = byAge.get(item.trage) ?? { label: item.trage, Femmes: 0, Hommes: 0 };
    if (item.sexe === "F") {
      current.Femmes += item.licences_ffn_2024;
    } else {
      current.Hommes += item.licences_ffn_2024;
    }
    byAge.set(item.trage, current);
  });

  return AGE_ORDER.map((label) => byAge.get(label)).filter(
    (item): item is { label: string; Femmes: number; Hommes: number } => Boolean(item),
  );
}

function buildLocalitySignals(
  data: DashboardData | null,
  epci: EpciRecord[],
  basins: BasinRecord[],
) {
  if (!data) {
    return [];
  }

  const bestCoverageDepartment = [...data.departments].sort(
    (left, right) => right.bassins_pour_100k_hab - left.bassins_pour_100k_hab,
  )[0];
  const topEpci = [...epci].sort((left, right) => right.bassins_total - left.bassins_total)[0];
  const schoolShare =
    basins.length > 0 ? basins.filter((item) => item.usage_scolaires === 1).length / basins.length : 0;

  return [
    {
      kicker: "Point de repère",
      title: bestCoverageDepartment
        ? `${shortDepartment(bestCoverageDepartment.departement)} mène en densité`
        : "Lecture départementale",
      description: bestCoverageDepartment
        ? `${formatNumber(bestCoverageDepartment.bassins_pour_100k_hab, 2)} bassins pour 100 000 habitants.`
        : "Le comparatif départemental n'est pas disponible.",
    },
    {
      kicker: "Concentration",
      title: topEpci ? shortenEpci(topEpci.epci_nom) : "EPCI",
      description: topEpci
        ? `${formatInteger(topEpci.bassins_total)} bassins recensés pour ${formatInteger(topEpci.population_2023_communes)} habitants.`
        : "Aucun EPCI disponible avec les filtres actuels.",
    },
    {
      kicker: "Scolaires",
      title: `${formatPercent(schoolShare)} du parc filtré`,
      description:
        "Part des bassins dont l'usage scolaires est explicitement identifié dans le socle Data ES.",
    },
  ];
}

function buildPressureCommunes(communes: CommuneRecord[]) {
  return communes
    .filter((item) => item.licences_ffn_2023 > 0 && item.bassins_total === 0)
    .sort((left, right) => right.licences_ffn_2023 - left.licences_ffn_2023)
    .slice(0, 8);
}

function formatCommuneTypology(value: string | null | undefined) {
  if (!value) {
    return "Non renseigné";
  }

  return value.replace(/^\d+\./, "").trim() || "Non renseigné";
}

function countUnique(values: Array<string | null | undefined>) {
  return new Set(values.filter((value): value is string => Boolean(value))).size;
}

function isDivingEquipment(item: Pick<BasinRecord, "type_equipement">) {
  return item.type_equipement.toLowerCase().includes("fosse");
}

function getDetailedComparableBasinProfile(item: BasinRecord) {
  const equipmentType = (item.type_equipement || "").toLowerCase();
  const length = typeof item.longueur_m === "number" ? item.longueur_m : null;
  const surface = typeof item.surface_bassin_m2 === "number" ? item.surface_bassin_m2 : null;
  const lanes = typeof item.nb_couloirs === "number" ? item.nb_couloirs : null;
  const maxDepth = typeof item.profondeur_max_m === "number" ? item.profondeur_max_m : null;

  if (equipmentType.includes("fosse")) {
    if (maxDepth !== null && maxDepth >= 15) {
      return "Fosse de 15 m et +";
    }
    if (maxDepth !== null && maxDepth >= 10) {
      return "Fosse de 10 à 14,9 m";
    }
    return "Fosse / plongée";
  }
  if (equipmentType.includes("toboggan")) {
    return surface !== null && surface >= 100 ? "Réception de toboggan structurante" : "Réception de toboggan";
  }
  if (equipmentType.includes("ludique")) {
    if (surface !== null && surface >= 300) {
      return "Bassin ludique structurant";
    }
    if (maxDepth !== null && maxDepth <= 1.4) {
      return "Bassin ludique peu profond";
    }
    return "Bassin ludique";
  }
  if (equipmentType.includes("mixte")) {
    if (length !== null && length >= 25) {
      return "Bassin mixte 25 m et +";
    }
    if (surface !== null && surface >= 250) {
      return "Bassin mixte structurant";
    }
    return "Bassin mixte de proximité";
  }
  if (equipmentType.includes("sportif")) {
    if (length !== null && length >= 50) {
      return "Bassin sportif 50 m";
    }
    if (length !== null && length >= 25 && lanes !== null && lanes >= 8) {
      return "Bassin sportif 25 m 8 couloirs et +";
    }
    if (length !== null && length >= 25) {
      return "Bassin sportif 25 m";
    }
    if (surface !== null && surface >= 250) {
      return "Bassin sportif compact";
    }
    return "Bassin sportif court";
  }
  if (length !== null && length >= 50) {
    return "Grand bassin 50 m et +";
  }
  if (length !== null && length >= 25) {
    return "Grand bassin 25 m";
  }
  if (length !== null && length >= 15) {
    return "Bassin intermédiaire";
  }
  return item.type_equipement || "Autre équipement aquatique";
}

function getComparableProfileScopeFromLabel(label: string): ComparableProfileScope {
  const normalizedLabel = label.toLowerCase();

  if (normalizedLabel.includes("fosse")) {
    return "fosse";
  }
  if (normalizedLabel.includes("ludique")) {
    return "ludique";
  }
  if (normalizedLabel.includes("mixte")) {
    return "mixte";
  }
  if (normalizedLabel.includes("50 m")) {
    return "sport_50";
  }
  if (normalizedLabel.includes("25 m")) {
    return "sport_25";
  }
  return "specialized";
}

function matchesComparableProfileScope(item: BasinRecord, scope: ComparableProfileScope) {
  if (scope === "all") {
    return true;
  }
  return getComparableProfileScopeFromLabel(getDetailedComparableBasinProfile(item)) === scope;
}

function matchesComparableBasinContext(item: BasinRecord, context: ComparableBasinContext) {
  if (context === "all") {
    return true;
  }
  if (context === "school") {
    return item.usage_scolaires === 1;
  }
  return item.qpv_flag === 1 || item.qpv_200m_flag === 1;
}

function buildComparableProfileSummary(basins: BasinRecord[]): ComparableProfileSummary {
  const lengths = basins
    .map((item) => item.longueur_m)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const surfaces = basins
    .map((item) => item.surface_bassin_m2)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const lanes = basins
    .map((item) => item.nb_couloirs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const maxDepths = basins
    .map((item) => item.profondeur_max_m)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    equipmentCount: basins.length,
    installationCount: countUnique(basins.map((item) => item.id_installation)),
    averageLength: average(lengths),
    averageSurface: average(surfaces),
    averageLanes: average(lanes),
    averageMaxDepth: average(maxDepths),
  };
}

function buildComparableProfileCoverageRows(basins: BasinRecord[]) {
  const equipmentRows = buildInventoryPresenceRows(basins, getDetailedComparableBasinProfile, "equipments");
  const installationRows = buildInventoryPresenceRows(basins, getDetailedComparableBasinProfile, "installations");
  const installationRowMap = new Map(installationRows.map((item) => [item.label, item]));
  const labels = Array.from(
    new Set([...equipmentRows.map((item) => item.label), ...installationRows.map((item) => item.label)]),
  );

  return labels
    .map((label) => {
      const equipmentRow = equipmentRows.find((item) => item.label === label);
      const installationRow = installationRowMap.get(label);

      return {
        label,
        equipmentCount: equipmentRow?.count ?? 0,
        equipmentShare: equipmentRow?.share ?? 0,
        installationCount: installationRow?.count ?? 0,
        installationShare: installationRow?.share ?? 0,
      };
    })
    .sort((left, right) => {
      if (right.equipmentCount !== left.equipmentCount) {
        return right.equipmentCount - left.equipmentCount;
      }
      if (right.installationCount !== left.installationCount) {
        return right.installationCount - left.installationCount;
      }
      return left.label.localeCompare(right.label, "fr");
    });
}

function buildComparableProfileComparisonRows(primaryBasins: BasinRecord[], comparisonBasins: BasinRecord[]) {
  const primaryRows = buildComparableProfileCoverageRows(primaryBasins);
  const comparisonRows = buildComparableProfileCoverageRows(comparisonBasins);
  const primaryRowMap = new Map(primaryRows.map((item) => [item.label, item]));
  const comparisonRowMap = new Map(comparisonRows.map((item) => [item.label, item]));
  const labels = Array.from(
    new Set([...primaryRows.map((item) => item.label), ...comparisonRows.map((item) => item.label)]),
  );

  return labels
    .map((label) => {
      const primary = primaryRowMap.get(label);
      const comparison = comparisonRowMap.get(label);

      return {
        label,
        primaryEquipmentCount: primary?.equipmentCount ?? 0,
        primaryEquipmentShare: primary?.equipmentShare ?? 0,
        primaryInstallationCount: primary?.installationCount ?? 0,
        primaryInstallationShare: primary?.installationShare ?? 0,
        comparisonEquipmentCount: comparison?.equipmentCount ?? 0,
        comparisonEquipmentShare: comparison?.equipmentShare ?? 0,
        comparisonInstallationCount: comparison?.installationCount ?? 0,
        comparisonInstallationShare: comparison?.installationShare ?? 0,
        deltaEquipmentCount: (primary?.equipmentCount ?? 0) - (comparison?.equipmentCount ?? 0),
      };
    })
    .sort((left, right) => {
      const rightVolume = Math.max(right.primaryEquipmentCount, right.comparisonEquipmentCount);
      const leftVolume = Math.max(left.primaryEquipmentCount, left.comparisonEquipmentCount);
      if (rightVolume !== leftVolume) {
        return rightVolume - leftVolume;
      }
      return left.label.localeCompare(right.label, "fr");
    });
}

function buildComparableBasinListRows(basins: BasinRecord[]) {
  return [...basins]
    .map((item) => ({
      id: item.id_equipement,
      equipement: item.equipement,
      installation: item.installation,
      commune: item.commune,
      profile: getDetailedComparableBasinProfile(item),
      metricsLabel: formatComparableBasinMetrics(item),
      sortLength: item.longueur_m ?? -1,
      sortSurface: item.surface_bassin_m2 ?? -1,
    }))
    .sort((left, right) => {
      if (right.sortLength !== left.sortLength) {
        return right.sortLength - left.sortLength;
      }
      if (right.sortSurface !== left.sortSurface) {
        return right.sortSurface - left.sortSurface;
      }
      const profileCompare = left.profile.localeCompare(right.profile, "fr");
      if (profileCompare !== 0) {
        return profileCompare;
      }
      return left.equipement.localeCompare(right.equipement, "fr");
    });
}

function formatComparableBasinMetrics(item: BasinRecord) {
  const metrics: string[] = [];

  if (typeof item.longueur_m === "number" && Number.isFinite(item.longueur_m)) {
    metrics.push(`${formatNumber(item.longueur_m, 0)} m`);
  }
  if (typeof item.surface_bassin_m2 === "number" && Number.isFinite(item.surface_bassin_m2)) {
    metrics.push(`${formatNumber(item.surface_bassin_m2, 0)} m²`);
  }
  if (typeof item.nb_couloirs === "number" && Number.isFinite(item.nb_couloirs)) {
    metrics.push(`${formatNumber(item.nb_couloirs, 0)} couloirs`);
  }
  if (typeof item.profondeur_max_m === "number" && Number.isFinite(item.profondeur_max_m)) {
    metrics.push(`prof. max ${formatNumber(item.profondeur_max_m, 1)} m`);
  }

  return metrics.length > 0 ? metrics.join(" · ") : "Dimensions non renseignées";
}

function formatInventoryDimensions(
  item: Pick<
    ExtendedInventoryRecord,
    "longueur_m" | "surface_bassin_m2" | "nb_couloirs" | "profondeur_max_m"
  >,
) {
  const metrics: string[] = [];

  if (typeof item.longueur_m === "number" && Number.isFinite(item.longueur_m)) {
    metrics.push(`${formatNumber(item.longueur_m, 0)} m`);
  }
  if (typeof item.surface_bassin_m2 === "number" && Number.isFinite(item.surface_bassin_m2)) {
    metrics.push(`${formatNumber(item.surface_bassin_m2, 0)} m2`);
  }
  if (typeof item.nb_couloirs === "number" && Number.isFinite(item.nb_couloirs)) {
    metrics.push(`${formatNumber(item.nb_couloirs, 0)} couloirs`);
  }
  if (typeof item.profondeur_max_m === "number" && Number.isFinite(item.profondeur_max_m)) {
    metrics.push(`prof. max ${formatNumber(item.profondeur_max_m, 1)} m`);
  }

  return metrics.length > 0 ? metrics.join(" - ") : "n.c.";
}

function buildInventoryPresenceRows<T extends InventoryCountableRecord>(
  items: T[],
  getLabel: (item: T) => string,
  mode: InventoryCountMode,
) {
  if (mode === "equipments") {
    const counters = new Map<string, number>();
    items.forEach((item) => {
      const key = getLabel(item);
      counters.set(key, (counters.get(key) ?? 0) + 1);
    });

    return Array.from(counters.entries())
      .map(([label, count]) => ({
        label,
        count,
        share: safeDivide(count, items.length),
      }))
      .sort((left, right) => right.count - left.count);
  }

  const installationGroups = new Map<string, Set<string>>();
  items.forEach((item) => {
    const installationKey = item.id_installation || item.id_equipement;
    const labels = installationGroups.get(installationKey) ?? new Set<string>();
    labels.add(getLabel(item));
    installationGroups.set(installationKey, labels);
  });

  const counters = new Map<string, number>();
  installationGroups.forEach((labels) => {
    labels.forEach((label) => {
      counters.set(label, (counters.get(label) ?? 0) + 1);
    });
  });

  return Array.from(counters.entries())
    .map(([label, count]) => ({
      label,
      count,
      share: safeDivide(count, installationGroups.size),
    }))
    .sort((left, right) => right.count - left.count);
}

function buildInventoryTypeBreakdownRows<T extends InventoryTypedRecord>(items: T[], mode: InventoryCountMode) {
  return buildInventoryPresenceRows(
    items,
    (item) => item.type_equipement || "Type non renseigné",
    mode,
  ).map((item) => ({
    name: item.label,
    value: item.count,
    share: item.share,
    kind: "count" as const,
    seriesLabel: mode === "equipments" ? "Équipements" : "Installations",
  }));
}

function buildExtendedInventoryFamilyBreakdownRows(
  inventory: ExtendedInventoryRecord[],
  mode: InventoryCountMode,
) {
  return buildInventoryPresenceRows(
    inventory,
    (item) => item.famille_equipement || "Famille non renseignée",
    mode,
  ).map((item) => ({
    name: item.label,
    value: item.count,
    share: item.share,
    kind: "count" as const,
    seriesLabel: mode === "equipments" ? "Équipements" : "Installations",
  }));
}

function buildExtendedInventoryParticularityRows(
  inventory: ExtendedInventoryRecord[],
  mode: InventoryCountMode,
) {
  return buildInventoryPresenceRows(
    inventory,
    (item) =>
      item.particularite_installation_brute ||
      item.particularite_installation ||
      "Installation non renseignée",
    mode,
  ).map((item) => ({
    name: item.label,
    value: item.count,
    share: item.share,
    kind: "count" as const,
    seriesLabel: mode === "equipments" ? "Équipements" : "Installations",
  }));
}

function buildExtendedInventorySummary(inventory: ExtendedInventoryRecord[]): InventoryScopeSummary {
  const bassinFamily = inventory.filter((item) => item.famille_equipement === "Bassin de natation");
  const nonBassinFamily = inventory.filter((item) => item.famille_equipement !== "Bassin de natation");
  const activities = new Set<string>();

  inventory.forEach((item) => {
    parseActivities(item.activites).forEach((activity) => activities.add(activity));
  });

  return {
    equipmentsTotal: inventory.length,
    installationsTotal: countUnique(inventory.map((item) => item.id_installation)),
    bassinFamilyEquipmentsTotal: bassinFamily.length,
    bassinFamilyInstallationsTotal: countUnique(bassinFamily.map((item) => item.id_installation)),
    nonBassinFamilyEquipmentsTotal: nonBassinFamily.length,
    nonBassinFamilyInstallationsTotal: countUnique(nonBassinFamily.map((item) => item.id_installation)),
    familiesTotal: countUnique(inventory.map((item) => item.famille_equipement)),
    typesTotal: countUnique(inventory.map((item) => item.type_equipement)),
    activitiesTotal: activities.size,
  };
}

function splitPipeSeparatedValues(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasTransportAccess(item: Pick<OperationalBasinRecord, "transport_access_modes">) {
  return splitPipeSeparatedValues(item.transport_access_modes).length > 0;
}

function hasAccessibilitySupport(
  item: Pick<OperationalBasinRecord, "handicap_access_types" | "pmr_access_detail" | "sensory_access_detail">,
) {
  return (
    splitPipeSeparatedValues(item.handicap_access_types).length > 0 ||
    Boolean(item.pmr_access_detail) ||
    Boolean(item.sensory_access_detail)
  );
}

function hasRecentWorks(item: Pick<OperationalBasinRecord, "last_major_works_year">) {
  return (
    typeof item.last_major_works_year === "number" &&
    Number.isFinite(item.last_major_works_year) &&
    item.last_major_works_year >= RECENT_WORKS_YEAR_THRESHOLD
  );
}

function hasSchoolExplicitSignal(item: Pick<OperationalBasinRecord, "site_scolaire_explicit" | "uai">) {
  return item.site_scolaire_explicit === 1 || Boolean(item.uai);
}

function hasOperationalSchoolConditions(item: OperationalBasinRecord) {
  return item.usage_scolaires === 1 && hasTransportAccess(item) && hasAccessibilitySupport(item) && item.opening_authorized_flag === 1;
}

function getOperationalStatusPriority(code: OperationalStatusCode) {
  switch (code) {
    case "closed":
      return 0;
    case "temporary_closed":
      return 1;
    case "verify":
      return 2;
    case "seasonal":
      return 3;
    case "open_probable":
    default:
      return 4;
  }
}

function createProjectMarkerIcon(bucketCode: ProjectBucketCode) {
  const strokeColor = PROJECT_BUCKET_COLORS[bucketCode] ?? PROJECT_MARKER_STROKE;
  return divIcon({
    className: "project-marker-shell",
    html: `<span class="project-marker-icon" style="--project-fill:${PROJECT_MARKER_FILL}; --project-stroke:${strokeColor};"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function buildInstallationStatusRows(items: OperationalBasinRecord[]): InstallationStatusRecord[] {
  const grouped = new Map<string, OperationalBasinRecord[]>();
  items.forEach((item) => {
    const key = item.id_installation || item.id_equipement;
    const rows = grouped.get(key) ?? [];
    rows.push(item);
    grouped.set(key, rows);
  });

  return Array.from(grouped.entries())
    .map(([installationId, rows]) => {
      const sortedRows = [...rows].sort((left, right) => {
        const priorityGap =
          getOperationalStatusPriority(left.operational_status_code) -
          getOperationalStatusPriority(right.operational_status_code);
        if (priorityGap !== 0) {
          return priorityGap;
        }
        return left.equipement.localeCompare(right.equipement, "fr");
      });
      const primary = sortedRows[0];
      const surveyDates = rows.map((item) => item.survey_date).filter((value): value is string => Boolean(value));
      const stateChangeDates = rows
        .map((item) => item.state_change_date)
        .filter((value): value is string => Boolean(value));

      return {
        id_installation: installationId,
        installation: primary.installation,
        code_commune: primary.code_commune,
        commune: primary.commune,
        epci_code: primary.epci_code,
        epci_nom: primary.epci_nom,
        code_departement: primary.dep_code,
        departement: primary.departement,
        equipments_total: rows.length,
        bassins_total: rows.length,
        operational_status_code: primary.operational_status_code,
        operational_status_label: primary.operational_status_label,
        operational_status_reason: primary.operational_status_reason,
        status_source: primary.status_source,
        status_source_url: primary.status_source_url,
        status_reviewed_at: primary.status_reviewed_at,
        status_confidence: primary.status_confidence,
        status_verified_by: primary.status_verified_by,
        status_is_manual: primary.status_is_manual,
        status_override_comment: primary.status_override_comment,
        survey_date_latest: surveyDates.sort().at(-1) ?? null,
        state_change_date_latest: stateChangeDates.sort().at(-1) ?? null,
      };
    })
    .sort((left, right) => {
      const priorityGap =
        getOperationalStatusPriority(left.operational_status_code) -
        getOperationalStatusPriority(right.operational_status_code);
      if (priorityGap !== 0) {
        return priorityGap;
      }
      return `${left.departement ?? ""}${left.commune ?? ""}${left.installation ?? ""}`.localeCompare(
        `${right.departement ?? ""}${right.commune ?? ""}${right.installation ?? ""}`,
        "fr",
      );
    });
}

function buildOperationalStatusSummary(rows: InstallationStatusRecord[]): OperationalStatusSummary {
  return rows.reduce<OperationalStatusSummary>(
    (summary, row) => {
      summary.totalInstallations += 1;
      if (row.status_is_manual === 1) {
        summary.verifiedManual += 1;
      }
      if (row.operational_status_code === "open_probable") {
        summary.openProbable += 1;
      } else if (row.operational_status_code === "temporary_closed") {
        summary.temporaryClosed += 1;
      } else if (row.operational_status_code === "closed") {
        summary.closed += 1;
      } else if (row.operational_status_code === "seasonal") {
        summary.seasonal += 1;
      } else {
        summary.verify += 1;
      }
      return summary;
    },
    {
      totalInstallations: 0,
      verifiedManual: 0,
      openProbable: 0,
      temporaryClosed: 0,
      closed: 0,
      seasonal: 0,
      verify: 0,
    },
  );
}

function formatOperationalStatusUpdate(row: InstallationStatusRecord) {
  if (row.status_reviewed_at) {
    return row.status_reviewed_at;
  }
  if (row.state_change_date_latest) {
    return row.state_change_date_latest;
  }
  if (row.survey_date_latest) {
    return row.survey_date_latest;
  }
  return "n.c.";
}

function getStatusVerificationLabel(row: InstallationStatusRecord) {
  return row.status_is_manual === 1 ? "Vérifié manuellement" : "Non vérifié";
}

function matchesFacilityOperationalStatusFilter(
  statusCode: OperationalStatusCode,
  filter: FacilityOperationalStatusFilter,
) {
  if (filter === "all") {
    return true;
  }
  if (filter === "open") {
    return statusCode === "open_probable" || statusCode === "seasonal";
  }
  if (filter === "closed") {
    return statusCode === "temporary_closed" || statusCode === "closed";
  }
  return statusCode === "verify";
}

function getFacilityOperationalStatusFilterLabel(filter: FacilityOperationalStatusFilter) {
  switch (filter) {
    case "open":
      return "Ouverts / saisonniers";
    case "closed":
      return "Fermés / travaux";
    case "verify":
      return "À vérifier";
    case "all":
    default:
      return "Tous statuts";
  }
}

function getOperationalStatusPillClassName(statusCode: OperationalStatusCode) {
  return `signal-pill status-pill status-pill-${statusCode.replace(/_/g, "-")}`;
}

function getProjectBucketPillClassName(bucketCode: ProjectBucketCode) {
  return `signal-pill project-bucket-pill project-bucket-pill-${bucketCode.replace(/_/g, "-")}`;
}

function getFacilitySignalPillClassName(
  kind: "default" | "verified" | "transport" | "accessibility" | "works" = "default",
) {
  if (kind === "default") {
    return "signal-pill";
  }
  return `signal-pill signal-pill-${kind}`;
}

function formatReviewDateLabel(value: string | null) {
  if (!value || value === "n.c.") {
    return "n.c.";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return formatDate(value);
}

function buildOperationalSummary(items: OperationalBasinRecord[]): OperationalInventorySummary {
  const serviceYears = items
    .map((item) => item.year_service)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const schoolItems = items.filter((item) => item.usage_scolaires === 1);

  return {
    equipmentCount: items.length,
    installationCount: countUnique(items.map((item) => item.id_installation)),
    averageServiceYear: average(serviceYears),
    yearCoverageShare: safeDivide(serviceYears.length, items.length),
    legacyShare: safeDivide(
      items.filter(
        (item) =>
          typeof item.year_service === "number" &&
          Number.isFinite(item.year_service) &&
          item.year_service < LEGACY_SERVICE_YEAR_THRESHOLD,
      ).length,
      items.length,
    ),
    recentWorksShare: safeDivide(items.filter((item) => hasRecentWorks(item)).length, items.length),
    transportAccessShare: safeDivide(items.filter((item) => hasTransportAccess(item)).length, items.length),
    accessibilityShare: safeDivide(items.filter((item) => hasAccessibilitySupport(item)).length, items.length),
    openingAuthorizedShare: safeDivide(
      items.filter((item) => item.opening_authorized_flag === 1).length,
      items.length,
    ),
    seasonalShare: safeDivide(items.filter((item) => item.seasonal_only_flag === 1).length, items.length),
    outOfServiceShare: safeDivide(
      items.filter((item) => item.installation_out_of_service_flag === 1).length,
      items.length,
    ),
    schoolUsageCount: schoolItems.length,
    schoolUsageShare: safeDivide(schoolItems.length, items.length),
    schoolExplicitCount: schoolItems.filter((item) => hasSchoolExplicitSignal(item)).length,
    uaiCount: schoolItems.filter((item) => Boolean(item.uai)).length,
    schoolTransportShare: safeDivide(
      schoolItems.filter((item) => hasTransportAccess(item)).length,
      schoolItems.length,
    ),
    schoolAccessibilityShare: safeDivide(
      schoolItems.filter((item) => hasAccessibilitySupport(item)).length,
      schoolItems.length,
    ),
    schoolOperationalShare: safeDivide(
      schoolItems.filter((item) => hasOperationalSchoolConditions(item)).length,
      schoolItems.length,
    ),
  };
}

function buildOperationalMultiValueBreakdownRows<T extends InventoryCountableRecord>(
  items: T[],
  getValues: (item: T) => string[],
  mode: InventoryCountMode,
) {
  const expandedItems = items.flatMap((item) =>
    getValues(item).map((label) => ({
      ...item,
      label,
    })),
  );

  return buildInventoryPresenceRows(
    expandedItems,
    (item) => item.label,
    mode,
  ).map((item) => ({
    name: item.label,
    value: item.count,
    share: item.share,
    kind: "count" as const,
    seriesLabel: mode === "equipments" ? "Équipements" : "Installations",
  }));
}

function buildOperationalConditionRows<T extends InventoryCountableRecord>(
  items: T[],
  conditions: Array<{ label: string; test: (item: T) => boolean }>,
  mode: InventoryCountMode,
) {
  const total = mode === "equipments" ? items.length : countUnique(items.map((item) => item.id_installation));

  return conditions.map((condition) => {
    const matchingItems = items.filter((item) => condition.test(item));
    const count =
      mode === "equipments"
        ? matchingItems.length
        : countUnique(matchingItems.map((item) => item.id_installation));

    return {
      name: condition.label,
      value: count,
      share: safeDivide(count, total),
      kind: "count" as const,
      seriesLabel: mode === "equipments" ? "Équipements" : "Installations",
    };
  });
}

function buildOperationalServiceYearRows(items: OperationalBasinRecord[], mode: InventoryCountMode) {
  const total = mode === "equipments" ? items.length : countUnique(items.map((item) => item.id_installation));

  const rows: Array<{
    name: string;
    value: number;
    share: number;
    kind: "count";
    seriesLabel: string;
  }> = SERVICE_YEAR_BUCKETS.map((bucket) => {
    const matchingItems = items.filter(
      (item) =>
        typeof item.year_service === "number" &&
        Number.isFinite(item.year_service) &&
        item.year_service >= bucket.min &&
        item.year_service < bucket.max,
    );
    const count =
      mode === "equipments"
        ? matchingItems.length
        : countUnique(matchingItems.map((item) => item.id_installation));

    return {
      name: bucket.label,
      value: count,
      share: safeDivide(count, total),
      kind: "count" as const,
      seriesLabel: mode === "equipments" ? "Équipements" : "Installations",
    };
  });

  const missingItems = items.filter((item) => typeof item.year_service !== "number" || !Number.isFinite(item.year_service));
  const missingCount =
    mode === "equipments" ? missingItems.length : countUnique(missingItems.map((item) => item.id_installation));

  if (missingCount > 0) {
    rows.push({
      name: "Non renseignée",
      value: missingCount,
      share: safeDivide(missingCount, total),
      kind: "count" as const,
      seriesLabel: mode === "equipments" ? "Équipements" : "Installations",
    });
  }

  return rows.filter((item) => item.value > 0);
}

function buildOperationalTerritoryRows(epci: EpciRecord[], basins: OperationalBasinRecord[]): OperationalTerritoryRow[] {
  const basinsByEpci = new Map<string, OperationalBasinRecord[]>();
  basins.forEach((item) => {
    const rows = basinsByEpci.get(item.epci_code) ?? [];
    rows.push(item);
    basinsByEpci.set(item.epci_code, rows);
  });

  return epci
    .map((item) => {
      const territoryBasins = basinsByEpci.get(item.epci_code) ?? [];
      const summary = buildOperationalSummary(territoryBasins);

      return {
        epci_code: item.epci_code,
        epci_nom: item.epci_nom,
        departement: item.departement,
        basins: summary.equipmentCount,
        installations: summary.installationCount,
        averageServiceYear: summary.averageServiceYear,
        legacyShare: summary.legacyShare,
        recentWorksShare: summary.recentWorksShare,
        transportAccessShare: summary.transportAccessShare,
        accessibilityShare: summary.accessibilityShare,
        schoolUsageCount: summary.schoolUsageCount,
        schoolOperationalShare: summary.schoolOperationalShare,
      };
    })
    .filter((item) => item.basins > 0)
    .sort((left, right) => {
      if (right.schoolUsageCount !== left.schoolUsageCount) {
        return right.schoolUsageCount - left.schoolUsageCount;
      }
      if (right.legacyShare !== left.legacyShare) {
        return right.legacyShare - left.legacyShare;
      }
      return left.epci_nom.localeCompare(right.epci_nom, "fr");
    });
}

function parseActivities(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(value.includes("|") ? "|" : ",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildInventoryActivityRows<T extends InventoryActivityRecord>(items: T[], mode: InventoryCountMode) {
  if (mode === "equipments") {
    const counters = new Map<string, number>();
    items.forEach((item) => {
      parseActivities(item.activites).forEach((activity) => {
        counters.set(activity, (counters.get(activity) ?? 0) + 1);
      });
    });

    return Array.from(counters.entries())
      .map(([name, value]) => ({
        name,
        value,
        share: safeDivide(value, items.length),
      }))
      .sort((left, right) => right.value - left.value);
  }

  const installationActivities = new Map<string, Set<string>>();
  items.forEach((item) => {
    const installationKey = item.id_installation || item.id_equipement;
    const activities = installationActivities.get(installationKey) ?? new Set<string>();
    parseActivities(item.activites).forEach((activity) => activities.add(activity));
    installationActivities.set(installationKey, activities);
  });

  const counters = new Map<string, number>();
  installationActivities.forEach((activities) => {
    activities.forEach((activity) => {
      counters.set(activity, (counters.get(activity) ?? 0) + 1);
    });
  });

  return Array.from(counters.entries())
    .map(([name, value]) => ({
      name,
      value,
      share: safeDivide(value, installationActivities.size),
    }))
    .sort((left, right) => right.value - left.value);
}

function buildComparableInventoryActivityRows(
  primaryBasins: BasinRecord[],
  comparisonBasins: BasinRecord[],
  mode: InventoryCountMode,
) {
  const primaryRows = buildInventoryActivityRows(primaryBasins, mode);
  const comparisonRows = buildInventoryActivityRows(comparisonBasins, mode);
  const labels = Array.from(
    new Set([...primaryRows.map((item) => item.name), ...comparisonRows.map((item) => item.name)]),
  );

  return labels
    .map((label) => {
      const primary = primaryRows.find((item) => item.name === label);
      const comparison = comparisonRows.find((item) => item.name === label);
      const primaryCount = primary?.value ?? 0;
      const comparisonCount = comparison?.value ?? 0;

      return {
        label,
        primaryCount,
        primaryShare: primary?.share ?? 0,
        comparisonCount,
        comparisonShare: comparison?.share ?? 0,
        deltaCount: primaryCount - comparisonCount,
      };
    })
    .sort((left, right) => {
      const volumeGap =
        Math.max(right.primaryCount, right.comparisonCount) - Math.max(left.primaryCount, left.comparisonCount);
      if (volumeGap !== 0) {
        return volumeGap;
      }
      return left.label.localeCompare(right.label, "fr");
    });
}

function buildTerritoryTypologyRows(communes: CommuneRecord[], basins: BasinRecord[]) {
  const basinCounters = new Map<string, number>();
  basins.forEach((item) => {
    const label = formatCommuneTypology(
      communes.find((commune) => commune.code_commune === item.code_commune)?.typo,
    );
    basinCounters.set(label, (basinCounters.get(label) ?? 0) + 1);
  });

  const counters = new Map<
    string,
    {
      communes: number;
      population: number;
      licences: number;
    }
  >();

  communes.forEach((item) => {
    const label = formatCommuneTypology(item.typo);
    const current = counters.get(label) ?? {
      communes: 0,
      population: 0,
      licences: 0,
    };

    counters.set(label, {
      communes: current.communes + 1,
      population: current.population + item.population_2023,
      licences: current.licences + item.licences_ffn_2023,
    });
  });

  return Array.from(counters.entries())
    .map(([label, value]) => {
      const bassins = basinCounters.get(label) ?? 0;

      return {
        label,
        communes: value.communes,
        licences: value.licences,
        bassins,
        bassinsPer100kHab: safeDivide(bassins, value.population) * 100000,
      };
    })
    .sort((left, right) => right.bassinsPer100kHab - left.bassinsPer100kHab);
}

function countCommunesWithLicences(communes: CommuneRecord[]) {
  return communes.filter((item) => item.licences_ffn_2023 > 0).length;
}

function countCommunesWithLicencesSansBassin(communes: CommuneRecord[]) {
  return communes.filter((item) => item.licences_ffn_2023 > 0 && item.bassins_total === 0).length;
}

function buildTerritoryMetricsSummary({
  bassinsPour100kHab,
  surface,
  population,
  licences,
  communesWithLicences,
  communesWithoutBasin,
}: {
  bassinsPour100kHab: number;
  surface: number;
  population: number;
  licences: number;
  communesWithLicences: number;
  communesWithoutBasin: number;
}): TerritoryMetricsSummary {
  return {
    bassinsPour100kHab,
    surfaceM2Pour1000Hab: safeDivide(surface, population) * 1000,
    licencesFfnPour100M2: safeDivide(licences, surface) * 100,
    communesSansBassinParmiLicenciees: safeDivide(communesWithoutBasin, communesWithLicences),
  };
}

function buildRankMap<T extends { epci_code: string }>(
  items: T[],
  getValue: (item: T) => number | null,
) {
  const rankedItems = items
    .map((item) => ({
      epci_code: item.epci_code,
      value: getValue(item),
    }))
    .filter(
      (item): item is { epci_code: string; value: number } =>
        item.value !== null && item.value !== undefined && Number.isFinite(Number(item.value)),
    )
    .sort((left, right) => Number(right.value) - Number(left.value));

  if (rankedItems.length === 0) {
    return new Map<string, number>();
  }

  if (rankedItems.length === 1) {
    return new Map([[rankedItems[0].epci_code, 1]]);
  }

  return new Map(
    rankedItems.map((item, index) => [item.epci_code, 1 - index / (rankedItems.length - 1)]),
  );
}

function buildOrdinalRankMap<T extends { epci_code: string }>(
  items: T[],
  getScore: (item: T) => number,
) {
  return new Map(
    [...items]
      .sort((left, right) => {
        const scoreGap = getScore(right) - getScore(left);
        if (scoreGap !== 0) {
          return scoreGap;
        }
        return left.epci_code.localeCompare(right.epci_code);
      })
      .map((item, index) => [item.epci_code, index + 1]),
  );
}

function toRawRows<T extends object>(rows: T[]) {
  return rows as unknown as GenericRecord[];
}

function filterRowsByDepartment(rows: GenericRecord[], selectedDepartment: string) {
  if (selectedDepartment === "all") {
    return rows;
  }

  return rows.filter((row) => {
    const departmentCode = row.code_departement ?? row.dep_code;
    if (typeof departmentCode === "string") {
      return departmentCode.padStart(2, "0") === selectedDepartment;
    }
    if (typeof departmentCode === "number") {
      return `${departmentCode}`.padStart(2, "0") === selectedDepartment;
    }
    return true;
  });
}

function rowMatchesSearch(row: GenericRecord, query: string) {
  return Object.values(row).some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(query),
  );
}

function formatRawValue(value: GenericRecord[string]) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? formatInteger(value) : formatNumber(value, value < 1 ? 3 : 2);
  }
  return String(value);
}

function sumBy<T>(items: T[], key: keyof T) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

function safeDivide(numerator: number, denominator: number) {
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildSchoolDemandSummary(
  schools: SchoolEstablishmentRecord[],
  basinsTotal: number,
  installationsTotal: number,
  schoolBasinsTotal: number,
): SchoolDemandOverview {
  const studentsTotal = sumBy(schools, "students_total");
  const primaryStudents = sumBy(schools, "primary_students");
  const secondaryStudents = sumBy(schools, "secondary_students");
  const geolocatedSchools = schools.filter(
    (item) =>
      typeof item.latitude === "number" &&
      Number.isFinite(item.latitude) &&
      typeof item.longitude === "number" &&
      Number.isFinite(item.longitude),
  );
  const schoolsWithDistances = schools.filter(
    (item) =>
      typeof item.distance_to_nearest_installation_km === "number" &&
      Number.isFinite(item.distance_to_nearest_installation_km),
  );
  const studentsGeolocatedTotal = sumBy(schoolsWithDistances, "students_total");
  const studentsWithin5Km = schoolsWithDistances
    .filter((item) => (item.distance_to_nearest_installation_km ?? Number.POSITIVE_INFINITY) <= 5)
    .reduce((total, item) => total + item.students_total, 0);
  const schoolsWithDriveTimes = schools.filter(
    (item) =>
      typeof item.drive_time_to_nearest_installation_min === "number" &&
      Number.isFinite(item.drive_time_to_nearest_installation_min),
  );
  const studentsWithDriveTimes = sumBy(schoolsWithDriveTimes, "students_total");
  const studentsWithin15Min = schoolsWithDriveTimes
    .filter((item) => (item.drive_time_to_nearest_installation_min ?? Number.POSITIVE_INFINITY) <= 15)
    .reduce((total, item) => total + item.students_total, 0);

  return {
    schools_total: schools.length,
    schools_geolocated_total: geolocatedSchools.length,
    students_total: studentsTotal,
    students_geolocated_total: studentsGeolocatedTotal,
    primary_students: primaryStudents,
    secondary_students: secondaryStudents,
    distance_coverage_share: safeDivide(studentsGeolocatedTotal, studentsTotal),
    drive_time_coverage_share: safeDivide(studentsWithDriveTimes, studentsTotal),
    average_distance_to_installation_km: weightedAverageByStudents(
      schoolsWithDistances,
      (item) => item.distance_to_nearest_installation_km,
    ),
    average_drive_time_to_installation_min: weightedAverageByStudents(
      schoolsWithDriveTimes,
      (item) => item.drive_time_to_nearest_installation_min,
    ),
    average_drive_distance_to_installation_km: weightedAverageByStudents(
      schoolsWithDriveTimes,
      (item) => item.drive_distance_to_nearest_installation_km,
    ),
    average_distance_to_basin_km: weightedAverageByStudents(
      schools.filter(
        (item) =>
          typeof item.distance_to_nearest_basin_km === "number" &&
          Number.isFinite(item.distance_to_nearest_basin_km),
      ),
      (item) => item.distance_to_nearest_basin_km,
    ),
    students_within_5km_installation_share: safeDivide(studentsWithin5Km, studentsGeolocatedTotal),
    students_within_15min_installation_share: safeDivide(studentsWithin15Min, studentsWithDriveTimes),
    basins_total: basinsTotal,
    installations_total: installationsTotal,
    school_basins_total: schoolBasinsTotal,
    students_per_basin: safeDivide(studentsTotal, basinsTotal),
    students_per_installation: safeDivide(studentsTotal, installationsTotal),
    students_per_school_basin: safeDivide(studentsTotal, schoolBasinsTotal),
  };
}

function buildAccessibilitySummary(
  communes: CommuneAccessibilityRecord[],
  installationsTotal: number,
): AccessibilityOverview {
  const routedCommunes = communes.filter(
    (item) =>
      typeof item.drive_time_to_nearest_installation_min === "number" &&
      Number.isFinite(item.drive_time_to_nearest_installation_min),
  );
  const populationTotal = sumBy(communes, "population_2023");
  const populationRoutedTotal = sumBy(routedCommunes, "population_2023");

  return {
    communes_total: communes.length,
    communes_routed_total: routedCommunes.length,
    population_total: populationTotal,
    population_routed_total: populationRoutedTotal,
    installations_total: installationsTotal,
    reachable_installations_total: countUnique(
      routedCommunes.map((item) => item.nearest_installation_id),
    ),
    average_drive_time_to_installation_min: weightedAverageByPopulation(
      routedCommunes,
      (item) => item.drive_time_to_nearest_installation_min,
    ),
    average_drive_distance_to_installation_km: weightedAverageByPopulation(
      routedCommunes,
      (item) => item.drive_distance_to_nearest_installation_km,
    ),
    population_within_10min_share: safeDivide(
      routedCommunes
        .filter((item) => (item.drive_time_to_nearest_installation_min ?? Number.POSITIVE_INFINITY) <= 10)
        .reduce((total, item) => total + item.population_2023, 0),
      populationRoutedTotal,
    ),
    population_within_15min_share: safeDivide(
      routedCommunes
        .filter((item) => (item.drive_time_to_nearest_installation_min ?? Number.POSITIVE_INFINITY) <= 15)
        .reduce((total, item) => total + item.population_2023, 0),
      populationRoutedTotal,
    ),
    population_within_20min_share: safeDivide(
      routedCommunes
        .filter((item) => (item.drive_time_to_nearest_installation_min ?? Number.POSITIVE_INFINITY) <= 20)
        .reduce((total, item) => total + item.population_2023, 0),
      populationRoutedTotal,
    ),
    communes_within_10min_share: safeDivide(
      routedCommunes.filter(
        (item) => (item.drive_time_to_nearest_installation_min ?? Number.POSITIVE_INFINITY) <= 10,
      ).length,
      routedCommunes.length,
    ),
    communes_within_15min_share: safeDivide(
      routedCommunes.filter(
        (item) => (item.drive_time_to_nearest_installation_min ?? Number.POSITIVE_INFINITY) <= 15,
      ).length,
      routedCommunes.length,
    ),
    communes_within_20min_share: safeDivide(
      routedCommunes.filter(
        (item) => (item.drive_time_to_nearest_installation_min ?? Number.POSITIVE_INFINITY) <= 20,
      ).length,
      routedCommunes.length,
    ),
  };
}

function buildTransitSummary(
  communes: CommuneTransitRecord[],
  installations: InstallationTransitRecord[],
  schools: SchoolEstablishmentRecord[],
  transitHubsTotal: number,
): TransitOverview {
  const geolocatedCommunes = communes.filter(
    (item) =>
      typeof item.nearest_transit_distance_km === "number" &&
      Number.isFinite(item.nearest_transit_distance_km),
  );
  const geolocatedInstallations = installations.filter(
    (item) =>
      typeof item.nearest_transit_distance_km === "number" &&
      Number.isFinite(item.nearest_transit_distance_km),
  );
  const geolocatedSchools = schools.filter(
    (item) =>
      typeof item.nearest_transit_distance_km === "number" &&
      Number.isFinite(item.nearest_transit_distance_km),
  ) as Array<SchoolEstablishmentRecord & { nearest_transit_distance_km: number }>;
  const populationTotal = sumBy(communes, "population_2023");
  const populationGeolocatedTotal = sumBy(geolocatedCommunes, "population_2023");
  const studentsTotal = sumBy(schools, "students_total");
  const studentsGeolocatedTotal = sumBy(geolocatedSchools, "students_total");

  return {
    communes_total: communes.length,
    communes_geolocated_total: geolocatedCommunes.length,
    population_total: populationTotal,
    population_geolocated_total: populationGeolocatedTotal,
    transit_hubs_total: transitHubsTotal,
    average_nearest_stop_distance_km: weightedAverageByPopulation(
      geolocatedCommunes,
      (item) => item.nearest_transit_distance_km,
    ),
    average_weekday_trips_within_1000m: weightedAverageByPopulation(
      geolocatedCommunes,
      (item) => item.weekday_trips_within_1000m,
    ),
    population_within_500m_share: safeDivide(
      geolocatedCommunes
        .filter((item) => (item.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY) <= 0.5)
        .reduce((total, item) => total + item.population_2023, 0),
      populationGeolocatedTotal,
    ),
    population_within_1000m_share: safeDivide(
      geolocatedCommunes
        .filter((item) => (item.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY) <= 1)
        .reduce((total, item) => total + item.population_2023, 0),
      populationGeolocatedTotal,
    ),
    communes_within_500m_share: safeDivide(
      geolocatedCommunes.filter(
        (item) => (item.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY) <= 0.5,
      ).length,
      geolocatedCommunes.length,
    ),
    communes_within_1000m_share: safeDivide(
      geolocatedCommunes.filter(
        (item) => (item.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY) <= 1,
      ).length,
      geolocatedCommunes.length,
    ),
    installations_total: installations.length,
    installations_geolocated_total: geolocatedInstallations.length,
    installations_within_500m_share: safeDivide(
      geolocatedInstallations.filter(
        (item) => (item.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY) <= 0.5,
      ).length,
      geolocatedInstallations.length,
    ),
    installations_within_1000m_share: safeDivide(
      geolocatedInstallations.filter(
        (item) => (item.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY) <= 1,
      ).length,
      geolocatedInstallations.length,
    ),
    schools_total: schools.length,
    students_total: studentsTotal,
    students_geolocated_total: studentsGeolocatedTotal,
    average_school_nearest_stop_distance_km: weightedAverageByStudents(
      geolocatedSchools,
      (item) => item.nearest_transit_distance_km,
    ),
    students_within_500m_share: safeDivide(
      geolocatedSchools
        .filter((item) => (item.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY) <= 0.5)
        .reduce((total, item) => total + item.students_total, 0),
      studentsGeolocatedTotal,
    ),
    students_within_1000m_share: safeDivide(
      geolocatedSchools
        .filter((item) => (item.nearest_transit_distance_km ?? Number.POSITIVE_INFINITY) <= 1)
        .reduce((total, item) => total + item.students_total, 0),
      studentsGeolocatedTotal,
    ),
  };
}

function weightedAverageByStudents<T extends { students_total: number }>(
  items: T[],
  getValue: (item: T) => number | null,
) {
  const totals = items.reduce(
    (accumulator, item) => {
      const value = getValue(item);
      if (typeof value !== "number" || !Number.isFinite(value) || item.students_total <= 0) {
        return accumulator;
      }

      return {
        numerator: accumulator.numerator + value * item.students_total,
        denominator: accumulator.denominator + item.students_total,
      };
    },
    { numerator: 0, denominator: 0 },
  );

  return totals.denominator > 0 ? totals.numerator / totals.denominator : 0;
}

function weightedAverageByPopulation<T extends { population_2023: number }>(
  items: T[],
  getValue: (item: T) => number | null,
) {
  const totals = items.reduce(
    (accumulator, item) => {
      const value = getValue(item);
      if (typeof value !== "number" || !Number.isFinite(value) || item.population_2023 <= 0) {
        return accumulator;
      }

      return {
        numerator: accumulator.numerator + value * item.population_2023,
        denominator: accumulator.denominator + item.population_2023,
      };
    },
    { numerator: 0, denominator: 0 },
  );

  return totals.denominator > 0 ? totals.numerator / totals.denominator : 0;
}

function shortDepartment(label: string) {
  const parts = label.split(" - ");
  return parts.at(-1) ?? label;
}

function shortenEpci(label: string, maxLength = 36) {
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, Math.max(1, maxLength - 3))}...`;
}

function summarizeMapManagementLabel(labels: string[]) {
  const uniqueLabels = Array.from(new Set(labels.filter(Boolean)));
  if (uniqueLabels.length === 1) {
    return uniqueLabels[0];
  }
  return "Gestion mixte";
}

function getManagementColor(label: string) {
  if (label === "Gestion mixte") {
    return "#7a6f5a";
  }
  return MANAGEMENT_COLORS[label] ?? "#666666";
}

function hasCoordinates(item: Pick<BasinRecord, "latitude" | "longitude">) {
  return Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
}

function buildEquipmentMapPoints(items: OperationalBasinRecord[]): FacilityMapPoint[] {
  return items.filter(hasCoordinates).map((item) => ({
    kind: "point",
    id: item.id_equipement,
    displayMode: "equipments",
    installationId: item.id_installation || item.id_equipement,
    equipmentId: item.id_equipement,
    installation: item.installation,
    equipment: item.equipement,
    typeLabel: item.type_equipement,
    commune: item.commune,
    departement: item.departement,
    latitude: item.latitude,
    longitude: item.longitude,
    managementLabel: item.mode_gestion_calcule,
    operational_status_code: item.operational_status_code,
    operational_status_label: item.operational_status_label,
    operational_status_reason: item.operational_status_reason,
    status_source: item.status_source,
    usage_scolaires: item.usage_scolaires,
    qpv_flag: item.qpv_flag,
    qpv_200m_flag: item.qpv_200m_flag,
    surface_bassin_m2: item.surface_bassin_m2,
    equipmentCount: 1,
    basinCount: 1,
  }));
}

function buildInstallationMapPoints(items: OperationalBasinRecord[]): FacilityMapPoint[] {
  const groups = new Map<string, OperationalBasinRecord[]>();
  items.forEach((item) => {
    if (!hasCoordinates(item)) {
      return;
    }
    const key = item.id_installation || item.id_equipement;
    const rows = groups.get(key) ?? [];
    rows.push(item);
    groups.set(key, rows);
  });

  return Array.from(groups.entries()).map(([installationId, rows]) => {
    const primary = [...rows].sort((left, right) => {
      const priorityGap =
        getOperationalStatusPriority(left.operational_status_code) -
        getOperationalStatusPriority(right.operational_status_code);
      if (priorityGap !== 0) {
        return priorityGap;
      }
      return left.equipement.localeCompare(right.equipement, "fr");
    })[0];
    const latitude = average(rows.map((item) => item.latitude).filter((value): value is number => Number.isFinite(value)));
    const longitude = average(rows.map((item) => item.longitude).filter((value): value is number => Number.isFinite(value)));

    return {
      kind: "point",
      id: installationId,
      displayMode: "installations",
      installationId,
      equipmentId: primary.id_equipement,
      installation: primary.installation,
      equipment: null,
      typeLabel: null,
      commune: primary.commune,
      departement: primary.departement,
      latitude,
      longitude,
      managementLabel: summarizeMapManagementLabel(rows.map((item) => item.mode_gestion_calcule)),
      operational_status_code: primary.operational_status_code,
      operational_status_label: primary.operational_status_label,
      operational_status_reason: primary.operational_status_reason,
      status_source: primary.status_source,
      usage_scolaires: rows.some((item) => item.usage_scolaires === 1) ? 1 : 0,
      qpv_flag: rows.some((item) => item.qpv_flag === 1) ? 1 : 0,
      qpv_200m_flag: rows.some((item) => item.qpv_200m_flag === 1) ? 1 : 0,
      surface_bassin_m2: rows.reduce((sum, item) => sum + (item.surface_bassin_m2 ?? 0), 0) || null,
      equipmentCount: countUnique(rows.map((item) => item.id_equipement)),
      basinCount: rows.length,
    };
  });
}

function getFacilityMapClusterGridSize(zoom: number) {
  if (zoom >= 10) {
    return 0;
  }
  if (zoom >= 9) {
    return 0.07;
  }
  if (zoom >= 8) {
    return 0.12;
  }
  return 0.2;
}

function buildFacilityMapDisplayItems(points: FacilityMapPoint[], zoom: number): Array<FacilityMapPoint | FacilityMapCluster> {
  const gridSize = getFacilityMapClusterGridSize(zoom);
  if (gridSize <= 0) {
    return points;
  }

  const groups = new Map<string, FacilityMapPoint[]>();
  points.forEach((point) => {
    const gridKey = `${Math.round(point.latitude / gridSize)}:${Math.round(point.longitude / gridSize)}`;
    const rows = groups.get(gridKey) ?? [];
    rows.push(point);
    groups.set(gridKey, rows);
  });

  return Array.from(groups.entries()).flatMap(([gridKey, rows]) => {
    if (rows.length === 1) {
      return rows;
    }

    const latitude = average(rows.map((item) => item.latitude));
    const longitude = average(rows.map((item) => item.longitude));
    const primary = [...rows].sort((left, right) => {
      const priorityGap =
        getOperationalStatusPriority(left.operational_status_code) -
        getOperationalStatusPriority(right.operational_status_code);
      if (priorityGap !== 0) {
        return priorityGap;
      }
      return left.installation.localeCompare(right.installation, "fr");
    })[0];
    const statusBreakdown = OPERATIONAL_STATUS_LEGEND.map((status) => ({
      code: status.key,
      label: status.label,
      count: rows.filter((item) => item.operational_status_code === status.key).length,
    })).filter((item) => item.count > 0);
    const managementCounters = new Map<string, number>();
    rows.forEach((item) => {
      managementCounters.set(item.managementLabel, (managementCounters.get(item.managementLabel) ?? 0) + 1);
    });
    const managementBreakdown = Array.from(managementCounters.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count);

    return [
      {
        kind: "cluster" as const,
        id: `cluster-${gridKey}-${rows[0].displayMode}`,
        displayMode: rows[0].displayMode,
        latitude,
        longitude,
        count: rows.length,
        managementLabel: summarizeMapManagementLabel(rows.map((item) => item.managementLabel)),
        operational_status_code: primary.operational_status_code,
        operational_status_label:
          statusBreakdown.length === 1 ? primary.operational_status_label : `${rows.length} repères regroupés`,
        samplePoints: rows
          .slice()
          .sort((left, right) => left.installation.localeCompare(right.installation, "fr"))
          .slice(0, 5),
        managementBreakdown,
        statusBreakdown,
      },
    ];
  });
}

function createFacilityClusterIcon(cluster: FacilityMapCluster) {
  const fillColor = getManagementColor(cluster.managementLabel);
  const borderColor = OPERATIONAL_STATUS_COLORS[cluster.operational_status_code] ?? "#666666";
  const size = cluster.count >= 10 ? 40 : cluster.count >= 5 ? 36 : 32;
  return divIcon({
    className: "facility-cluster-shell",
    html: `<span class="facility-cluster-icon" style="--cluster-fill:${fillColor}; --cluster-stroke:${borderColor}; width:${size}px; height:${size}px;">${cluster.count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function MapZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend() {
      onZoomChange(map.getZoom());
    },
  });

  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);

  return null;
}

function MapAutoFocusController({
  points,
  searchTerm,
  focusedPoint,
}: {
  points: FacilityMapPoint[];
  searchTerm: string;
  focusedPoint: FacilityMapPoint | null;
}) {
  const map = useMap();
  const lastFocusedPointIdRef = useRef("");
  const lastSearchSignatureRef = useRef("");

  useEffect(() => {
    if (!focusedPoint) {
      lastFocusedPointIdRef.current = "";
      return;
    }
    if (lastFocusedPointIdRef.current === focusedPoint.id) {
      return;
    }
    lastFocusedPointIdRef.current = focusedPoint.id;
    map.flyTo(
      [focusedPoint.latitude, focusedPoint.longitude],
      Math.max(map.getZoom(), focusedPoint.displayMode === "installations" ? 11 : 12),
      { duration: 0.65 },
    );
  }, [focusedPoint, map]);

  useEffect(() => {
    if (!searchTerm) {
      lastSearchSignatureRef.current = "";
      return;
    }

    const visiblePoints = points.filter(
      (item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude),
    );
    const signature = `${searchTerm}|${visiblePoints.map((item) => item.id).join("|")}`;
    if (lastSearchSignatureRef.current === signature) {
      return;
    }
    lastSearchSignatureRef.current = signature;

    if (visiblePoints.length === 0) {
      return;
    }

    if (visiblePoints.length === 1) {
      const [target] = visiblePoints;
      map.flyTo(
        [target.latitude, target.longitude],
        Math.max(map.getZoom(), target.displayMode === "installations" ? 11 : 12),
        { duration: 0.65 },
      );
      return;
    }

    map.fitBounds(
      latLngBounds(visiblePoints.map((item) => [item.latitude, item.longitude] as [number, number])),
      {
        padding: [32, 32],
        maxZoom: 10,
      },
    );
  }, [map, points, searchTerm]);

  return null;
}

function FacilityMapClusterMarker({ cluster }: { cluster: FacilityMapCluster }) {
  const map = useMap();
  const icon = useMemo(() => createFacilityClusterIcon(cluster), [cluster]);

  return (
    <Marker
      position={[cluster.latitude, cluster.longitude]}
      icon={icon}
      eventHandlers={{
        click() {
          map.flyTo([cluster.latitude, cluster.longitude], Math.min(map.getZoom() + 2, 12));
        },
      }}
    >
      <Popup>
        <div className="popup-card">
          <strong>
            {formatInteger(cluster.count)} {cluster.displayMode === "equipments" ? "équipements" : "installations"} regroupés
          </strong>
          <span>Zoom actuel trop large pour détailler chaque point individuellement.</span>
          <div className="popup-tags">
            {cluster.statusBreakdown.map((item) => (
              <span key={item.code} className={`status-pill status-pill-${item.code.replace(/_/g, "-")}`}>
                {item.label} · {formatInteger(item.count)}
              </span>
            ))}
          </div>
          <div className="popup-list">
            {cluster.samplePoints.map((item) => (
              <span key={item.id}>
                {item.installation} · {item.commune}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => map.flyTo([cluster.latitude, cluster.longitude], Math.min(map.getZoom() + 2, 12))}
          >
            Zoomer ici
          </button>
        </div>
      </Popup>
    </Marker>
  );
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
}

function formatYear(value: number) {
  return String(Math.round(value));
}

function formatNumber(value: number, digits: number) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatKilometers(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "n.c.";
  }
  return `${formatNumber(value, 1)} km`;
}

function formatMinutes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "n.c.";
  }
  return `${formatNumber(value, 1)} min`;
}

function formatSignedInteger(value: number) {
  if (value === 0) {
    return "0";
  }
  return `${value > 0 ? "+" : "-"}${formatInteger(Math.abs(value))}`;
}

function formatSignedNumber(value: number, digits: number) {
  if (value === 0) {
    return formatNumber(0, digits);
  }
  return `${value > 0 ? "+" : "-"}${formatNumber(Math.abs(value), digits)}`;
}

function formatMetricByKind(value: number, kind: MetricKind) {
  if (kind === "percent") {
    return formatPercent(value);
  }
  if (kind === "year") {
    return formatYear(value);
  }
  if (kind === "count") {
    return formatInteger(value);
  }
  if (kind === "duration") {
    return formatMinutes(value);
  }
  if (kind === "distance") {
    return formatKilometers(value);
  }
  return formatNumber(value, 2);
}

function formatSignedPercent(value: number) {
  if (value === 0) {
    return formatPercent(0);
  }
  return `${value > 0 ? "+" : "-"}${formatPercent(Math.abs(value))}`;
}

function formatSignedMetricByKind(value: number, kind: MetricKind) {
  if (kind === "percent") {
    return formatSignedPercent(value);
  }
  if (kind === "year") {
    return formatSignedInteger(Math.round(value));
  }
  if (kind === "count") {
    return formatSignedInteger(value);
  }
  if (kind === "duration") {
    return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatMinutes(Math.abs(value))}`;
  }
  if (kind === "distance") {
    return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatKilometers(Math.abs(value))}`;
  }
  return formatSignedNumber(value, 2);
}

function formatOptionalMetric(value: number | null, kind: MetricKind) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "n.c.";
  }
  return formatMetricByKind(Number(value), kind);
}

function formatOptionalMeasure(value: number, suffix: string, digits = 1) {
  if (!Number.isFinite(value) || value <= 0) {
    return "n.c.";
  }
  return `${formatNumber(value, digits)} ${suffix}`;
}

function getDeltaArrow(value: number) {
  if (value > 0) {
    return "↑";
  }
  if (value < 0) {
    return "↓";
  }
  return "→";
}

function formatIndexScore(value: number) {
  return `${formatInteger(Math.round(value * 100))}/100`;
}

function formatScore(value: number) {
  return `${formatInteger(Math.round(value))}/100`;
}

function formatRankPosition(rank: number | undefined, total: number) {
  if (!rank || total === 0) {
    return "Rang n.c.";
  }
  return `#${formatInteger(rank)} / ${formatInteger(total)}`;
}

function getProfileToneClass(profile: string) {
  if (profile.includes("Sous-équipement")) {
    return "profile-alert";
  }
  if (profile.includes("Déficit")) {
    return "profile-coverage";
  }
  if (profile.includes("Sous-dotation")) {
    return "profile-coverage";
  }
  if (profile.includes("Tension")) {
    return "profile-pressure";
  }
  if (profile.includes("Impact")) {
    return "profile-reference";
  }
  if (profile.includes("fragile")) {
    return "profile-watch";
  }
  return "profile-reference";
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatDateOnly(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
  }).format(new Date(iso));
}

export default App;
