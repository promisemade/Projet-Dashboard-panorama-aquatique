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
  type_utilisation: string | null;
  longueur_m: number | null;
  largeur_m: number | null;
  surface_bassin_m2: number | null;
  profondeur_min_m: number | null;
  profondeur_max_m: number | null;
  nb_couloirs: number | null;
  longitude: number | null;
  latitude: number | null;
  activites: string | null;
}

export interface DashboardData {
  meta: {
    title: string;
    subtitle: string;
    region: string;
    generated_at: string;
    source_file: string;
    source_summary: string;
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
  downloads: Array<{ label: string; path: string }>;
}
