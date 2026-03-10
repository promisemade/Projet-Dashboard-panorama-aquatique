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
import type {
  AgeSexRecord,
  BasinRecord,
  CommuneRecord,
  DashboardData,
  EpciRecord,
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
  | "sources";

type DashboardTab = "overview" | "territories" | "facilities" | "licences" | "data";
type InvestigationLens = "priority" | "offer_gap" | "pressure" | "impact";
type InvestigationComponentLens = Exclude<InvestigationLens, "priority">;
type InvestigationIndexKey = "offerGapIndex" | "pressureIndex" | "impactIndex";

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

interface InvestigationScoreDefinition {
  lens: InvestigationComponentLens;
  indexKey: InvestigationIndexKey;
  label: string;
  weight: number;
  description: string;
  metrics: string[];
}

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
    description: "Détail des bassins repérés comme liés à des usages scolaires.",
    exportSlug: "bassins_scolaires",
    getRows: (data) => toRawRows(data.school_basins),
  },
  {
    key: "age_sex",
    label: "09 Âges x sexe",
    sheetName: "09_Ages_dep_sexe",
    description: "Distribution départementale des licences FFN 2024 par âge et sexe.",
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

const RAW_PAGE_SIZE = 20;
const RANKING_LIMIT_OPTIONS = [12, 25, 50, 100] as const;
const INVESTIGATION_PRIORITY_WEIGHTS: Record<InvestigationComponentLens, number> = {
  offer_gap: 0.34,
  pressure: 0.38,
  impact: 0.28,
};
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
const QUADRANT_THRESHOLD = 60;

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
    label: "Bassins",
    description: "Explorer le parc aquatique, ses gestions, ses usages scolaires et sa cartographie.",
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

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedEpciCode, setSelectedEpciCode] = useState("all");
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("bassins_total");
  const [investigationLens, setInvestigationLens] = useState<InvestigationLens>("priority");
  const [rankingLimit, setRankingLimit] = useState<(typeof RANKING_LIMIT_OPTIONS)[number]>(25);
  const [managementFilter, setManagementFilter] = useState("all");
  const [basinUsageFilter, setBasinUsageFilter] = useState("all");
  const [epciSearch, setEpciSearch] = useState("");
  const [basinSearch, setBasinSearch] = useState("");
  const [selectedRawSheet, setSelectedRawSheet] = useState<RawSheetKey>("epci");
  const [rawSearch, setRawSearch] = useState("");
  const [rawPage, setRawPage] = useState(1);
  const territoryPanelRef = useRef<HTMLElement | null>(null);
  const pendingTerritoryJumpRef = useRef(false);

  const deferredEpciSearch = useDeferredValue(epciSearch.trim().toLowerCase());
  const deferredBasinSearch = useDeferredValue(basinSearch.trim().toLowerCase());
  const deferredRawSearch = useDeferredValue(rawSearch.trim().toLowerCase());

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/dashboard.json`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Impossible de charger les données (${response.status}).`);
        }
        const payload = (await response.json()) as DashboardData;
        setData(payload);
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
      .filter((item) => {
        if (!deferredBasinSearch) {
          return true;
        }
        return `${item.installation} ${item.equipement} ${item.commune} ${item.epci_nom}`
          .toLowerCase()
          .includes(deferredBasinSearch);
      });
  }, [basinUsageFilter, deferredBasinSearch, managementFilter, scopedBasins]);

  const filteredCommunes = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.communes.filter(
      (item) => selectedDepartment === "all" || item.code_departement === selectedDepartment,
    );
  }, [data, selectedDepartment]);

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

  const activeMetricOption = METRIC_OPTIONS.find((item) => item.key === selectedMetric) ?? METRIC_OPTIONS[0];
  const activeInvestigationLens =
    INVESTIGATION_LENS_OPTIONS.find((item) => item.key === investigationLens) ?? INVESTIGATION_LENS_OPTIONS[0];

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

  useEffect(() => {
    if (
      selectedEpciCode !== "all" &&
      !territoryEpciOptions.some((item) => item.epci_code === selectedEpciCode)
    ) {
      setSelectedEpciCode("all");
    }
  }, [selectedEpciCode, territoryEpciOptions]);

  useEffect(() => {
    if (activeTab !== "territories" || selectedEpciCode === "all" || !pendingTerritoryJumpRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      territoryPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      pendingTerritoryJumpRef.current = false;
    }, 70);

    return () => window.clearTimeout(timeoutId);
  }, [activeTab, selectedEpciCode]);

  const activeEpci = territoryEpciOptions.find((item) => item.epci_code === selectedEpciCode) ?? null;

  function openTerritoryCard(epciCode: string) {
    pendingTerritoryJumpRef.current = true;
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
        const priorityScore =
          (offerGapIndex * INVESTIGATION_PRIORITY_WEIGHTS.offer_gap +
            pressureIndex * INVESTIGATION_PRIORITY_WEIGHTS.pressure +
            impactIndex * INVESTIGATION_PRIORITY_WEIGHTS.impact) *
          100;
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
      if (selectedEpciCode !== "all") {
        pills.push(`Territoire : ${territoryName}`);
      }
      if (epciSearch) {
        pills.push(`Recherche EPCI : ${epciSearch}`);
      }
    }

    if (activeTab === "facilities") {
      if (managementFilter !== "all") {
        pills.push(`Gestion : ${managementFilter}`);
      }
      if (basinUsageFilter === "school") {
        pills.push("Usage : scolaires");
      }
      if (basinUsageFilter === "qpv") {
        pills.push("Usage : QPV ou 200 m");
      }
      if (basinSearch) {
        pills.push(`Recherche bassin : ${basinSearch}`);
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
    managementFilter,
    rawSearch,
    selectedDepartment,
    selectedEpciCode,
    territoryName,
  ]);

  const activeTabOption = TAB_OPTIONS.find((item) => item.key === activeTab) ?? TAB_OPTIONS[0];
  const epciChartHeight = Math.max(420, epciRanking.length * 40);

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
            <strong>{data.meta.source_summary}</strong>
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

      <section className="active-filters" aria-label="Filtres actifs">
        {activeFilterPills.map((pill) => (
          <span key={pill} className="filter-pill">
            {pill}
          </span>
        ))}
      </section>

      {activeTab === "overview" ? (
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

      {activeTab === "territories" ? (
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
                La lecture active trie la table, mais les trois sous-scores restent visibles.
              </p>
            </div>

            {rankedInvestigationRows.length > 0 ? (
              <div className="table-scroll">
                <div className="investigation-table">
                  <div className="investigation-head-row">
                    <span>Rang</span>
                    <span>Territoire</span>
                    <span>Lecture du score</span>
                    <span>Indicateurs actifs et signaux</span>
                    <span>Hypothèse d&apos;investigation</span>
                    <span>Fiche</span>
                  </div>
                  {rankedInvestigationRows.map((item, index) => (
                    <div
                      key={item.epci_code}
                      className={`investigation-row ${selectedEpciCode === item.epci_code ? "selected" : ""}`}
                    >
                      <div className="investigation-rank">
                        <strong>#{index + 1}</strong>
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
                        <small>
                          {shortDepartment(item.departement)} · {formatInteger(item.population)} hab.
                          · {formatInteger(item.bassins)} bassins · {formatInteger(item.licences)}{" "}
                          licences
                        </small>
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
                      <div className="investigation-action">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => openTerritoryCard(item.epci_code)}
                        >
                          Ouvrir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="subtle-empty">Aucun EPCI n'est disponible dans le périmètre actif.</p>
            )}
          </section>

          <section ref={territoryPanelRef} className="panel territory-panel">
            <div className="territory-header">
              <div>
                <span className="eyebrow">Fiche territoire</span>
                <h2>{territoryName}</h2>
                <p>{territorySubtitle}</p>
              </div>

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
            </div>

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

            <div className="territory-detail-grid">
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
                          <small>{item.typo}</small>
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
            </div>
          </section>
        </>
      ) : null}

      {activeTab === "facilities" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel map-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Cartographie bassin</span>
                <h2>Localisation des équipements aquatiques</h2>
              </div>
              <p>{formatInteger(mapPoints.length)} points affichés après filtres.</p>
            </div>

            <div className="panel-heading-actions">
              <div className="compact-control compact-control-wide">
                <label htmlFor="basin-search">Recherche bassin</label>
                <input
                  id="basin-search"
                  type="search"
                  placeholder="Commune, installation, équipement..."
                  value={basinSearch}
                  onChange={(event) => setBasinSearch(event.target.value)}
                />
              </div>
            </div>

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
                        <span>{item.commune}</span>
                        <span>{item.mode_gestion_calcule}</span>
                        <span>
                          {item.surface_bassin_m2
                            ? `${formatNumber(item.surface_bassin_m2, 0)} m²`
                            : "Surface n.c."}
                        </span>
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
                <span className="eyebrow">Gestion des bassins</span>
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
              <p className="subtle-empty">Aucun bassin ne correspond aux filtres actuels.</p>
            )}
          </article>
        </section>
      ) : null}

      {activeTab === "licences" ? (
        <section className="content-grid content-grid-wide">
          <article className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Licences 2024</span>
                <h2>Structure par âge et sexe</h2>
              </div>
              <p>Distribution FFN à l'échelle {selectedDepartment === "all" ? "régionale" : "départementale"}.</p>
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
          </article>
        </section>
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
          <small>34 % sous-équipement + 38 % tension + 28 % impact</small>
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

function classifyInvestigationProfile(
  offerGapIndex: number,
  pressureIndex: number,
  impactIndex: number,
) {
  if (offerGapIndex >= 0.62 && pressureIndex >= 0.64) {
    return "Sous-équipement sous tension";
  }
  if (pressureIndex >= 0.68 && impactIndex >= 0.72) {
    return "Tension d'usage à fort impact";
  }
  if (offerGapIndex >= 0.62 && impactIndex >= 0.68) {
    return "Déficit structurant";
  }
  if (offerGapIndex >= 0.62) {
    return "Sous-dotation de couverture";
  }
  if (pressureIndex >= 0.64) {
    return "Tension d'usage";
  }
  if (impactIndex >= 0.72) {
    return "Impact territorial élevé";
  }
  if (pressureIndex >= 0.5 || offerGapIndex >= 0.5) {
    return "Équilibre fragile";
  }
  return "Socle intermédiaire";
}

function buildInvestigationHypothesis({
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
}: {
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
}) {
  if (profile === "Sous-équipement sous tension") {
    if (communesSansBassinVolume >= 25 || communesSansBassinShare >= 0.45) {
      return "Vérifier un déficit de couverture structurant : de nombreuses communes contributrices restent sans bassin sur le territoire.";
    }
    if (licencesFfnPour100M2 >= 16 || licencesFfnParBassin >= 140) {
      return "Vérifier une saturation des bassins existants : la pression FFN est élevée au regard de la surface et des équipements disponibles.";
    }
    return "Croiser couverture, capacité réelle et accès interterritorial pour qualifier un manque d'offre.";
  }

  if (profile === "Tension d'usage à fort impact") {
    if (qpvPopulation >= 15000 || qpvShare >= 0.12) {
      return "Territoire de masse critique : besoin potentiellement fort sur les créneaux, avec un enjeu social marqué à documenter.";
    }
    return "Offre existante mais tension élevée sur un territoire de grand poids : utile pour investiguer la saturation réelle des usages.";
  }

  if (profile === "Déficit structurant") {
    return "Le territoire cumule retrait d'offre et poids territorial notable : utile pour tester un besoin d'investissement ou de rééquilibrage.";
  }

  if (profile === "Sous-dotation de couverture") {
    if (surfaceM2Pour1000Hab < 7 || bassinsPour100kHab < 4) {
      return "Approfondir la dépendance aux bassins voisins et la capacité locale à absorber de nouveaux usages.";
    }
    return "Tester d'abord l'accessibilité réelle aux équipements et les écarts entre communes du même EPCI.";
  }

  if (profile === "Tension d'usage") {
    if (licencesFfnPour1000Hab >= 6 || licencesFfnParBassin >= 120) {
      return "Approfondir la saturation des bassins et l'arbitrage des créneaux sur les usages scolaires, clubs et grand public.";
    }
    if (qpvShare >= 0.08) {
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

function buildPriorityDrivers({
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
}: {
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
}) {
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

function getQuadrantBucket(offerGapIndex: number, pressureIndex: number) {
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

function getQuadrantColor(item: Pick<InvestigationProfileRow, "offerGapIndex" | "pressureIndex" | "impactIndex">) {
  const bucket = getQuadrantBucket(item.offerGapIndex, item.pressureIndex);

  if (bucket === "critical") {
    return "#ff8f5c";
  }
  if (bucket === "offer_gap") {
    return "#f2c14e";
  }
  if (bucket === "pressure") {
    return "#0f7c82";
  }
  return "#7aa4be";
}

function getInvestigationScoreByLens(item: InvestigationProfileRow, lens: InvestigationLens) {
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

function getInvestigationContribution(score: number, lens: InvestigationComponentLens) {
  return score * INVESTIGATION_PRIORITY_WEIGHTS[lens];
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

function formatMetricByKind(value: number, kind: MetricKind) {
  if (kind === "percent") {
    return formatPercent(value);
  }
  if (kind === "count") {
    return formatInteger(value);
  }
  return formatNumber(value, 2);
}

function formatOptionalMetric(value: number | null, kind: MetricKind) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "n.c.";
  }
  return formatMetricByKind(Number(value), kind);
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

function getPriorityToneClass(score: number) {
  if (score >= 70) {
    return "priority-high";
  }
  if (score >= 58) {
    return "priority-medium";
  }
  return "priority-low";
}

function getPriorityLabel(score: number) {
  if (score >= 70) {
    return "Très prioritaire";
  }
  if (score >= 58) {
    return "À investiguer";
  }
  return "Repère";
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
