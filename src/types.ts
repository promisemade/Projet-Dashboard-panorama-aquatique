export interface NoteEntry {
  label: string;
  value: string;
}

export interface SourceEntry {
  jeu: string;
  source: string;
  maille: string;
  millesime: string;
  filtre: string;
  usage_principal: string;
}

export type GenericRecord = Record<string, string | number | null>;

export interface DepartmentRecord {
  code_departement: string;
  departement: string;
  population_2023_communes: number;
  licences_ffn_2023: number;
  licences_ffn_2024_dep: number;
  part_femmes_ffn_2024: number;
  bassins_total: number;
  bassins_dsp: number;
  bassins_regie: number;
  bassins_prive_hors_dsp: number;
  bassins_usage_scolaires: number;
  bassins_site_scolaire_explicit: number;
  bassins_qpv: number;
  bassins_qpv_200m: number;
  surface_totale_bassins_m2: number;
  bassins_pour_100k_hab: number;
  licences_ffn_par_bassin: number;
  licences_ffn_pour_1000hab: number;
  pop_qpv: number;
  part_population_qpv: number;
}

export interface EpciRecord {
  epci_code: string;
  epci_nom: string;
  code_departement: string;
  departement: string;
  population_2023_communes: number;
  communes_total: number;
  communes_avec_licences_ffn: number;
  communes_avec_bassin: number;
  communes_avec_licences_sans_bassin: number;
  nb_qpv: number;
  pop_qpv: number;
  licences_ffn_2023: number;
  licences_hors_scol_2023: number;
  bassins_total: number;
  installations_total: number;
  bassins_dsp: number;
  part_dsp_bassins: number | null;
  bassins_regie: number;
  part_regie_bassins: number | null;
  bassins_prive_hors_dsp: number;
  part_autre_hors_dsp_bassins: number | null;
  bassins_usage_scolaires: number;
  part_bassins_usage_scolaires: number | null;
  bassins_site_scolaire_explicit: number;
  part_bassins_site_scolaire_explicit: number | null;
  bassins_qpv: number;
  bassins_qpv_200m: number;
  surface_totale_bassins_m2: number;
  bassins_pour_100k_hab: number;
  licences_ffn_pour_1000hab: number;
  licences_ffn_par_bassin: number | null;
  part_population_qpv: number;
}

export interface CommuneRecord {
  code_commune: string;
  commune: string;
  code_departement: string;
  departement: string;
  epci_code: string;
  epci_nom: string;
  population_2023: number;
  typo: string;
  licences_ffn_2023: number;
  licences_ffn_pour_1000hab: number;
  pop_qpv: number;
  part_population_qpv: number;
  bassins_total: number;
}

export interface BasinRecord {
  id_equipement: string;
  id_installation: string;
  installation: string;
  equipement: string;
  code_commune: string;
  commune: string;
  dep_code: string;
  departement: string;
  epci_code: string;
  epci_nom: string;
  type_equipement: string;
  categorie: string;
  mode_gestion_calcule: string;
  surface_bassin_m2: number | null;
  longueur_m: number | null;
  largeur_m: number | null;
  profondeur_min_m: number | null;
  profondeur_max_m: number | null;
  nb_couloirs: number | null;
  usage_scolaires: number;
  site_scolaire_explicit: number;
  particularite_installation: string | null;
  qpv_flag: number;
  qpv_200m_flag: number;
  longitude: number;
  latitude: number;
  activites: string | null;
}

export interface AgeSexRecord {
  sexe: string;
  trage_full: string;
  trage: string;
  code_departement: string;
  departement: string;
  licences_ffn_2024: number;
  population_reference: number;
  licences_pour_1000hab: number;
  indice_specificite: number;
}

export interface SexRecord {
  code_departement: string;
  departement: string;
  licences_femmes_2024: number;
  licences_hommes_2024: number;
  licences_total_2024: number;
  part_femmes_2024: number;
}

export interface Overview {
  population_total: number;
  communes_total: number;
  epci_total: number;
  installations_total: number;
  licences_ffn_2023: number;
  licences_ffn_2024: number;
  part_femmes_ffn_2024: number;
  bassins_total: number;
  bassins_dsp: number;
  bassins_regie: number;
  bassins_autre: number;
  bassins_usage_scolaires: number;
  bassins_site_scolaire_explicit: number;
  bassins_qpv: number;
  bassins_qpv_200m: number;
  surface_totale_bassins_m2: number;
  bassins_pour_100k_hab: number;
  licences_ffn_pour_1000hab: number;
  communes_avec_licences_sans_bassin: number;
}

export interface ExtendedInventoryOverview {
  equipments_total: number;
  installations_total: number;
  bassin_family_equipments_total: number;
  bassin_family_installations_total: number;
  non_bassin_family_equipments_total: number;
  non_bassin_family_installations_total: number;
  families_total: number;
  types_total: number;
  activities_total: number;
}

export interface ExtendedInventoryRecord {
  id_equipement: string;
  id_installation: string;
  installation: string;
  equipement: string;
  code_commune: string;
  commune: string;
  epci_code: string | null;
  epci_nom: string | null;
  dep_code: string | null;
  departement: string | null;
  typologie_commune_source: string | null;
  particularite_installation: string | null;
  particularite_installation_brute: string | null;
  famille_equipement: string;
  type_equipement: string;
  code_type_equipement: string | null;
  rnb_id: string | null;
  uai: string | null;
  handicap_access_types: string | null;
  transport_access_modes: string | null;
  opening_authorized_flag: number;
  erp_type: string | null;
  erp_category: string | null;
  year_service: number | null;
  service_period: string | null;
  last_major_works_date: string | null;
  last_major_works_period: string | null;
  last_major_works_year: number | null;
  last_major_works_motives: string | null;
  energy_sources: string | null;
  pmr_access_detail: string | null;
  sensory_access_detail: string | null;
  type_utilisation: string | null;
  free_access_flag: number;
  seasonal_only_flag: number;
  longueur_m: number | null;
  largeur_m: number | null;
  surface_bassin_m2: number | null;
  profondeur_min_m: number | null;
  profondeur_max_m: number | null;
  nb_couloirs: number | null;
  installation_out_of_service_flag: number;
  longitude: number | null;
  latitude: number | null;
  activites: string | null;
}

export type SchoolBroadLevel = "primary" | "secondary" | "mixed";

export interface SchoolDemandOverview {
  schools_total: number;
  schools_geolocated_total: number;
  students_total: number;
  students_geolocated_total: number;
  primary_students: number;
  secondary_students: number;
  distance_coverage_share: number;
  drive_time_coverage_share: number;
  average_distance_to_installation_km: number;
  average_drive_time_to_installation_min: number;
  average_drive_distance_to_installation_km: number;
  average_distance_to_basin_km: number;
  students_within_5km_installation_share: number;
  students_within_15min_installation_share: number;
  basins_total: number;
  installations_total: number;
  school_basins_total: number;
  students_per_basin: number;
  students_per_installation: number;
  students_per_school_basin: number;
}

export interface SchoolEstablishmentRecord {
  uai: string;
  school_name: string;
  school_level: string;
  broad_level: SchoolBroadLevel;
  school_source: string;
  school_type: string;
  sector: string | null;
  code_commune: string | null;
  commune: string | null;
  code_departement: string | null;
  departement: string | null;
  epci_code: string | null;
  epci_nom: string | null;
  latitude: number | null;
  longitude: number | null;
  students_total: number;
  primary_students: number;
  secondary_students: number;
  preprimary_students: number;
  elementary_students: number;
  classes_total: number | null;
  nearest_installation_id: string | null;
  nearest_installation: string | null;
  nearest_installation_commune: string | null;
  nearest_installation_epci: string | null;
  distance_to_nearest_installation_km: number | null;
  drive_distance_to_nearest_installation_km: number | null;
  drive_time_to_nearest_installation_min: number | null;
  nearest_transit_hub_id?: string | null;
  nearest_transit_hub?: string | null;
  nearest_transit_modes?: string | null;
  nearest_transit_distance_km?: number | null;
  active_transit_hubs_within_500m?: number;
  active_transit_hubs_within_1000m?: number;
  weekday_trips_within_500m?: number;
  weekday_trips_within_1000m?: number;
  nearest_basin_id: string | null;
  nearest_basin: string | null;
  nearest_basin_installation: string | null;
  distance_to_nearest_basin_km: number | null;
}

export interface SchoolDemandEpciRecord extends SchoolDemandOverview {
  epci_code: string;
  epci_nom: string | null;
  code_departement: string | null;
  departement: string | null;
}

export interface SchoolDemandInstallationRecord extends SchoolDemandOverview {
  id_installation: string;
  installation: string | null;
  code_commune: string | null;
  commune: string | null;
  epci_code: string | null;
  epci_nom: string | null;
  code_departement: string | null;
  departement: string | null;
  basins_total_on_site: number;
  school_basins_total_on_site: number;
  students_per_basin_on_site: number;
  students_per_school_basin_on_site: number;
}

export interface AccessibilityOverview {
  communes_total: number;
  communes_routed_total: number;
  population_total: number;
  population_routed_total: number;
  installations_total: number;
  reachable_installations_total: number;
  average_drive_time_to_installation_min: number;
  average_drive_distance_to_installation_km: number;
  population_within_10min_share: number;
  population_within_15min_share: number;
  population_within_20min_share: number;
  communes_within_10min_share: number;
  communes_within_15min_share: number;
  communes_within_20min_share: number;
}

export interface CommuneAccessibilityRecord {
  code_commune: string | null;
  commune: string | null;
  code_departement: string | null;
  departement: string | null;
  epci_code: string | null;
  epci_nom: string | null;
  population_2023: number;
  licences_ffn_2023: number;
  bassins_total: number;
  typo: string | null;
  latitude: number | null;
  longitude: number | null;
  nearest_installation_id: string | null;
  nearest_installation: string | null;
  nearest_installation_commune: string | null;
  nearest_installation_epci: string | null;
  crow_distance_to_nearest_installation_km: number | null;
  drive_distance_to_nearest_installation_km: number | null;
  drive_time_to_nearest_installation_min: number | null;
}

export interface AccessibilityEpciRecord extends AccessibilityOverview {
  epci_code: string;
  epci_nom: string | null;
  code_departement: string | null;
  departement: string | null;
}

export interface TransitOverview {
  communes_total: number;
  communes_geolocated_total: number;
  population_total: number;
  population_geolocated_total: number;
  transit_hubs_total: number;
  average_nearest_stop_distance_km: number;
  average_weekday_trips_within_1000m: number;
  population_within_500m_share: number;
  population_within_1000m_share: number;
  communes_within_500m_share: number;
  communes_within_1000m_share: number;
  installations_total: number;
  installations_geolocated_total: number;
  installations_within_500m_share: number;
  installations_within_1000m_share: number;
  schools_total: number;
  students_total: number;
  students_geolocated_total: number;
  average_school_nearest_stop_distance_km: number;
  students_within_500m_share: number;
  students_within_1000m_share: number;
}

export interface CommuneTransitRecord {
  code_commune: string | null;
  commune: string | null;
  code_departement: string | null;
  departement: string | null;
  epci_code: string | null;
  epci_nom: string | null;
  population_2023: number;
  licences_ffn_2023: number;
  bassins_total: number;
  typo: string | null;
  latitude: number | null;
  longitude: number | null;
  nearest_transit_hub_id: string | null;
  nearest_transit_hub: string | null;
  nearest_transit_modes: string | null;
  nearest_transit_distance_km: number | null;
  active_transit_hubs_within_500m: number;
  active_transit_hubs_within_1000m: number;
  weekday_trips_within_500m: number;
  weekday_trips_within_1000m: number;
}

export interface InstallationTransitRecord {
  id_installation: string;
  installation: string | null;
  code_commune: string | null;
  commune: string | null;
  epci_code: string | null;
  epci_nom: string | null;
  code_departement: string | null;
  departement: string | null;
  basins_total_on_site: number;
  school_basins_total_on_site: number;
  latitude: number | null;
  longitude: number | null;
  nearest_transit_hub_id: string | null;
  nearest_transit_hub: string | null;
  nearest_transit_modes: string | null;
  nearest_transit_distance_km: number | null;
  active_transit_hubs_within_500m: number;
  active_transit_hubs_within_1000m: number;
  weekday_trips_within_500m: number;
  weekday_trips_within_1000m: number;
}

export interface TransitEpciRecord extends TransitOverview {
  epci_code: string;
  epci_nom: string | null;
  code_departement: string | null;
  departement: string | null;
}

export interface DashboardData {
  meta: {
    title: string;
    subtitle: string;
    region: string;
    generated_at: string;
    source_file: string;
    source_summary: string;
    source_labels?: string[];
    source_updated_at: string;
  };
  notes: NoteEntry[];
  overview: Overview;
  departments: DepartmentRecord[];
  epci: EpciRecord[];
  communes: CommuneRecord[];
  basins: BasinRecord[];
  epci_management: GenericRecord[];
  epci_schools: GenericRecord[];
  school_basins: BasinRecord[];
  age_sex: AgeSexRecord[];
  sex_2024: SexRecord[];
  sources: SourceEntry[];
  extended_inventory_overview: ExtendedInventoryOverview;
  extended_inventory: ExtendedInventoryRecord[];
  school_demand_overview: SchoolDemandOverview;
  school_establishments: SchoolEstablishmentRecord[];
  school_demand_epci: SchoolDemandEpciRecord[];
  school_demand_installations: SchoolDemandInstallationRecord[];
  accessibility_overview: AccessibilityOverview;
  commune_accessibility: CommuneAccessibilityRecord[];
  accessibility_epci: AccessibilityEpciRecord[];
  transit_overview: TransitOverview;
  commune_transit: CommuneTransitRecord[];
  transit_epci: TransitEpciRecord[];
  installation_transit: InstallationTransitRecord[];
  downloads: Array<{ label: string; path: string }>;
}
