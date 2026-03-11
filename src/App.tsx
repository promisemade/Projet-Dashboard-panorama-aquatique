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
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
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
  AgeSexRecord,
  BasinRecord,
  CommuneRecord,
  DashboardData,
  EpciRecord,
  ExtendedInventoryRecord,
  GenericRecord,
  Overview,
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
  | "extended_inventory";

type DashboardTab = "overview" | "territories" | "facilities" | "licences" | "data";
type OverviewView = "panorama" | "social";
type TerritoriesView = "investigation" | "comparisons" | "territory";
type FacilitiesView = "map" | "scope" | "physical" | "inventory" | "territories";

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

type MetricKind = "count" | "ratio" | "percent";
type InventoryCountMode = "equipments" | "installations";

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
  DSP: "#ff8f5c",
  "Régie publique": "#0f7c82",
  "Autre gestion hors DSP": "#1f4e70",
};

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
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedEpciCode, setSelectedEpciCode] = useState("all");
  const [selectedComparisonEpciCode, setSelectedComparisonEpciCode] = useState("all");
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("bassins_total");
  const [investigationLens, setInvestigationLens] = useState<InvestigationLens>("priority");
  const [rankingLimit, setRankingLimit] = useState<(typeof RANKING_LIMIT_OPTIONS)[number]>(25);
  const [managementFilter, setManagementFilter] = useState("all");
  const [basinUsageFilter, setBasinUsageFilter] = useState("all");
  const [localityTypeFilter, setLocalityTypeFilter] = useState("all");
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
  const deferredRawSearch = useDeferredValue(rawSearch.trim().toLowerCase());

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

  const filteredBasins = useMemo(() => {
    return scopedBasins
      .filter((item) => managementFilter === "all" || item.mode_gestion_calcule === managementFilter)
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
    managementFilter,
    scopedBasins,
  ]);

  const scopedExtendedInventory = useMemo(() => {
    if (!data) {
      return [];
    }

    return (data.extended_inventory ?? []).filter(
      (item) => selectedDepartment === "all" || item.dep_code === selectedDepartment,
    );
  }, [data, selectedDepartment]);

  const filteredExtendedInventory = useMemo(() => {
    return scopedExtendedInventory
      .filter(
        (item) =>
          localityTypeFilter === "all" ||
          (communeTypologyLookup.get(item.code_commune) ??
            formatCommuneTypology(item.typologie_commune_source)) === localityTypeFilter,
      )
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
  }, [communeTypologyLookup, deferredBasinSearch, localityTypeFilter, scopedExtendedInventory]);

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

  const managementBreakdown = useMemo(() => {
    const counters = new Map<string, number>();
    filteredBasins.forEach((item) => {
      counters.set(item.mode_gestion_calcule, (counters.get(item.mode_gestion_calcule) ?? 0) + 1);
    });
    return Array.from(counters.entries()).map(([name, value]) => ({
      name,
      value,
      color: MANAGEMENT_COLORS[name] ?? "#56768c",
    }));
  }, [filteredBasins]);

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

  const mapPoints = useMemo(() => filteredBasins.filter(hasCoordinates), [filteredBasins]);
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
    setBasinSearch("");
  }

  const hasFacilitiesFiltersActive =
    managementFilter !== "all" || basinUsageFilter !== "all" || localityTypeFilter !== "all" || basinSearch !== "";

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
        color: MANAGEMENT_COLORS[name] ?? "#56768c",
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
        label: "Communes licenciées sans bassin",
        kind: "percent" as const,
        primary: territorySummary.communesSansBassinParmiLicenciees,
        comparison: comparisonTerritorySummary.communesSansBassinParmiLicenciees,
      },
    ].map((item) => ({
      ...item,
      delta: item.primary - item.comparison,
    }));
  }, [activeEpci, comparisonEpci, comparisonTerritorySummary, territorySummary]);

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
            <strong>Data.Sports</strong>
          </div>
          <div className="meta-card">
            <span className="meta-label">Données générées</span>
            <strong>{formatDate(data.meta.generated_at)}</strong>
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
                {"La synth\u00e8se est maintenant r\u00e9partie entre un panorama global et une lecture sociale d\u00e9di\u00e9e QPV."}
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
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#d2ddd6" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" tickLine={false} axisLine={false} width={52} />
                    <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={52} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar yAxisId="left" dataKey="bassins_pour_100k_hab" name="Bassins / 100k" radius={[8, 8, 0, 0]}>
                      {departmentComparison.map((item) => (
                        <Cell
                          key={`${item.label}-bassins`}
                          fill={item.highlight ? "#0f7c82" : "#9bc9c1"}
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
                          fill={item.highlight ? "#ff8f5c" : "#ffc5a6"}
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
          <section className="panel">
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
                      <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#d2ddd6" />
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
                            fill={Number(item.value) >= 60 ? "#ff8f5c" : "#1f4e70"}
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
                      <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="#d2ddd6" />
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
                        fill="#1f4e70"
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
                      <CartesianGrid strokeDasharray="4 4" stroke="#d2ddd6" />
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
                      <ReferenceLine x={QUADRANT_THRESHOLD} stroke="#9db3a4" strokeDasharray="6 6" />
                      <ReferenceLine y={QUADRANT_THRESHOLD} stroke="#9db3a4" strokeDasharray="6 6" />
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
                {activeEpci && comparisonEpci && territoryDirectComparisonRows.length > 0 ? (
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
                        {territoryDirectComparisonRows.map((item) => (
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

          {facilitiesView === "map" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel map-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Cartographie équipements</span>
                <h2>Localisation des équipements aquatiques</h2>
              </div>
              <p>{formatInteger(mapPoints.length)} points affichés après filtres.</p>
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
              </div>

              <div className="compact-control">
                <label htmlFor="locality-type-filter">Typologie communale</label>
                <select
                  id="locality-type-filter"
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

              <div className="compact-control">
                <label htmlFor="facility-count-mode">Compter en</label>
                <select
                  id="facility-count-mode"
                  value={inventoryCountMode}
                  onChange={(event) => setInventoryCountMode(event.target.value as InventoryCountMode)}
                >
                  <option value="equipments">Équipements</option>
                  <option value="installations">Installations</option>
                </select>
              </div>
            </div>

            <p className="chart-note">
              Le mode de comptage agit sur les profils, les types et les activités. La carte reste à la
              maille équipement.
            </p>

            <div className="chip-row">
              <button
                type="button"
                className={managementFilter === "all" ? "chip active" : "chip"}
                onClick={() => setManagementFilter("all")}
              >
                Toutes gestions
              </button>
              {Object.keys(MANAGEMENT_COLORS).map((mode) => (
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
            </div>

            <div className="map-inline-legend" aria-label="Légende de la carte">
              {Object.entries(MANAGEMENT_COLORS).map(([mode, color]) => (
                <span key={mode} className="map-inline-legend-item">
                  <span className="map-inline-legend-swatch" style={{ backgroundColor: color }} />
                  {mode}
                </span>
              ))}
              <span className="map-inline-legend-hint">Ctrl + molette ou pinch pour zoomer</span>
            </div>

            <div className="map-wrap">
              <MapContainer center={[50.35, 2.84]} zoom={8} scrollWheelZoom={false}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {mapPoints.map((item) => (
                  <CircleMarker
                    key={item.id_equipement}
                    center={[item.latitude, item.longitude]}
                    radius={4.5}
                    pathOptions={{
                      color: "#ffffff",
                      weight: 1,
                      fillColor: MANAGEMENT_COLORS[item.mode_gestion_calcule] ?? "#56768c",
                      fillOpacity: 0.88,
                    }}
                  >
                    <Popup>
                      <div className="popup-card">
                        <strong>{item.installation}</strong>
                        <span>{item.equipement}</span>
                        <span>{item.type_equipement}</span>
                        <span>{item.commune}</span>
                        <span>{item.mode_gestion_calcule}</span>
                        <span>
                          {item.surface_bassin_m2
                            ? `${formatNumber(item.surface_bassin_m2, 0)} m²`
                            : "Surface n.c."}
                        </span>
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
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          </article>

          <article className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Gestion des équipements</span>
                <h2>Répartition du parc aquatique filtré</h2>
              </div>
              <p>Lecture dynamique selon les filtres de gestion, d'usage scolaires et de recherche libre.</p>
            </div>

            {managementBreakdown.length > 0 ? (
              <>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={managementBreakdown}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={62}
                        outerRadius={98}
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
              </>
            ) : (
              <p className="subtle-empty">Aucun équipement ne correspond aux filtres actuels.</p>
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
          <article className="panel chart-panel">
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
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#d2ddd6" />
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
                  <Bar dataKey="value" fill="#0f7c82" radius={[8, 8, 0, 0]} />
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
                  <h2>Structure par âge et sexe</h2>
                </div>
                <p>
                  Distribution FFN à l'échelle {selectedDepartment === "all" ? "régionale" : "départementale"}.
                </p>
              </div>

              <div className="chart-wrap tall">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ageSeries} margin={{ top: 4, right: 10, bottom: 24, left: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#d2ddd6" />
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
                    <Bar dataKey="Femmes" stackId="a" fill="#ff8f5c" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="Hommes" stackId="a" fill="#0f7c82" radius={[6, 6, 0, 0]} />
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

          <section className="panel table-panel">
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
          entry.payload?.kind === "count"
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
      fill={payload.color ?? "#1f4e70"}
      fillOpacity={0.82}
      stroke={payload.isSelected ? "#0c3240" : "rgba(255, 255, 255, 0.96)"}
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

function hasCoordinates(item: BasinRecord) {
  return Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
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
  if (kind === "count") {
    return formatInteger(value);
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
  if (kind === "count") {
    return formatSignedInteger(value);
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

export default App;
