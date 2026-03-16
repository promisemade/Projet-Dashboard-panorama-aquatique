from __future__ import annotations

import ast
import csv
import hashlib
import io
import json
import math
import re
import shutil
import sys
import time
import unicodedata
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILE = ROOT / "socle_donnees_publiques_filiere_aquatique_HDF_v5_dashboard.xlsx"
EXTENDED_INVENTORY_FILE = ROOT / "data" / "raw" / "equipements-sportifs.csv"
EDUCATION_CACHE_DIR = ROOT / "data" / "raw" / "education"
ACCESSIBILITY_CACHE_DIR = ROOT / "data" / "raw" / "accessibility"
TRANSPORT_CACHE_DIR = ROOT / "data" / "raw" / "transport"
PUBLIC_DATA_DIR = ROOT / "public" / "data"
PUBLIC_EXPORT_DIR = PUBLIC_DATA_DIR / "exports"
EXPORT_DIR = ROOT / "data" / "exports"

EXTENDED_INVENTORY_EXPORT_NAME = "equipements_sportifs_non_filtres"
INSTALLATION_STATUS_EXPORT_NAME = "statuts_installations"
STATUS_REVIEW_EXPORT_NAME = "controle_statuts_prioritaires"
PROJECTS_IN_PROGRESS_FILE = ROOT / "data" / "raw" / "projets_equipements_en_cours.json"
PROJECTS_IN_PROGRESS_EXPORT_NAME = "projets_equipements_en_cours"
SCHOOL_ESTABLISHMENTS_EXPORT_NAME = "etablissements_scolaires_hdf"
SCHOOL_DEMAND_OVERVIEW_EXPORT_NAME = "pression_scolaire_synthese"
SCHOOL_DEMAND_EPCI_EXPORT_NAME = "pression_scolaire_epci"
SCHOOL_DEMAND_INSTALLATIONS_EXPORT_NAME = "pression_scolaire_installations"
COMMUNE_ACCESSIBILITY_EXPORT_NAME = "accessibilite_voiture_communes"
ACCESSIBILITY_OVERVIEW_EXPORT_NAME = "accessibilite_voiture_synthese"
ACCESSIBILITY_EPCI_EXPORT_NAME = "accessibilite_voiture_epci"
COMMUNE_TRANSIT_EXPORT_NAME = "offre_tc_potentielle_communes"
TRANSIT_OVERVIEW_EXPORT_NAME = "offre_tc_potentielle_synthese"
TRANSIT_EPCI_EXPORT_NAME = "offre_tc_potentielle_epci"
TRANSIT_INSTALLATIONS_EXPORT_NAME = "offre_tc_potentielle_installations"

META_TITLE = "Panorama aquatique en Hauts-de-France"
META_SUBTITLE = (
    "Croisement de données publiques pour lire la pratique FFN, l'offre en bassins, "
    "les usages scolaires, les modes de gestion et les enjeux QPV."
)
META_SOURCE_LABELS_BASE = [
    "Data.Sports",
    "Data.Education",
    "geo.api.gouv.fr",
    "OpenStreetMap/OSRM",
    "transport.data.gouv.fr",
]
STATUS_OVERRIDE_FILE = ROOT / "data" / "raw" / "statut_installations_verifies.csv"
STATUS_OVERRIDE_FIELDNAMES = [
    "id_installation",
    "id_equipement",
    "statut_verifie",
    "source_verification",
    "source_url",
    "date_verification",
    "niveau_confiance",
    "verifie_par",
    "commentaire",
]
STATUS_LABELS = {
    "open_probable": "Ouvert probable",
    "temporary_closed": "Fermé temporairement / travaux",
    "closed": "Fermé / hors service",
    "seasonal": "Ouverture saisonnière",
    "verify": "Statut à vérifier",
}
STATUS_PRIORITY = {
    "closed": 0,
    "temporary_closed": 1,
    "verify": 2,
    "seasonal": 3,
    "open_probable": 4,
}
PROJECT_BUCKET_LABELS = {
    "new": "Construction neuve",
    "rehab": "Réhabilitation lourde",
    "uncertain": "Projet très incertain",
}
PROJECT_BUCKET_PRIORITY = {
    "new": 0,
    "rehab": 1,
    "uncertain": 2,
}
PROJECT_PHASE_LABELS = {
    "works": "Travaux en cours",
    "programming": "Programmation",
    "procedure": "Procédure / montage",
    "consultation": "Concertation / étude",
    "recent_delivery": "Livré récemment",
    "uncertain": "Trajectoire incertaine",
}
PROJECT_PHASE_PRIORITY = {
    "works": 0,
    "recent_delivery": 1,
    "programming": 2,
    "procedure": 3,
    "consultation": 4,
    "uncertain": 5,
}

TABLE_SHEETS = {
    "departements": "02_Departements",
    "epci": "03_EPCI",
    "communes": "04_Communes",
    "bassins_points": "05_Bassins_points",
    "gestion_epci": "06_Gestion_EPCI",
    "scolaires_epci": "07_Scolaires_EPCI",
    "bassins_scolaires": "08_Bassins_scolaires",
    "ages_dep_sexe": "09_Ages_dep_sexe",
    "dep_sexe_2024": "10_Dep_sexe_2024",
    "sources": "11_Sources",
}

EDUCATION_API_BASE = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets"
GEO_API_BASE = "https://geo.api.gouv.fr"
OSRM_TABLE_BASE = "https://router.project-osrm.org/table/v1/driving"
SCHOOL_YEAR = 2024
ODS_PAGE_SIZE = 100
OSRM_SOURCE_BATCH_SIZE = 20
OSRM_SCHOOL_SOURCE_BATCH_SIZE = 60
HDF_DEPARTMENT_CODES = ["02", "59", "60", "62", "80"]
GTFS_DATASET_IDS = {
    "ter_hdf": "69127d95821dea86547b9619",
    "interurbain_nord": "667005c713503ed936c4be46",
    "interurbain_pas_de_calais": "66d25e146c064cce49709399",
    "interurbain_oise": "667005da13503ed936c4be66",
    "interurbain_somme": "66970a3d58c639f7658e70c8",
    "interurbain_aisne": "66d25e446c064cce497093a1",
}
TRANSPORT_DATASET_API_BASE = "https://transport.data.gouv.fr/api/datasets"
GTFS_GRID_CELL_DEGREES = 0.05
TRANSIT_NEAR_DISTANCE_KM = 0.5
TRANSIT_WIDE_DISTANCE_KM = 1.0
EDUCATION_DATASETS = {
    "geoloc": {
        "dataset": "fr-en-annuaire-education",
        "where": 'code_departement in ("002","059","060","062","080") and etat="OUVERT"',
        "cache_name": f"annuaire_etablissements_hdf_{SCHOOL_YEAR}.json",
    },
    "primary": {
        "dataset": "fr-en-ecoles-effectifs-nb_classes",
        "where": 'region_academique="HAUTS-DE-FRANCE" and year(rentree_scolaire)=2024',
        "cache_name": f"effectifs_ecoles_hdf_{SCHOOL_YEAR}.json",
    },
    "college": {
        "dataset": "fr-en-college-effectifs-niveau-sexe-lv",
        "where": 'code_dept in ("02","59","60","62","80") and rentree_scolaire="2024"',
        "cache_name": f"effectifs_colleges_hdf_{SCHOOL_YEAR}.json",
    },
    "lycee_gt": {
        "dataset": "fr-en-lycee_gt-effectifs-niveau-sexe-lv",
        "where": 'academie in ("LILLE","AMIENS") and rentree_scolaire="2024"',
        "cache_name": f"effectifs_lycees_gt_hdf_{SCHOOL_YEAR}.json",
    },
    "lycee_pro": {
        "dataset": "fr-en-lycee_pro-effectifs-niveau-sexe-mef",
        "where": 'academie_2020_lib_l in ("LILLE","AMIENS") and rentree_scolaire="2024"',
        "cache_name": f"effectifs_lycees_pro_hdf_{SCHOOL_YEAR}.json",
    },
}


def main() -> None:
    if not SOURCE_FILE.exists():
        raise FileNotFoundError(f"Classeur source introuvable: {SOURCE_FILE}")

    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    EDUCATION_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ACCESSIBILITY_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    TRANSPORT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ensure_status_override_file()

    tables = {name: load_table(sheet_name) for name, sheet_name in TABLE_SHEETS.items()}

    notes = load_notes()
    extended_inventory, status_override_count = load_extended_inventory()
    installation_status = build_installation_status_records(extended_inventory)
    status_review_queue = build_status_review_queue(installation_status)
    projects_in_progress = load_projects_in_progress(tables["communes"])
    tables["sources"] = augment_sources_table(
        sanitize_sources_table(tables["sources"]),
        status_override_count,
        len(projects_in_progress),
    )
    source_labels = [
        *META_SOURCE_LABELS_BASE,
    ]
    basin_records = frame_to_records(tables["bassins_points"])
    school_demand = build_school_demand(tables["communes"], basin_records)
    accessibility = build_commune_accessibility(tables["communes"], basin_records)
    transit = build_transit_offer(
        tables["communes"],
        basin_records,
        school_demand["school_establishments"],
    )
    school_establishments = transit["school_transit"]

    export_csvs(tables)
    export_additional_records(EXTENDED_INVENTORY_EXPORT_NAME, extended_inventory)
    export_additional_records(INSTALLATION_STATUS_EXPORT_NAME, installation_status)
    export_additional_records(STATUS_REVIEW_EXPORT_NAME, status_review_queue)
    export_additional_records(PROJECTS_IN_PROGRESS_EXPORT_NAME, projects_in_progress)
    export_additional_records(
        SCHOOL_ESTABLISHMENTS_EXPORT_NAME, school_establishments
    )
    export_additional_records(
        SCHOOL_DEMAND_OVERVIEW_EXPORT_NAME, [school_demand["school_demand_overview"]]
    )
    export_additional_records(SCHOOL_DEMAND_EPCI_EXPORT_NAME, school_demand["school_demand_epci"])
    export_additional_records(
        SCHOOL_DEMAND_INSTALLATIONS_EXPORT_NAME,
        school_demand["school_demand_installations"],
    )
    export_additional_records(
        COMMUNE_ACCESSIBILITY_EXPORT_NAME, accessibility["commune_accessibility"]
    )
    export_additional_records(
        ACCESSIBILITY_OVERVIEW_EXPORT_NAME, [accessibility["accessibility_overview"]]
    )
    export_additional_records(
        ACCESSIBILITY_EPCI_EXPORT_NAME, accessibility["accessibility_epci"]
    )
    export_additional_records(COMMUNE_TRANSIT_EXPORT_NAME, transit["commune_transit"])
    export_additional_records(TRANSIT_OVERVIEW_EXPORT_NAME, [transit["transit_overview"]])
    export_additional_records(TRANSIT_EPCI_EXPORT_NAME, transit["transit_epci"])
    export_additional_records(TRANSIT_INSTALLATIONS_EXPORT_NAME, transit["installation_transit"])
    shutil.copy2(SOURCE_FILE, PUBLIC_DATA_DIR / SOURCE_FILE.name)

    payload = {
        "meta": {
            "title": META_TITLE,
            "subtitle": META_SUBTITLE,
            "region": "Hauts-de-France",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_file": SOURCE_FILE.name,
            "source_summary": format_source_summary(source_labels),
            "source_labels": source_labels,
            "source_updated_at": datetime.fromtimestamp(
                SOURCE_FILE.stat().st_mtime, tz=timezone.utc
            ).isoformat(),
        },
        "notes": notes,
        "overview": build_overview(
            tables["departements"],
            tables["epci"],
            tables["communes"],
            tables["dep_sexe_2024"],
        ),
        "departments": frame_to_records(tables["departements"]),
        "epci": frame_to_records(tables["epci"]),
        "communes": frame_to_records(tables["communes"]),
        "basins": basin_records,
        "epci_management": frame_to_records(tables["gestion_epci"]),
        "epci_schools": frame_to_records(tables["scolaires_epci"]),
        "school_basins": frame_to_records(tables["bassins_scolaires"]),
        "age_sex": frame_to_records(tables["ages_dep_sexe"]),
        "sex_2024": frame_to_records(tables["dep_sexe_2024"]),
        "sources": frame_to_records(tables["sources"]),
        "extended_inventory_overview": build_extended_inventory_overview(extended_inventory),
        "extended_inventory": extended_inventory,
        "installation_status": installation_status,
        "status_review_queue": status_review_queue,
        "projects_in_progress": projects_in_progress,
        "school_demand_overview": school_demand["school_demand_overview"],
        "school_establishments": school_establishments,
        "school_demand_epci": school_demand["school_demand_epci"],
        "school_demand_installations": school_demand["school_demand_installations"],
        "accessibility_overview": accessibility["accessibility_overview"],
        "commune_accessibility": accessibility["commune_accessibility"],
        "accessibility_epci": accessibility["accessibility_epci"],
        "transit_overview": transit["transit_overview"],
        "commune_transit": transit["commune_transit"],
        "transit_epci": transit["transit_epci"],
        "installation_transit": transit["installation_transit"],
        "downloads": [
            {"label": "classeur excel source", "path": f"data/{SOURCE_FILE.name}"},
            *[
                {
                    "label": export_name.replace("_", " "),
                    "path": f"data/exports/{export_name}.csv",
                }
                for export_name in TABLE_SHEETS
            ],
            {
                "label": "equipements sportifs non filtres",
                "path": f"data/exports/{EXTENDED_INVENTORY_EXPORT_NAME}.csv",
            },
            {
                "label": "statuts installations",
                "path": f"data/exports/{INSTALLATION_STATUS_EXPORT_NAME}.csv",
            },
            {
                "label": "controle statuts prioritaires",
                "path": f"data/exports/{STATUS_REVIEW_EXPORT_NAME}.csv",
            },
            {
                "label": "projets equipements en cours",
                "path": f"data/exports/{PROJECTS_IN_PROGRESS_EXPORT_NAME}.csv",
            },
            {
                "label": "etablissements scolaires hdf",
                "path": f"data/exports/{SCHOOL_ESTABLISHMENTS_EXPORT_NAME}.csv",
            },
            {
                "label": "pression scolaire synthese",
                "path": f"data/exports/{SCHOOL_DEMAND_OVERVIEW_EXPORT_NAME}.csv",
            },
            {
                "label": "pression scolaire epci",
                "path": f"data/exports/{SCHOOL_DEMAND_EPCI_EXPORT_NAME}.csv",
            },
            {
                "label": "pression scolaire installations",
                "path": f"data/exports/{SCHOOL_DEMAND_INSTALLATIONS_EXPORT_NAME}.csv",
            },
            {
                "label": "accessibilite voiture communes",
                "path": f"data/exports/{COMMUNE_ACCESSIBILITY_EXPORT_NAME}.csv",
            },
            {
                "label": "accessibilite voiture synthese",
                "path": f"data/exports/{ACCESSIBILITY_OVERVIEW_EXPORT_NAME}.csv",
            },
            {
                "label": "accessibilite voiture epci",
                "path": f"data/exports/{ACCESSIBILITY_EPCI_EXPORT_NAME}.csv",
            },
            {
                "label": "offre TC potentielle communes",
                "path": f"data/exports/{COMMUNE_TRANSIT_EXPORT_NAME}.csv",
            },
            {
                "label": "offre TC potentielle synthèse",
                "path": f"data/exports/{TRANSIT_OVERVIEW_EXPORT_NAME}.csv",
            },
            {
                "label": "offre TC potentielle EPCI",
                "path": f"data/exports/{TRANSIT_EPCI_EXPORT_NAME}.csv",
            },
            {
                "label": "offre TC potentielle installations",
                "path": f"data/exports/{TRANSIT_INSTALLATIONS_EXPORT_NAME}.csv",
            },
        ],
    }

    output_file = PUBLIC_DATA_DIR / "dashboard.json"
    output_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Dashboard data written to {output_file}")


def load_table(sheet_name: str) -> pd.DataFrame:
    frame = pd.read_excel(SOURCE_FILE, sheet_name=sheet_name, header=3)
    return frame.dropna(how="all")


def load_notes() -> list[dict[str, str]]:
    frame = pd.read_excel(SOURCE_FILE, sheet_name="00_Lisez_moi", header=None)
    notes: list[dict[str, str]] = []

    for row in frame.itertuples(index=False):
        label = clean_note_value(getattr(row, "_0", None))
        value = clean_note_value(getattr(row, "_1", None))
        if not label or not value:
            continue
        if label.startswith("Tableau de bord") or label.startswith("Version orientée"):
            continue
        if label == "Ajouts V5":
            label = "Ajouts du dashboard web"
        notes.append({"label": label, "value": value})

    return notes


def load_projects_in_progress(communes_frame: pd.DataFrame) -> list[dict[str, Any]]:
    if not PROJECTS_IN_PROGRESS_FILE.exists():
        return []

    try:
        payload = json.loads(PROJECTS_IN_PROGRESS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        print(f"Projects file unreadable, continuing without project overlay: {error}", file=sys.stderr)
        return []

    if not isinstance(payload, list):
        return []

    communes = frame_to_records(communes_frame)
    commune_lookup = build_project_commune_lookup(communes)
    commune_centers = fetch_commune_centers()
    rows: list[dict[str, Any]] = []

    for raw_row in payload:
        if not isinstance(raw_row, dict):
            continue

        project_id = clean_identifier(raw_row.get("project_id"))
        project_name = clean_text(raw_row.get("project_name"))
        department_code = clean_department_code(raw_row.get("department_code"))
        commune_reference = clean_text(raw_row.get("commune_reference"))
        if not project_id or not project_name:
            continue

        commune_data = find_project_commune(
            commune_lookup,
            commune_reference,
            department_code,
        )
        code_commune = clean_commune_code(commune_data.get("code_commune")) if commune_data else None
        commune_center = commune_centers.get(code_commune) if code_commune else None
        bucket_code = clean_text(raw_row.get("project_bucket_code")) or "new"
        phase_code = clean_text(raw_row.get("project_phase_code")) or "programming"
        latitude = clean_float(raw_row.get("latitude"))
        longitude = clean_float(raw_row.get("longitude"))
        if latitude is None or longitude is None:
            latitude = clean_float(commune_center.get("latitude")) if commune_center else None
            longitude = clean_float(commune_center.get("longitude")) if commune_center else None

        rows.append(
            {
                "project_id": project_id,
                "project_name": project_name,
                "communes_label": clean_text(raw_row.get("communes_label")) or commune_reference or project_name,
                "commune_reference": commune_reference,
                "code_commune": code_commune,
                "commune": clean_text(commune_data.get("commune")) if commune_data else commune_reference,
                "epci_code": clean_text(commune_data.get("epci_code")) if commune_data else None,
                "epci_nom": clean_text(commune_data.get("epci_nom")) if commune_data else None,
                "code_departement": department_code
                or (clean_department_code(commune_data.get("code_departement")) if commune_data else None),
                "departement": clean_text(commune_data.get("departement")) if commune_data else None,
                "latitude": latitude,
                "longitude": longitude,
                "location_precision_label": (
                    "Repère localisé" if raw_row.get("latitude") and raw_row.get("longitude") else "Centre communal de référence"
                )
                if latitude is not None and longitude is not None
                else "Localisation non disponible",
                "project_bucket_code": bucket_code,
                "project_bucket_label": PROJECT_BUCKET_LABELS.get(bucket_code, clean_text(raw_row.get("project_nature_label")) or "Projet"),
                "project_nature_label": clean_text(raw_row.get("project_nature_label")),
                "project_phase_code": phase_code,
                "project_phase_label": PROJECT_PHASE_LABELS.get(phase_code, "Avancement non renseigné"),
                "public_status": clean_text(raw_row.get("public_status")),
                "opening_label": clean_text(raw_row.get("opening_label")),
                "opening_sort_value": clean_int(raw_row.get("opening_sort_value")),
                "project_owner": clean_text(raw_row.get("project_owner")),
                "budget_label": clean_text(raw_row.get("budget_label")),
                "program_summary": clean_text(raw_row.get("program_summary")),
                "source_summary": normalize_project_source_summary(raw_row.get("source_summary")),
            }
        )

    rows.sort(
        key=lambda item: (
            item.get("opening_sort_value") is None,
            item.get("opening_sort_value") or 999999,
            PROJECT_BUCKET_PRIORITY.get(clean_text(item.get("project_bucket_code")) or "uncertain", 99),
            PROJECT_PHASE_PRIORITY.get(clean_text(item.get("project_phase_code")) or "uncertain", 99),
            clean_text(item.get("project_name")) or "",
        )
    )
    return rows


def normalize_project_source_summary(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    normalized = text.replace("Â·", "·")
    normalized = re.sub(r"^Rapport projets[^·•]*(?:·|•)\s*", "", normalized, flags=re.IGNORECASE)
    return normalized.strip() or None


def build_project_commune_lookup(communes: list[dict[str, Any]]) -> dict[tuple[str, str | None], dict[str, Any]]:
    lookup: dict[tuple[str, str | None], dict[str, Any]] = {}
    for commune in communes:
        commune_name = clean_text(commune.get("commune"))
        normalized_name = normalize_search_text(commune_name)
        if not normalized_name:
            continue
        department_code = clean_department_code(commune.get("code_departement"))
        lookup[(normalized_name, department_code)] = commune
        lookup.setdefault((normalized_name, None), commune)
    return lookup


def find_project_commune(
    commune_lookup: dict[tuple[str, str | None], dict[str, Any]],
    commune_reference: str | None,
    department_code: str | None,
) -> dict[str, Any] | None:
    normalized_reference = normalize_search_text(commune_reference)
    if not normalized_reference:
        return None
    return commune_lookup.get((normalized_reference, department_code)) or commune_lookup.get(
        (normalized_reference, None)
    )


def ensure_status_override_file() -> None:
    STATUS_OVERRIDE_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not STATUS_OVERRIDE_FILE.exists():
        with STATUS_OVERRIDE_FILE.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.writer(handle, delimiter=";")
            writer.writerow(STATUS_OVERRIDE_FIELDNAMES)
        return

    with STATUS_OVERRIDE_FILE.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        existing_fieldnames = reader.fieldnames or []
        if existing_fieldnames == STATUS_OVERRIDE_FIELDNAMES:
            return
        rows = list(reader)

    with STATUS_OVERRIDE_FILE.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(STATUS_OVERRIDE_FIELDNAMES)
        for row in rows:
            writer.writerow([row.get(field, "") for field in STATUS_OVERRIDE_FIELDNAMES])


def normalize_status_confidence(value: Any) -> str | None:
    normalized = normalize_search_text(value)
    if not normalized:
        return None

    mapping = {
        "forte": "Forte",
        "haut": "Forte",
        "high": "Forte",
        "moyenne": "Moyenne",
        "medium": "Moyenne",
        "intermediaire": "Moyenne",
        "faible": "Faible",
        "low": "Faible",
    }
    return mapping.get(normalized, clean_text(value))


def normalize_status_token(value: Any) -> str | None:
    normalized = normalize_search_text(value)
    if not normalized:
        return None

    mapping = {
        "ouvert": "open_probable",
        "ouvert_probable": "open_probable",
        "open_probable": "open_probable",
        "en_service": "open_probable",
        "actif": "open_probable",
        "ferme_temporairement": "temporary_closed",
        "ferme_temporaire": "temporary_closed",
        "fermeture_temporaire": "temporary_closed",
        "travaux": "temporary_closed",
        "ferme_pour_travaux": "temporary_closed",
        "temporary_closed": "temporary_closed",
        "ferme": "closed",
        "ferme_hors_service": "closed",
        "hors_service": "closed",
        "definitivement_ferme": "closed",
        "closed": "closed",
        "saisonnier": "seasonal",
        "ouverture_saisonniere": "seasonal",
        "seasonal": "seasonal",
        "a_verifier": "verify",
        "a_confirmer": "verify",
        "incertain": "verify",
        "verify": "verify",
    }
    return mapping.get(normalized)


def load_status_overrides() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], int]:
    if not STATUS_OVERRIDE_FILE.exists():
        return {}, {}, 0

    installation_overrides: dict[str, dict[str, Any]] = {}
    equipment_overrides: dict[str, dict[str, Any]] = {}
    count = 0

    with STATUS_OVERRIDE_FILE.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        for row in reader:
            status_code = normalize_status_token(row.get("statut_verifie"))
            installation_id = clean_identifier(row.get("id_installation"))
            equipment_id = clean_identifier(row.get("id_equipement"))
            if not status_code or (not installation_id and not equipment_id):
                continue

            payload = {
                "status_code": status_code,
                "status_label": STATUS_LABELS[status_code],
                "status_source": clean_text(row.get("source_verification")) or "Source locale renseignée",
                "status_source_url": clean_text(row.get("source_url")),
                "status_reviewed_at": clean_text(row.get("date_verification")),
                "status_confidence": normalize_status_confidence(row.get("niveau_confiance")) or "Forte",
                "status_verified_by": clean_text(row.get("verifie_par")),
                "status_is_manual": 1,
                "status_comment": clean_text(row.get("commentaire")),
            }

            if equipment_id:
                equipment_overrides[equipment_id] = payload
                count += 1
                continue

            installation_overrides[installation_id] = payload
            count += 1

    return installation_overrides, equipment_overrides, count


def build_status_excerpt(*values: Any, max_length: int = 180) -> str | None:
    text = " ".join(filter(None, [clean_text(value) for value in values]))
    if not text:
        return None
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= max_length:
        return compact
    return compact[: max_length - 1].rstrip() + "…"


def classify_operational_status(
    *,
    installation_out_of_service_flag: int,
    seasonal_only_flag: int,
    observation_installation: str | None,
    observation_equipement: str | None,
    override: dict[str, Any] | None,
) -> dict[str, Any]:
    if override:
        return {
            "operational_status_code": override["status_code"],
            "operational_status_label": override["status_label"],
            "operational_status_reason": override.get("status_comment") or "Statut vérifié manuellement.",
            "status_source": override.get("status_source") or "Source locale renseignée",
            "status_source_url": override.get("status_source_url"),
            "status_reviewed_at": override.get("status_reviewed_at"),
            "status_confidence": override.get("status_confidence"),
            "status_verified_by": override.get("status_verified_by"),
            "status_is_manual": override.get("status_is_manual", 1),
            "status_override_comment": override.get("status_comment"),
        }

    observation_text = normalize_search_text(
        " ".join(
            value for value in [observation_installation, observation_equipement] if isinstance(value, str)
        )
    )
    excerpt = build_status_excerpt(observation_installation, observation_equipement)

    has_closure_signal = bool(
        observation_text
        and (
            "ferme" in observation_text
            or "fermeture" in observation_text
            or "hors service" in observation_text
            or "desaffect" in observation_text
        )
    )
    has_temporary_signal = bool(
        observation_text
        and (
            "travaux" in observation_text
            or "chantier" in observation_text
            or "renov" in observation_text
            or "rehabilit" in observation_text
            or "reouverture" in observation_text
            or "rouvr" in observation_text
        )
    )

    if installation_out_of_service_flag == 1:
        return {
            "operational_status_code": "closed",
            "operational_status_label": STATUS_LABELS["closed"],
            "operational_status_reason": excerpt or "Installation hors service signalée dans Data ES.",
            "status_source": "Data ES calculé",
            "status_source_url": None,
            "status_reviewed_at": None,
            "status_confidence": None,
            "status_verified_by": None,
            "status_is_manual": 0,
            "status_override_comment": None,
        }

    if has_closure_signal and has_temporary_signal:
        return {
            "operational_status_code": "temporary_closed",
            "operational_status_label": STATUS_LABELS["temporary_closed"],
            "operational_status_reason": excerpt or "Observation Data ES signalant une fermeture temporaire ou des travaux.",
            "status_source": "Data ES calculé",
            "status_source_url": None,
            "status_reviewed_at": None,
            "status_confidence": None,
            "status_verified_by": None,
            "status_is_manual": 0,
            "status_override_comment": None,
        }

    if has_closure_signal:
        return {
            "operational_status_code": "closed",
            "operational_status_label": STATUS_LABELS["closed"],
            "operational_status_reason": excerpt or "Observation Data ES signalant une fermeture ou un hors service.",
            "status_source": "Data ES calculé",
            "status_source_url": None,
            "status_reviewed_at": None,
            "status_confidence": None,
            "status_verified_by": None,
            "status_is_manual": 0,
            "status_override_comment": None,
        }

    if seasonal_only_flag == 1:
        return {
            "operational_status_code": "seasonal",
            "operational_status_label": STATUS_LABELS["seasonal"],
            "operational_status_reason": excerpt or "Ouverture exclusivement saisonnière signalée dans Data ES.",
            "status_source": "Data ES calculé",
            "status_source_url": None,
            "status_reviewed_at": None,
            "status_confidence": None,
            "status_verified_by": None,
            "status_is_manual": 0,
            "status_override_comment": None,
        }

    if has_temporary_signal:
        return {
            "operational_status_code": "verify",
            "operational_status_label": STATUS_LABELS["verify"],
            "operational_status_reason": excerpt or "Observation Data ES à confirmer sur l'état d'exploitation.",
            "status_source": "Data ES calculé",
            "status_source_url": None,
            "status_reviewed_at": None,
            "status_confidence": None,
            "status_verified_by": None,
            "status_is_manual": 0,
            "status_override_comment": None,
        }

    return {
        "operational_status_code": "open_probable",
        "operational_status_label": STATUS_LABELS["open_probable"],
        "operational_status_reason": "Aucun signal de fermeture détecté dans Data ES.",
        "status_source": "Data ES calculé",
        "status_source_url": None,
        "status_reviewed_at": None,
        "status_confidence": None,
        "status_verified_by": None,
        "status_is_manual": 0,
        "status_override_comment": None,
    }


def build_installation_status_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        installation_id = clean_identifier(record.get("id_installation")) or clean_identifier(record.get("id_equipement"))
        if not installation_id:
            continue
        grouped[installation_id].append(record)

    rows: list[dict[str, Any]] = []
    for installation_id, items in grouped.items():
        sorted_items = sorted(
            items,
            key=lambda item: (
                STATUS_PRIORITY.get(clean_text(item.get("operational_status_code")) or "verify", 99),
                clean_identifier(item.get("id_equipement")) or "",
            ),
        )
        primary = sorted_items[0]
        distinct_statuses = {
            clean_text(item.get("operational_status_code")) or "verify"
            for item in items
            if clean_text(item.get("operational_status_code"))
        }
        reason = clean_text(primary.get("operational_status_reason"))
        if len(distinct_statuses) > 1:
            reason = (
                f"{reason} Signaux hétérogènes entre équipements du site."
                if reason
                else "Signaux hétérogènes entre équipements du site."
            )

        survey_dates = [clean_text(item.get("survey_date")) for item in items if clean_text(item.get("survey_date"))]
        state_change_dates = [
            clean_text(item.get("state_change_date"))
            for item in items
            if clean_text(item.get("state_change_date"))
        ]

        rows.append(
            {
                "id_installation": installation_id,
                "installation": clean_text(primary.get("installation")),
                "code_commune": clean_commune_code(primary.get("code_commune")),
                "commune": clean_text(primary.get("commune")),
                "epci_code": clean_identifier(primary.get("epci_code")),
                "epci_nom": clean_text(primary.get("epci_nom")),
                "code_departement": clean_department_code(primary.get("dep_code")),
                "departement": clean_text(primary.get("departement")),
                "equipments_total": len(items),
                "bassins_total": sum(1 for item in items if clean_text(item.get("famille_equipement")) == "Bassin de natation"),
                "operational_status_code": clean_text(primary.get("operational_status_code")) or "verify",
                "operational_status_label": clean_text(primary.get("operational_status_label")) or STATUS_LABELS["verify"],
                "operational_status_reason": reason,
                "status_source": clean_text(primary.get("status_source")),
                "status_source_url": clean_text(primary.get("status_source_url")),
                "status_reviewed_at": clean_text(primary.get("status_reviewed_at")),
                "status_confidence": clean_text(primary.get("status_confidence")),
                "status_verified_by": clean_text(primary.get("status_verified_by")),
                "status_is_manual": clean_bool(primary.get("status_is_manual")),
                "status_override_comment": clean_text(primary.get("status_override_comment")),
                "survey_date_latest": max(survey_dates) if survey_dates else None,
                "state_change_date_latest": max(state_change_dates) if state_change_dates else None,
            }
        )

    return sorted(
        rows,
        key=lambda item: (
            STATUS_PRIORITY.get(clean_text(item.get("operational_status_code")) or "verify", 99),
            clean_text(item.get("departement")) or "",
            clean_text(item.get("commune")) or "",
            clean_text(item.get("installation")) or "",
        ),
    )


def parse_iso_date(value: Any) -> date | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def build_status_review_queue(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    queue: list[dict[str, Any]] = []
    today = datetime.now(timezone.utc).date()

    for row in rows:
        if clean_bool(row.get("status_is_manual")) == 1:
            continue

        status_code = clean_text(row.get("operational_status_code")) or "verify"
        survey_date = parse_iso_date(row.get("survey_date_latest"))
        days_since_survey = (today - survey_date).days if survey_date else None

        priority_score = 0
        priority_label = "veille"
        queue_reason = "Controle documentaire recommande."

        if status_code == "temporary_closed":
            priority_score = 100
            priority_label = "prioritaire"
            queue_reason = "Fermeture temporaire ou travaux signales dans Data ES."
        elif status_code == "closed":
            priority_score = 95
            priority_label = "prioritaire"
            queue_reason = "Fermeture ou hors service signales dans Data ES."
        elif status_code == "verify":
            priority_score = 85
            priority_label = "prioritaire"
            queue_reason = "Observation ambigue a confirmer localement."
        elif status_code == "seasonal":
            priority_score = 50
            priority_label = "surveillance"
            queue_reason = "Ouverture saisonniere a confirmer selon la periode."
        elif days_since_survey is None or days_since_survey > 365:
            priority_score = 35
            priority_label = "surveillance"
            queue_reason = "Ouvert probable sans verification manuelle recente."

        if priority_score == 0:
            continue

        queue.append(
            {
                "priority_label": priority_label,
                "priority_score": priority_score,
                "id_installation": clean_identifier(row.get("id_installation")),
                "installation": clean_text(row.get("installation")),
                "commune": clean_text(row.get("commune")),
                "departement": clean_text(row.get("departement")),
                "epci_nom": clean_text(row.get("epci_nom")),
                "operational_status_label": clean_text(row.get("operational_status_label")),
                "operational_status_reason": clean_text(row.get("operational_status_reason")),
                "status_source": clean_text(row.get("status_source")),
                "survey_date_latest": clean_text(row.get("survey_date_latest")),
                "state_change_date_latest": clean_text(row.get("state_change_date_latest")),
                "days_since_survey": days_since_survey,
                "search_hint": " ".join(
                    filter(
                        None,
                        [
                            clean_text(row.get("installation")),
                            clean_text(row.get("commune")),
                            "piscine",
                        ],
                    )
                ),
                "queue_reason": queue_reason,
            }
        )

    return sorted(
        queue,
        key=lambda item: (
            -int(item.get("priority_score") or 0),
            clean_text(item.get("departement")) or "",
            clean_text(item.get("commune")) or "",
            clean_text(item.get("installation")) or "",
        ),
    )


def load_extended_inventory() -> tuple[list[dict[str, Any]], int]:
    if not EXTENDED_INVENTORY_FILE.exists():
        return [], 0

    installation_overrides, equipment_overrides, override_count = load_status_overrides()
    records: list[dict[str, Any]] = []
    with EXTENDED_INVENTORY_FILE.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter=";")
        next(reader, None)
        for row in reader:
            if not any(value.strip() for value in row):
                continue

            padded = row + [""] * max(0, 113 - len(row))
            installation_id = clean_identifier(padded[1])
            equipment_id = clean_identifier(padded[0])
            observation_installation = clean_text(padded[13])
            observation_equipement = clean_text(padded[84])
            status_override = equipment_overrides.get(equipment_id) or installation_overrides.get(installation_id)
            operational_status = classify_operational_status(
                installation_out_of_service_flag=clean_bool(padded[16]),
                seasonal_only_flag=clean_bool(padded[83]),
                observation_installation=observation_installation,
                observation_equipement=observation_equipement,
                override=status_override,
            )
            records.append(
                {
                    "id_equipement": equipment_id,
                    "id_installation": installation_id,
                    "installation": clean_text(padded[3]),
                    "equipement": clean_text(padded[32]),
                    "code_commune": clean_commune_code(padded[8]),
                    "commune": clean_text(padded[7]),
                    "epci_code": clean_identifier(padded[17]),
                    "epci_nom": clean_text(padded[22]),
                    "dep_code": clean_department_code(padded[18]),
                    "departement": clean_text(padded[19]),
                    "typologie_commune_source": clean_text(padded[28]),
                    "particularite_installation": clean_text(padded[9]),
                    "particularite_installation_brute": join_literal_list(padded[111]),
                    "famille_equipement": clean_text(padded[89]) or "Famille non renseignée",
                    "type_equipement": clean_text(padded[33]) or "Type non renseigné",
                    "code_type_equipement": clean_identifier(padded[90]),
                    "rnb_id": clean_identifier(padded[91]),
                    "uai": clean_identifier(padded[10]),
                    "survey_date": clean_text(padded[2]),
                    "state_change_date": clean_text(padded[14]),
                    "observation_installation": observation_installation,
                    "observation_equipement": observation_equipement,
                    "handicap_access_types": join_literal_list(padded[11]),
                    "transport_access_modes": join_literal_list(padded[12]),
                    "opening_authorized_flag": clean_bool(padded[41]),
                    "erp_type": join_literal_list(padded[42]),
                    "erp_category": clean_text(padded[43]),
                    "year_service": clean_int(padded[46]),
                    "service_period": clean_text(padded[47]),
                    "last_major_works_date": clean_text(padded[48]),
                    "last_major_works_period": clean_text(padded[49]),
                    "last_major_works_year": extract_year(padded[48]) or extract_year(padded[49]),
                    "last_major_works_motives": join_literal_list(padded[50]),
                    "energy_sources": join_literal_list(padded[51]),
                    "pmr_access_detail": clean_text(padded[67]),
                    "sensory_access_detail": clean_text(padded[68]),
                    "type_utilisation": join_literal_list(padded[81]),
                    "free_access_flag": clean_bool(padded[82]),
                    "seasonal_only_flag": clean_bool(padded[83]),
                    "longueur_m": clean_float(padded[70]),
                    "largeur_m": clean_float(padded[71]),
                    "surface_bassin_m2": clean_float(padded[72]),
                    "profondeur_min_m": clean_float(padded[73]),
                    "profondeur_max_m": clean_float(padded[74]),
                    "nb_couloirs": clean_int(padded[59]),
                    "installation_out_of_service_flag": clean_bool(padded[16]),
                    "longitude": clean_float(padded[109]),
                    "latitude": clean_float(padded[110]),
                    "activites": join_literal_list(padded[112]),
                    **operational_status,
                }
            )

    return records, override_count


def sanitize_sources_table(frame: pd.DataFrame) -> pd.DataFrame:
    cleaned = frame.copy()
    definition_mask = (
        cleaned["jeu"].astype(str).str.startswith("Définition")
        if "jeu" in cleaned.columns
        else pd.Series(False, index=cleaned.index)
    )

    if "source" in cleaned.columns:
        cleaned["source"] = cleaned["source"].replace(
            {"calcul DRAJES/OpenAI": "traitement DRAJES à partir de données publiques croisées"}
        )
        cleaned.loc[
            definition_mask, "source"
        ] = "traitement DRAJES à partir de données publiques croisées"

    if "millesime" in cleaned.columns:
        cleaned["millesime"] = cleaned["millesime"].replace({"V5": "version web"})
        cleaned.loc[definition_mask, "millesime"] = "version web"

    if "usage_principal" in cleaned.columns:
        cleaned["usage_principal"] = cleaned["usage_principal"].replace(
            {"benchmark national FFN": "repère national FFN"}
        )

    return cleaned


def augment_sources_table(
    frame: pd.DataFrame,
    status_override_count: int,
    projects_in_progress_count: int,
) -> pd.DataFrame:
    additions_rows = [
            {
                "jeu": "12 Établissements scolaires géolocalisés",
                "source": "Ministère de l'Éducation nationale · data.education.gouv.fr",
                "maille": "établissement",
                "millesime": str(SCHOOL_YEAR),
                "filtre": "Hauts-de-France · établissements ouverts",
                "usage_principal": "ancrage géographique des écoles, collèges et lycées",
            },
            {
                "jeu": "13 Effectifs scolaires 2024",
                "source": "Ministère de l'Éducation nationale · data.education.gouv.fr",
                "maille": "établissement",
                "millesime": str(SCHOOL_YEAR),
                "filtre": "Hauts-de-France · premier et second degrés",
                "usage_principal": "pression scolaire potentielle, distance aux bassins et lecture territoriale",
            },
            {
                "jeu": "14 Centres communaux",
                "source": "geo.api.gouv.fr",
                "maille": "commune",
                "millesime": "API temps reel",
                "filtre": "Hauts-de-France",
                "usage_principal": "points d'origine pour les calculs d'accessibilite voiture",
            },
            {
                "jeu": "15 Temps d'acces voiture",
                "source": "OpenStreetMap / OSRM",
                "maille": "commune -> installation",
                "millesime": "calcul au fil de l'eau",
                "filtre": "Installation aquatique la plus proche",
                "usage_principal": "lecture d'accessibilite voiture par commune et par EPCI",
            },
            {
                "jeu": "16 GTFS transports collectifs",
                "source": "transport.data.gouv.fr",
                "maille": "arrêt / gare / service",
                "millesime": "API temps réel",
                "filtre": "TER + réseaux interurbains Hauts-de-France",
                "usage_principal": "offre TC potentielle autour des communes, des installations et des établissements",
            },
    ]
    if projects_in_progress_count > 0:
        additions_rows.append(
            {
                "jeu": "17 Projets aquatiques en cours",
                "source": "veille projets 16 mars 2026",
                "maille": "projet",
                "millesime": "2026",
                "filtre": "Hauts-de-France · projets répertoriés dans le rapport",
                "usage_principal": "repérage des constructions neuves, réhabilitations lourdes et projets incertains",
            }
        )
    if status_override_count > 0:
        additions_rows.append(
            {
                "jeu": "18 Statuts d'exploitation vérifiés",
                "source": "vérification manuelle locale",
                "maille": "installation / équipement",
                "millesime": "mise à jour locale",
                "filtre": "surcouche au-dessus de Data ES",
                "usage_principal": "correction des fermetures, travaux et statuts à confirmer",
            }
        )
    additions = pd.DataFrame(additions_rows)
    return pd.concat([frame, additions], ignore_index=True)


def export_csvs(tables: dict[str, pd.DataFrame]) -> None:
    for export_name, frame in tables.items():
        frame.to_csv(EXPORT_DIR / f"{export_name}.csv", index=False, encoding="utf-8-sig")
        frame.to_csv(PUBLIC_EXPORT_DIR / f"{export_name}.csv", index=False, encoding="utf-8-sig")


def export_additional_records(export_name: str, records: list[dict[str, Any]]) -> None:
    frame = pd.DataFrame(records)
    frame.to_csv(EXPORT_DIR / f"{export_name}.csv", index=False, encoding="utf-8-sig")
    frame.to_csv(PUBLIC_EXPORT_DIR / f"{export_name}.csv", index=False, encoding="utf-8-sig")


def build_overview(
    departments: pd.DataFrame,
    epci: pd.DataFrame,
    communes: pd.DataFrame,
    sex_frame: pd.DataFrame,
) -> dict[str, Any]:
    population_total = int(departments["population_2023_communes"].sum())
    bassins_total = int(departments["bassins_total"].sum())
    licences_2024 = int(departments["licences_ffn_2024_dep"].sum())
    licences_total_2024 = int(sex_frame["licences_total_2024"].sum())
    femmes_total_2024 = int(sex_frame["licences_femmes_2024"].sum())

    return {
        "population_total": population_total,
        "communes_total": int(len(communes)),
        "epci_total": int(len(epci)),
        "installations_total": int(epci["installations_total"].sum()),
        "licences_ffn_2023": int(departments["licences_ffn_2023"].sum()),
        "licences_ffn_2024": licences_2024,
        "part_femmes_ffn_2024": femmes_total_2024 / licences_total_2024 if licences_total_2024 else 0,
        "bassins_total": bassins_total,
        "bassins_dsp": int(departments["bassins_dsp"].sum()),
        "bassins_regie": int(departments["bassins_regie"].sum()),
        "bassins_autre": int(departments["bassins_prive_hors_dsp"].sum()),
        "bassins_usage_scolaires": int(departments["bassins_usage_scolaires"].sum()),
        "bassins_site_scolaire_explicit": int(
            departments["bassins_site_scolaire_explicit"].sum()
        ),
        "bassins_qpv": int(departments["bassins_qpv"].sum()),
        "bassins_qpv_200m": int(departments["bassins_qpv_200m"].sum()),
        "surface_totale_bassins_m2": round(
            float(departments["surface_totale_bassins_m2"].sum()), 1
        ),
        "bassins_pour_100k_hab": (bassins_total / population_total) * 100000 if population_total else 0,
        "licences_ffn_pour_1000hab": (licences_2024 / population_total) * 1000 if population_total else 0,
        "communes_avec_licences_sans_bassin": int(
            ((communes["licences_ffn_2023"] > 0) & (communes["bassins_total"] == 0)).sum()
        ),
    }


def build_extended_inventory_overview(records: list[dict[str, Any]]) -> dict[str, Any]:
    bassin_records = [record for record in records if record.get("famille_equipement") == "Bassin de natation"]
    non_bassin_records = [record for record in records if record.get("famille_equipement") != "Bassin de natation"]
    activities = {
        activity
        for record in records
        for activity in split_joined_values(record.get("activites"))
    }

    return {
        "equipments_total": len(records),
        "installations_total": count_unique_records(records, "id_installation"),
        "bassin_family_equipments_total": len(bassin_records),
        "bassin_family_installations_total": count_unique_records(bassin_records, "id_installation"),
        "non_bassin_family_equipments_total": len(non_bassin_records),
        "non_bassin_family_installations_total": count_unique_records(non_bassin_records, "id_installation"),
        "families_total": count_unique_values(records, "famille_equipement"),
        "types_total": count_unique_values(records, "type_equipement"),
        "activities_total": len(activities),
    }


def build_commune_accessibility(
    communes_frame: pd.DataFrame,
    basins: list[dict[str, Any]],
) -> dict[str, Any]:
    commune_records = frame_to_records(communes_frame)
    commune_centers = fetch_commune_centers()
    installation_sites = build_installation_sites(basins)
    drive_lookup = build_drive_time_lookup(commune_records, commune_centers, installation_sites)
    installations_total = len(
        [
            site
            for site in installation_sites.values()
            if clean_float(site.get("latitude")) is not None
            and clean_float(site.get("longitude")) is not None
        ]
    )

    rows: list[dict[str, Any]] = []
    for commune in commune_records:
        code_commune = clean_commune_code(commune.get("code_commune"))
        center = commune_centers.get(code_commune, {})
        drive_result = drive_lookup.get(code_commune, {})

        rows.append(
            {
                "code_commune": code_commune,
                "commune": clean_text(commune.get("commune")),
                "code_departement": clean_department_code(commune.get("code_departement")),
                "departement": clean_text(commune.get("departement")),
                "epci_code": clean_identifier(commune.get("epci_code")),
                "epci_nom": clean_text(commune.get("epci_nom")),
                "population_2023": clean_int(commune.get("population_2023")) or 0,
                "licences_ffn_2023": clean_int(commune.get("licences_ffn_2023")) or 0,
                "bassins_total": clean_int(commune.get("bassins_total")) or 0,
                "typo": clean_text(commune.get("typo")),
                "latitude": clean_float(center.get("latitude")),
                "longitude": clean_float(center.get("longitude")),
                "nearest_installation_id": clean_identifier(
                    drive_result.get("nearest_installation_id")
                ),
                "nearest_installation": clean_text(drive_result.get("nearest_installation")),
                "nearest_installation_commune": clean_text(
                    drive_result.get("nearest_installation_commune")
                ),
                "nearest_installation_epci": clean_text(
                    drive_result.get("nearest_installation_epci")
                ),
                "crow_distance_to_nearest_installation_km": clean_float(
                    drive_result.get("crow_distance_to_nearest_installation_km")
                ),
                "drive_distance_to_nearest_installation_km": clean_float(
                    drive_result.get("drive_distance_to_nearest_installation_km")
                ),
                "drive_time_to_nearest_installation_min": clean_float(
                    drive_result.get("drive_time_to_nearest_installation_min")
                ),
            }
        )

    rows.sort(
        key=lambda item: (
            item.get("code_departement") or "",
            item.get("epci_nom") or "",
            item.get("commune") or "",
        )
    )

    return {
        "accessibility_overview": build_accessibility_summary(rows, installations_total),
        "commune_accessibility": rows,
        "accessibility_epci": build_accessibility_epci_rows(rows, installations_total),
    }


def build_transit_offer(
    communes_frame: pd.DataFrame,
    basins: list[dict[str, Any]],
    school_establishments: list[dict[str, Any]],
) -> dict[str, Any]:
    commune_records = frame_to_records(communes_frame)
    commune_centers = fetch_commune_centers()
    installation_sites = build_installation_sites(basins)
    transit_hubs = load_gtfs_transit_hubs()
    transit_grid = build_spatial_grid(transit_hubs)

    commune_rows: list[dict[str, Any]] = []
    for commune in commune_records:
        code_commune = clean_commune_code(commune.get("code_commune"))
        center = commune_centers.get(code_commune, {})
        proximity = summarize_transit_proximity(
            clean_float(center.get("latitude")),
            clean_float(center.get("longitude")),
            transit_grid,
            transit_hubs,
        )
        commune_rows.append(
            {
                "code_commune": code_commune,
                "commune": clean_text(commune.get("commune")),
                "code_departement": clean_department_code(commune.get("code_departement")),
                "departement": clean_text(commune.get("departement")),
                "epci_code": clean_identifier(commune.get("epci_code")),
                "epci_nom": clean_text(commune.get("epci_nom")),
                "population_2023": clean_int(commune.get("population_2023")) or 0,
                "licences_ffn_2023": clean_int(commune.get("licences_ffn_2023")) or 0,
                "bassins_total": clean_int(commune.get("bassins_total")) or 0,
                "typo": clean_text(commune.get("typo")),
                "latitude": clean_float(center.get("latitude")),
                "longitude": clean_float(center.get("longitude")),
                **proximity,
            }
        )

    installation_rows: list[dict[str, Any]] = []
    for installation_id, site in installation_sites.items():
        proximity = summarize_transit_proximity(
            clean_float(site.get("latitude")),
            clean_float(site.get("longitude")),
            transit_grid,
            transit_hubs,
        )
        installation_rows.append(
            {
                "id_installation": installation_id,
                "installation": clean_text(site.get("installation")),
                "code_commune": clean_commune_code(site.get("code_commune")),
                "commune": clean_text(site.get("commune")),
                "epci_code": clean_identifier(site.get("epci_code")),
                "epci_nom": clean_text(site.get("epci_nom")),
                "code_departement": clean_department_code(site.get("code_departement")),
                "departement": clean_text(site.get("departement")),
                "basins_total_on_site": int(site.get("basins_total_on_site") or 0),
                "school_basins_total_on_site": int(site.get("school_basins_total_on_site") or 0),
                "latitude": clean_float(site.get("latitude")),
                "longitude": clean_float(site.get("longitude")),
                **proximity,
            }
        )

    school_rows: list[dict[str, Any]] = []
    for school in school_establishments:
        proximity = summarize_transit_proximity(
            clean_float(school.get("latitude")),
            clean_float(school.get("longitude")),
            transit_grid,
            transit_hubs,
        )
        school_rows.append(
            {
                "uai": clean_identifier(school.get("uai")),
                "school_name": clean_text(school.get("school_name")),
                "school_level": clean_text(school.get("school_level")),
                "code_commune": clean_commune_code(school.get("code_commune")),
                "commune": clean_text(school.get("commune")),
                "epci_code": clean_identifier(school.get("epci_code")),
                "epci_nom": clean_text(school.get("epci_nom")),
                "code_departement": clean_department_code(school.get("code_departement")),
                "departement": clean_text(school.get("departement")),
                "students_total": clean_int(school.get("students_total")) or 0,
                "latitude": clean_float(school.get("latitude")),
                "longitude": clean_float(school.get("longitude")),
                **proximity,
            }
        )

    commune_rows.sort(
        key=lambda item: (
            item.get("code_departement") or "",
            item.get("epci_nom") or "",
            item.get("commune") or "",
        )
    )
    installation_rows.sort(
        key=lambda item: (
            item.get("code_departement") or "",
            item.get("epci_nom") or "",
            item.get("installation") or "",
        )
    )

    return {
        "transit_overview": build_transit_summary(commune_rows, installation_rows, school_rows, len(transit_hubs)),
        "commune_transit": commune_rows,
        "transit_epci": build_transit_epci_rows(
            commune_rows,
            installation_rows,
            school_rows,
            len(transit_hubs),
        ),
        "installation_transit": installation_rows,
        "school_transit": school_rows,
    }


def build_school_demand(
    communes_frame: pd.DataFrame,
    basins: list[dict[str, Any]],
) -> dict[str, Any]:
    commune_lookup = {
        clean_commune_code(record.get("code_commune")): {
            "epci_code": clean_identifier(record.get("epci_code")),
            "epci_nom": clean_text(record.get("epci_nom")),
            "code_departement": clean_department_code(record.get("code_departement")),
            "departement": clean_text(record.get("departement")),
        }
        for record in frame_to_records(communes_frame)
        if clean_commune_code(record.get("code_commune"))
    }

    geoloc_lookup = build_geoloc_lookup(fetch_education_dataset_records("geoloc"))
    installation_sites = build_installation_sites(basins)
    basin_sites = build_basin_sites(basins)

    aggregated: dict[str, dict[str, Any]] = {}
    for record in normalize_primary_school_rows(fetch_education_dataset_records("primary")):
        merge_school_record(aggregated, record)
    for record in normalize_college_rows(fetch_education_dataset_records("college")):
        merge_school_record(aggregated, record)
    for record in normalize_lycee_gt_rows(fetch_education_dataset_records("lycee_gt")):
        merge_school_record(aggregated, record)
    for record in normalize_lycee_pro_rows(fetch_education_dataset_records("lycee_pro")):
        merge_school_record(aggregated, record)

    school_drive_lookup = build_school_drive_time_lookup(aggregated, geoloc_lookup, installation_sites)

    school_records: list[dict[str, Any]] = []
    for uai, aggregated_record in aggregated.items():
        geoloc = geoloc_lookup.get(uai, {})
        code_commune = clean_commune_code(
            geoloc.get("code_commune") or aggregated_record.get("code_commune")
        )
        commune_data = commune_lookup.get(code_commune, {})
        code_departement = clean_department_code(
            commune_data.get("code_departement")
            or geoloc.get("code_departement")
            or aggregated_record.get("code_departement")
        )
        school_name = (
            clean_text(geoloc.get("school_name"))
            or clean_text(aggregated_record.get("school_name"))
            or f"Établissement {uai}"
        )
        commune = clean_text(geoloc.get("commune")) or clean_text(aggregated_record.get("commune"))
        departement = (
            clean_text(commune_data.get("departement"))
            or clean_text(geoloc.get("departement"))
            or clean_text(aggregated_record.get("departement"))
        )
        latitude = clean_float(geoloc.get("latitude"))
        longitude = clean_float(geoloc.get("longitude"))
        nearest_installation = (
            find_nearest_site(latitude, longitude, installation_sites.values())
            if latitude is not None and longitude is not None
            else None
        )
        nearest_basin = (
            find_nearest_site(latitude, longitude, basin_sites)
            if latitude is not None and longitude is not None
            else None
        )
        drive_result = school_drive_lookup.get(uai, {})

        school_levels = sorted(aggregated_record["school_levels"])
        school_sources = sorted(aggregated_record["school_sources"])
        primary_students = int(aggregated_record["primary_students"])
        secondary_students = int(aggregated_record["secondary_students"])
        broad_level = (
            "mixed"
            if primary_students > 0 and secondary_students > 0
            else "primary"
            if primary_students > 0
            else "secondary"
        )

        school_records.append(
            {
                "uai": uai,
                "school_name": school_name,
                "school_level": " + ".join(school_levels),
                "broad_level": broad_level,
                "school_source": " + ".join(school_sources),
                "school_type": clean_text(geoloc.get("school_type")) or "Non renseigné",
                "sector": clean_text(geoloc.get("sector")) or clean_text(aggregated_record.get("sector")),
                "code_commune": code_commune,
                "commune": commune,
                "code_departement": code_departement,
                "departement": departement,
                "epci_code": clean_identifier(commune_data.get("epci_code")),
                "epci_nom": clean_text(commune_data.get("epci_nom")),
                "latitude": latitude,
                "longitude": longitude,
                "students_total": int(aggregated_record["students_total"]),
                "primary_students": primary_students,
                "secondary_students": secondary_students,
                "preprimary_students": int(aggregated_record["preprimary_students"]),
                "elementary_students": int(aggregated_record["elementary_students"]),
                "classes_total": (
                    int(aggregated_record["classes_total"])
                    if aggregated_record["has_classes_total"]
                    else None
                ),
                "nearest_installation_id": clean_identifier(
                    drive_result.get("nearest_installation_id")
                )
                or (nearest_installation["id_installation"] if nearest_installation else None),
                "nearest_installation": clean_text(drive_result.get("nearest_installation"))
                or (nearest_installation["installation"] if nearest_installation else None),
                "nearest_installation_commune": clean_text(
                    drive_result.get("nearest_installation_commune")
                )
                or (nearest_installation["commune"] if nearest_installation else None),
                "nearest_installation_epci": clean_text(
                    drive_result.get("nearest_installation_epci")
                )
                or (nearest_installation["epci_nom"] if nearest_installation else None),
                "distance_to_nearest_installation_km": clean_float(
                    drive_result.get("crow_distance_to_nearest_installation_km")
                )
                if drive_result.get("crow_distance_to_nearest_installation_km") is not None
                else nearest_installation["distance_km"]
                if nearest_installation
                else None,
                "drive_distance_to_nearest_installation_km": clean_float(
                    drive_result.get("drive_distance_to_nearest_installation_km")
                ),
                "drive_time_to_nearest_installation_min": clean_float(
                    drive_result.get("drive_time_to_nearest_installation_min")
                ),
                "nearest_basin_id": nearest_basin["id_equipement"] if nearest_basin else None,
                "nearest_basin": nearest_basin["equipement"] if nearest_basin else None,
                "nearest_basin_installation": nearest_basin["installation"] if nearest_basin else None,
                "distance_to_nearest_basin_km": nearest_basin["distance_km"] if nearest_basin else None,
            }
        )

    school_records.sort(
        key=lambda item: (
            item.get("code_departement") or "",
            item.get("epci_nom") or "",
            item.get("commune") or "",
            item.get("school_name") or "",
        )
    )

    return {
        "school_establishments": school_records,
        "school_demand_overview": build_school_demand_summary(
            school_records,
            basins_total=len(basins),
            installations_total=len(installation_sites),
            school_basins_total=sum(1 for basin in basins if clean_int(basin.get("usage_scolaires")) == 1),
        ),
        "school_demand_epci": build_school_demand_epci_rows(
            school_records, basins, installation_sites
        ),
        "school_demand_installations": build_school_demand_installation_rows(
            school_records, installation_sites
        ),
    }


def fetch_commune_centers() -> dict[str, dict[str, Any]]:
    cache_file = ACCESSIBILITY_CACHE_DIR / "centres_communes_hdf.json"

    try:
        rows: list[dict[str, Any]] = []
        for department_code in HDF_DEPARTMENT_CODES:
            url = (
                f"{GEO_API_BASE}/departements/{department_code}/communes"
                "?fields=code,nom,centre&format=json"
            )
            with urlopen(url, timeout=60) as response:
                rows.extend(json.load(response))

        cache_file.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        return build_commune_center_lookup(rows)
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        if cache_file.exists():
            print(
                f"Commune centers fallback to cache: {error}",
                file=sys.stderr,
            )
            return build_commune_center_lookup(json.loads(cache_file.read_text(encoding="utf-8")))

        print(
            f"Commune centers unavailable, continuing with an empty set: {error}",
            file=sys.stderr,
        )
        return {}


def build_commune_center_lookup(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for row in rows:
        code_commune = clean_commune_code(row.get("code"))
        coordinates = row.get("centre", {}).get("coordinates") if isinstance(row.get("centre"), dict) else None
        if not code_commune or not isinstance(coordinates, list) or len(coordinates) < 2:
            continue
        longitude = clean_float(coordinates[0])
        latitude = clean_float(coordinates[1])
        if latitude is None or longitude is None:
            continue
        lookup[code_commune] = {
            "code_commune": code_commune,
            "commune": clean_text(row.get("nom")),
            "latitude": latitude,
            "longitude": longitude,
        }
    return lookup


def build_drive_time_lookup(
    communes: list[dict[str, Any]],
    commune_centers: dict[str, dict[str, Any]],
    installation_sites: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    destinations = [
        site
        for site in installation_sites.values()
        if clean_float(site.get("latitude")) is not None and clean_float(site.get("longitude")) is not None
    ]
    if not destinations:
        return {}

    installation_signature = build_installation_signature(destinations)
    cached_results = load_accessibility_route_cache(installation_signature)
    results = dict(cached_results)
    pending_origins: list[dict[str, Any]] = []

    for commune in communes:
        code_commune = clean_commune_code(commune.get("code_commune"))
        center = commune_centers.get(code_commune)
        if not code_commune or not center:
            continue
        if code_commune in results:
            continue
        pending_origins.append(
            {
                "code_commune": code_commune,
                "latitude": clean_float(center.get("latitude")),
                "longitude": clean_float(center.get("longitude")),
            }
        )

    for batch_index, batch in enumerate(chunked(pending_origins, OSRM_SOURCE_BATCH_SIZE), start=1):
        batch_destinations = select_candidate_destinations(batch, destinations)
        batch_results = route_origin_batch(batch, batch_destinations, cached_results)
        results.update(batch_results)
        save_accessibility_route_cache(installation_signature, results)
        if batch_index % 10 == 0:
            print(
                f"Accessibility routing progress: {len(results)} / {len(pending_origins) + len(cached_results)} communes",
                file=sys.stderr,
            )
        time.sleep(0.05)

    return results


def select_candidate_destinations(
    origins: list[dict[str, Any]],
    destinations: list[dict[str, Any]],
    limit_per_origin: int = 8,
) -> list[dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for origin in origins:
        origin_latitude = clean_float(origin.get("latitude"))
        origin_longitude = clean_float(origin.get("longitude"))
        if origin_latitude is None or origin_longitude is None:
            continue

        closest_sites = sorted(
            destinations,
            key=lambda site: haversine_km(
                origin_latitude,
                origin_longitude,
                float(clean_float(site.get("latitude")) or 0),
                float(clean_float(site.get("longitude")) or 0),
            ),
        )[:limit_per_origin]

        for site in closest_sites:
            installation_id = clean_identifier(site.get("id_installation"))
            if installation_id:
                selected[installation_id] = site

    return list(selected.values()) if selected else destinations


def build_installation_signature(destinations: list[dict[str, Any]]) -> str:
    payload = "|".join(
        sorted(
            (
                f"{clean_identifier(site.get('id_installation'))}:"
                f"{clean_float(site.get('latitude'))}:"
                f"{clean_float(site.get('longitude'))}"
            )
            for site in destinations
            if clean_identifier(site.get("id_installation"))
        )
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def load_accessibility_route_cache(
    installation_signature: str,
) -> dict[str, dict[str, Any]]:
    cache_file = ACCESSIBILITY_CACHE_DIR / "communes_accessibilite_voiture_cache.json"
    if not cache_file.exists():
        return {}

    try:
        payload = json.loads(cache_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}

    if payload.get("installation_signature") != installation_signature:
        return {}

    rows = payload.get("rows", {})
    if not isinstance(rows, dict):
        return {}
    return {str(key): value for key, value in rows.items() if isinstance(value, dict)}


def save_accessibility_route_cache(
    installation_signature: str,
    rows: dict[str, dict[str, Any]],
) -> None:
    cache_file = ACCESSIBILITY_CACHE_DIR / "communes_accessibilite_voiture_cache.json"
    payload = {
        "installation_signature": installation_signature,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "rows": rows,
    }
    cache_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def route_origin_batch(
    origins: list[dict[str, Any]],
    destinations: list[dict[str, Any]],
    cached_results: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    if not origins:
        return {}

    try:
        return request_osrm_drive_times(origins, destinations)
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError, RuntimeError) as error:
        if len(origins) == 1:
            origin = origins[0]
            code_commune = clean_commune_code(origin.get("code_commune"))
            if code_commune and code_commune in cached_results:
                print(
                    f"Accessibility routing fallback to cache for commune {code_commune}: {error}",
                    file=sys.stderr,
                )
                return {code_commune: cached_results[code_commune]}

            fallback_site = find_nearest_site(
                clean_float(origin.get("latitude")),
                clean_float(origin.get("longitude")),
                destinations,
            )
            return {
                code_commune or "unknown": build_drive_route_result(
                    origin,
                    fallback_site,
                    duration_seconds=None,
                    distance_meters=None,
                )
            }

        midpoint = max(1, len(origins) // 2)
        print(
            f"Accessibility routing retry on smaller batches ({len(origins)} communes): {error}",
            file=sys.stderr,
        )
        left = route_origin_batch(origins[:midpoint], destinations, cached_results)
        right = route_origin_batch(origins[midpoint:], destinations, cached_results)
        return {**left, **right}


def request_osrm_drive_times(
    origins: list[dict[str, Any]],
    destinations: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    coordinates = [
        f"{float(clean_float(origin['longitude']) or 0):.6f},{float(clean_float(origin['latitude']) or 0):.6f}"
        for origin in origins
    ]
    coordinates.extend(
        f"{float(clean_float(destination['longitude']) or 0):.6f},{float(clean_float(destination['latitude']) or 0):.6f}"
        for destination in destinations
    )

    source_indexes = ";".join(str(index) for index in range(len(origins)))
    destination_indexes = ";".join(
        str(index) for index in range(len(origins), len(origins) + len(destinations))
    )
    url = (
        f"{OSRM_TABLE_BASE}/"
        f"{';'.join(coordinates)}"
        f"?sources={source_indexes}&destinations={destination_indexes}&annotations=duration,distance"
    )
    with urlopen(url, timeout=120) as response:
        payload = json.load(response)

    if payload.get("code") != "Ok":
        raise RuntimeError(f"OSRM table returned {payload.get('code')}")

    durations = payload.get("durations", [])
    distances = payload.get("distances", [])
    results: dict[str, dict[str, Any]] = {}

    for source_index, origin in enumerate(origins):
        row_durations = durations[source_index] if source_index < len(durations) else []
        row_distances = distances[source_index] if source_index < len(distances) else []
        best_destination_index: int | None = None
        best_duration: float | None = None

        for destination_index, duration in enumerate(row_durations):
            if duration is None:
                continue
            if best_duration is None or float(duration) < best_duration:
                best_duration = float(duration)
                best_destination_index = destination_index

        if best_destination_index is None:
            fallback_site = find_nearest_site(
                clean_float(origin.get("latitude")),
                clean_float(origin.get("longitude")),
                destinations,
            )
            results[origin["code_commune"]] = build_drive_route_result(
                origin,
                fallback_site,
                duration_seconds=None,
                distance_meters=None,
            )
            continue

        selected_site = destinations[best_destination_index]
        selected_distance = (
            row_distances[best_destination_index]
            if best_destination_index < len(row_distances)
            else None
        )
        results[origin["code_commune"]] = build_drive_route_result(
            origin,
            selected_site,
            duration_seconds=best_duration,
            distance_meters=selected_distance,
        )

    return results


def build_drive_route_result(
    origin: dict[str, Any],
    site: dict[str, Any] | None,
    *,
    duration_seconds: float | int | None,
    distance_meters: float | int | None,
) -> dict[str, Any]:
    if site is None:
        return {
            "nearest_installation_id": None,
            "nearest_installation": None,
            "nearest_installation_commune": None,
            "nearest_installation_epci": None,
            "crow_distance_to_nearest_installation_km": None,
            "drive_distance_to_nearest_installation_km": None,
            "drive_time_to_nearest_installation_min": None,
        }

    origin_latitude = clean_float(origin.get("latitude"))
    origin_longitude = clean_float(origin.get("longitude"))
    site_latitude = clean_float(site.get("latitude"))
    site_longitude = clean_float(site.get("longitude"))
    crow_distance = (
        round(haversine_km(origin_latitude, origin_longitude, site_latitude, site_longitude), 3)
        if origin_latitude is not None
        and origin_longitude is not None
        and site_latitude is not None
        and site_longitude is not None
        else None
    )

    return {
        "nearest_installation_id": clean_identifier(site.get("id_installation")),
        "nearest_installation": clean_text(site.get("installation")),
        "nearest_installation_commune": clean_text(site.get("commune")),
        "nearest_installation_epci": clean_text(site.get("epci_nom")),
        "crow_distance_to_nearest_installation_km": crow_distance,
        "drive_distance_to_nearest_installation_km": (
            round(float(distance_meters) / 1000, 3) if distance_meters is not None else None
        ),
        "drive_time_to_nearest_installation_min": (
            round(float(duration_seconds) / 60, 2) if duration_seconds is not None else None
        ),
    }


def build_school_drive_time_lookup(
    aggregated: dict[str, dict[str, Any]],
    geoloc_lookup: dict[str, dict[str, Any]],
    installation_sites: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    destinations = [
        site
        for site in installation_sites.values()
        if clean_float(site.get("latitude")) is not None and clean_float(site.get("longitude")) is not None
    ]
    if not destinations:
        return {}

    installation_signature = build_installation_signature(destinations)
    cached_results = load_school_route_cache(installation_signature)
    results = dict(cached_results)
    pending_origins: list[dict[str, Any]] = []

    for uai in aggregated:
        geoloc = geoloc_lookup.get(uai, {})
        latitude = clean_float(geoloc.get("latitude"))
        longitude = clean_float(geoloc.get("longitude"))
        if latitude is None or longitude is None or uai in results:
            continue
        pending_origins.append(
            {
                "code_commune": uai,
                "latitude": latitude,
                "longitude": longitude,
            }
        )

    for batch_index, batch in enumerate(chunked(pending_origins, OSRM_SCHOOL_SOURCE_BATCH_SIZE), start=1):
        batch_destinations = select_candidate_destinations(batch, destinations, limit_per_origin=5)
        batch_results = route_origin_batch(batch, batch_destinations, cached_results)
        results.update(batch_results)
        save_school_route_cache(installation_signature, results)
        if batch_index % 20 == 0:
            print(
                f"School routing progress: {len(results)} / {len(pending_origins) + len(cached_results)} etablissements",
                file=sys.stderr,
            )
        time.sleep(0.02)

    return results


def load_school_route_cache(
    installation_signature: str,
) -> dict[str, dict[str, Any]]:
    cache_file = ACCESSIBILITY_CACHE_DIR / "etablissements_accessibilite_voiture_cache.json"
    if not cache_file.exists():
        return {}

    try:
        payload = json.loads(cache_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}

    if payload.get("installation_signature") != installation_signature:
        return {}

    rows = payload.get("rows", {})
    if not isinstance(rows, dict):
        return {}
    return {str(key): value for key, value in rows.items() if isinstance(value, dict)}


def save_school_route_cache(
    installation_signature: str,
    rows: dict[str, dict[str, Any]],
) -> None:
    cache_file = ACCESSIBILITY_CACHE_DIR / "etablissements_accessibilite_voiture_cache.json"
    payload = {
        "installation_signature": installation_signature,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "rows": rows,
    }
    cache_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_json(url: str, *, timeout: int = 60) -> dict[str, Any]:
    with urlopen(url, timeout=timeout) as response:
        payload = json.load(response)
    return payload if isinstance(payload, dict) else {}


def fetch_education_dataset_records(dataset_key: str) -> list[dict[str, Any]]:
    config = EDUCATION_DATASETS[dataset_key]
    cache_file = EDUCATION_CACHE_DIR / config["cache_name"]

    try:
        results: list[dict[str, Any]] = []
        offset = 0

        while True:
            query = urlencode(
                {
                    "where": config["where"],
                    "limit": ODS_PAGE_SIZE,
                    "offset": offset,
                }
            )
            url = f"{EDUCATION_API_BASE}/{config['dataset']}/records?{query}"
            with urlopen(url, timeout=60) as response:
                payload = json.load(response)

            chunk = payload.get("results", [])
            if not chunk:
                break

            results.extend(chunk)
            total_count = int(payload.get("total_count", len(results)))
            offset += len(chunk)
            if offset >= total_count:
                break

        cache_file.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
        return results
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        if cache_file.exists():
            print(
                f"Education dataset fallback to cache for {dataset_key}: {error}",
                file=sys.stderr,
            )
            return json.loads(cache_file.read_text(encoding="utf-8"))

        print(
            f"Education dataset unavailable for {dataset_key}, continuing with an empty set: {error}",
            file=sys.stderr,
        )
        return []


def build_geoloc_lookup(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for row in rows:
        uai = clean_identifier(row.get("identifiant_de_l_etablissement"))
        if not uai:
            continue
        lookup[uai] = {
            "school_name": build_school_name(row.get("nom_etablissement")),
            "school_type": clean_text(row.get("type_etablissement")) or clean_text(row.get("libelle_nature")),
            "sector": clean_text(row.get("statut_public_prive")),
            "code_commune": clean_commune_code(row.get("code_commune")),
            "commune": clean_text(row.get("nom_commune")),
            "code_departement": clean_department_code(row.get("code_departement")),
            "departement": clean_text(row.get("libelle_departement")),
            "latitude": clean_float(row.get("latitude")),
            "longitude": clean_float(row.get("longitude")),
        }
    return lookup


def normalize_primary_school_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "uai": clean_identifier(row.get("numero_ecole")),
            "school_name": build_school_name(
                row.get("denomination_principale"),
                row.get("patronyme"),
            ),
            "school_level": "École",
            "school_source": "Écoles",
            "sector": clean_text(row.get("secteur")),
            "code_commune": clean_commune_code(row.get("code_commune")),
            "commune": clean_text(row.get("commune")),
            "code_departement": clean_department_code(row.get("code_departement")),
            "departement": clean_text(row.get("departement")),
            "students_total": clean_int(row.get("nombre_total_eleves")) or 0,
            "primary_students": clean_int(row.get("nombre_total_eleves")) or 0,
            "secondary_students": 0,
            "preprimary_students": clean_int(row.get("nombre_eleves_preelementaire_hors_ulis")) or 0,
            "elementary_students": clean_int(row.get("nombre_eleves_elementaire_hors_ulis")) or 0,
            "classes_total": clean_int(row.get("nombre_total_classes")),
        }
        for row in rows
        if clean_identifier(row.get("numero_ecole"))
    ]


def normalize_college_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "uai": clean_identifier(row.get("numero_college")),
            "school_name": build_school_name(
                row.get("denomination_principale"),
                row.get("patronyme"),
            ),
            "school_level": "Collège",
            "school_source": "Collèges",
            "sector": clean_text(row.get("secteur")),
            "code_commune": clean_commune_code(row.get("code_commune")),
            "commune": clean_text(row.get("commune")),
            "code_departement": clean_department_code(row.get("code_dept")),
            "departement": clean_text(row.get("departement")),
            "students_total": clean_int(row.get("nombre_eleves_total")) or 0,
            "primary_students": 0,
            "secondary_students": clean_int(row.get("nombre_eleves_total")) or 0,
            "preprimary_students": 0,
            "elementary_students": 0,
            "classes_total": None,
        }
        for row in rows
        if clean_identifier(row.get("numero_college"))
    ]


def normalize_lycee_gt_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "uai": clean_identifier(row.get("numero_lycee")),
            "school_name": build_school_name(
                row.get("denomination_principale"),
                row.get("patronyme"),
            ),
            "school_level": "Lycée GT",
            "school_source": "Lycées GT",
            "sector": clean_text(row.get("secteur")),
            "code_commune": clean_commune_code(row.get("code_commune")),
            "commune": clean_text(row.get("commune")),
            "code_departement": clean_department_code(row.get("code_departement_pays")),
            "departement": clean_text(row.get("departement")),
            "students_total": clean_int(row.get("nombre_d_eleves")) or 0,
            "primary_students": 0,
            "secondary_students": clean_int(row.get("nombre_d_eleves")) or 0,
            "preprimary_students": 0,
            "elementary_students": 0,
            "classes_total": None,
        }
        for row in rows
        if clean_identifier(row.get("numero_lycee"))
    ]


def normalize_lycee_pro_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "uai": clean_identifier(row.get("numero_d_etablissement")),
            "school_name": build_school_name(row.get("patronyme")),
            "school_level": "Lycée pro / BTS",
            "school_source": "Lycées pro / BTS",
            "sector": clean_text(row.get("secteur_d_enseignement_lib_l")),
            "code_commune": clean_commune_code(row.get("commune_d_implantation")),
            "commune": clean_text(row.get("commune_d_implantation_lib_l")),
            "code_departement": clean_department_code(str(row.get("code_postal", ""))[:2]),
            "departement": None,
            "students_total": clean_int(row.get("nombre_d_eleves_total")) or 0,
            "primary_students": 0,
            "secondary_students": clean_int(row.get("nombre_d_eleves_total")) or 0,
            "preprimary_students": 0,
            "elementary_students": 0,
            "classes_total": None,
        }
        for row in rows
        if clean_identifier(row.get("numero_d_etablissement"))
    ]


def merge_school_record(aggregated: dict[str, dict[str, Any]], row: dict[str, Any]) -> None:
    uai = clean_identifier(row.get("uai"))
    if not uai:
        return

    current = aggregated.setdefault(
        uai,
        {
            "school_name": None,
            "sector": None,
            "code_commune": None,
            "commune": None,
            "code_departement": None,
            "departement": None,
            "students_total": 0,
            "primary_students": 0,
            "secondary_students": 0,
            "preprimary_students": 0,
            "elementary_students": 0,
            "classes_total": 0,
            "has_classes_total": False,
            "school_levels": set(),
            "school_sources": set(),
        },
    )

    current["school_name"] = current["school_name"] or clean_text(row.get("school_name"))
    current["sector"] = current["sector"] or clean_text(row.get("sector"))
    current["code_commune"] = current["code_commune"] or clean_commune_code(row.get("code_commune"))
    current["commune"] = current["commune"] or clean_text(row.get("commune"))
    current["code_departement"] = current["code_departement"] or clean_department_code(
        row.get("code_departement")
    )
    current["departement"] = current["departement"] or clean_text(row.get("departement"))
    current["students_total"] += clean_int(row.get("students_total")) or 0
    current["primary_students"] += clean_int(row.get("primary_students")) or 0
    current["secondary_students"] += clean_int(row.get("secondary_students")) or 0
    current["preprimary_students"] += clean_int(row.get("preprimary_students")) or 0
    current["elementary_students"] += clean_int(row.get("elementary_students")) or 0

    classes_total = clean_int(row.get("classes_total"))
    if classes_total is not None:
        current["classes_total"] += classes_total
        current["has_classes_total"] = True
    if clean_text(row.get("school_level")):
        current["school_levels"].add(clean_text(row.get("school_level")))
    if clean_text(row.get("school_source")):
        current["school_sources"].add(clean_text(row.get("school_source")))


def build_installation_sites(basins: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for basin in basins:
        installation_id = clean_identifier(basin.get("id_installation"))
        if installation_id:
            grouped[installation_id].append(basin)

    sites: dict[str, dict[str, Any]] = {}
    for installation_id, items in grouped.items():
        coordinates = []
        for item in items:
            latitude = clean_float(item.get("latitude"))
            longitude = clean_float(item.get("longitude"))
            if latitude is not None and longitude is not None:
                coordinates.append((float(latitude), float(longitude)))

        latitude = average(value[0] for value in coordinates) if coordinates else None
        longitude = average(value[1] for value in coordinates) if coordinates else None
        reference = items[0]
        sites[installation_id] = {
            "id_installation": installation_id,
            "installation": clean_text(reference.get("installation")),
            "code_commune": clean_commune_code(reference.get("code_commune")),
            "commune": clean_text(reference.get("commune")),
            "epci_code": clean_identifier(reference.get("epci_code")),
            "epci_nom": clean_text(reference.get("epci_nom")),
            "code_departement": clean_department_code(reference.get("dep_code")),
            "departement": clean_text(reference.get("departement")),
            "latitude": latitude,
            "longitude": longitude,
            "basins_total_on_site": len(items),
            "school_basins_total_on_site": sum(
                1 for item in items if clean_int(item.get("usage_scolaires")) == 1
            ),
        }
    return sites


def build_basin_sites(basins: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sites: list[dict[str, Any]] = []
    for basin in basins:
        latitude = clean_float(basin.get("latitude"))
        longitude = clean_float(basin.get("longitude"))
        if latitude is None or longitude is None:
            continue
        sites.append(
            {
                "id_equipement": clean_identifier(basin.get("id_equipement")),
                "equipement": clean_text(basin.get("equipement")),
                "installation": clean_text(basin.get("installation")),
                "latitude": latitude,
                "longitude": longitude,
            }
        )
    return sites


def build_school_demand_epci_rows(
    schools: list[dict[str, Any]],
    basins: list[dict[str, Any]],
    installation_sites: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    schools_by_epci: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for school in schools:
        epci_code = clean_identifier(school.get("epci_code"))
        if epci_code:
            schools_by_epci[epci_code].append(school)

    basins_by_epci: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for basin in basins:
        epci_code = clean_identifier(basin.get("epci_code"))
        if epci_code:
            basins_by_epci[epci_code].append(basin)

    installation_counts_by_epci: dict[str, int] = defaultdict(int)
    for site in installation_sites.values():
        epci_code = clean_identifier(site.get("epci_code"))
        if epci_code:
            installation_counts_by_epci[epci_code] += 1

    rows: list[dict[str, Any]] = []
    for epci_code, items in schools_by_epci.items():
        reference = items[0]
        local_basins = basins_by_epci.get(epci_code, [])
        summary = build_school_demand_summary(
            items,
            basins_total=len(local_basins),
            installations_total=installation_counts_by_epci.get(epci_code, 0),
            school_basins_total=sum(
                1 for basin in local_basins if clean_int(basin.get("usage_scolaires")) == 1
            ),
        )
        rows.append(
            {
                "epci_code": epci_code,
                "epci_nom": clean_text(reference.get("epci_nom")),
                "code_departement": clean_department_code(reference.get("code_departement")),
                "departement": clean_text(reference.get("departement")),
                **summary,
            }
        )

    rows.sort(
        key=lambda item: (
            -(item.get("students_per_installation") or 0),
            -(item.get("students_total") or 0),
            item.get("epci_nom") or "",
        )
    )
    return rows


def build_school_demand_installation_rows(
    schools: list[dict[str, Any]],
    installation_sites: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    schools_by_installation: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for school in schools:
        installation_id = clean_identifier(school.get("nearest_installation_id"))
        if installation_id:
            schools_by_installation[installation_id].append(school)

    rows: list[dict[str, Any]] = []
    for installation_id, site in installation_sites.items():
        items = schools_by_installation.get(installation_id, [])
        summary = build_school_demand_summary(
            items,
            basins_total=int(site.get("basins_total_on_site") or 0),
            installations_total=1,
            school_basins_total=int(site.get("school_basins_total_on_site") or 0),
        )
        rows.append(
            {
                "id_installation": installation_id,
                "installation": clean_text(site.get("installation")),
                "code_commune": clean_commune_code(site.get("code_commune")),
                "commune": clean_text(site.get("commune")),
                "epci_code": clean_identifier(site.get("epci_code")),
                "epci_nom": clean_text(site.get("epci_nom")),
                "code_departement": clean_department_code(site.get("code_departement")),
                "departement": clean_text(site.get("departement")),
                "basins_total_on_site": int(site.get("basins_total_on_site") or 0),
                "school_basins_total_on_site": int(site.get("school_basins_total_on_site") or 0),
                "students_per_basin_on_site": summary["students_per_basin"],
                "students_per_school_basin_on_site": summary["students_per_school_basin"],
                **summary,
            }
        )

    rows.sort(key=lambda item: (-(item.get("students_total") or 0), item.get("installation") or ""))
    return rows


def build_school_demand_summary(
    schools: list[dict[str, Any]],
    *,
    basins_total: int,
    installations_total: int,
    school_basins_total: int,
) -> dict[str, Any]:
    students_total = int(sum(clean_int(item.get("students_total")) or 0 for item in schools))
    primary_students = int(sum(clean_int(item.get("primary_students")) or 0 for item in schools))
    secondary_students = int(sum(clean_int(item.get("secondary_students")) or 0 for item in schools))
    schools_geolocated_total = sum(
        1
        for item in schools
        if clean_float(item.get("latitude")) is not None and clean_float(item.get("longitude")) is not None
    )
    students_geolocated_total = int(
        sum(
            clean_int(item.get("students_total")) or 0
            for item in schools
            if clean_float(item.get("distance_to_nearest_installation_km")) is not None
        )
    )
    students_within_5km = int(
        sum(
            clean_int(item.get("students_total")) or 0
            for item in schools
            if (
                clean_float(item.get("distance_to_nearest_installation_km")) is not None
                and float(clean_float(item.get("distance_to_nearest_installation_km")) or 0) <= 5
            )
        )
    )
    students_with_drive_time_total = int(
        sum(
            clean_int(item.get("students_total")) or 0
            for item in schools
            if clean_float(item.get("drive_time_to_nearest_installation_min")) is not None
        )
    )
    students_within_15min = int(
        sum(
            clean_int(item.get("students_total")) or 0
            for item in schools
            if (
                clean_float(item.get("drive_time_to_nearest_installation_min")) is not None
                and float(clean_float(item.get("drive_time_to_nearest_installation_min")) or 0) <= 15
            )
        )
    )

    return {
        "schools_total": len(schools),
        "schools_geolocated_total": schools_geolocated_total,
        "students_total": students_total,
        "students_geolocated_total": students_geolocated_total,
        "primary_students": primary_students,
        "secondary_students": secondary_students,
        "distance_coverage_share": safe_divide(students_geolocated_total, students_total),
        "drive_time_coverage_share": safe_divide(students_with_drive_time_total, students_total),
        "average_distance_to_installation_km": weighted_average(
            schools,
            lambda item: clean_float(item.get("distance_to_nearest_installation_km")),
            lambda item: clean_int(item.get("students_total")) or 0,
        ),
        "average_drive_time_to_installation_min": weighted_average(
            schools,
            lambda item: clean_float(item.get("drive_time_to_nearest_installation_min")),
            lambda item: clean_int(item.get("students_total")) or 0,
        ),
        "average_drive_distance_to_installation_km": weighted_average(
            schools,
            lambda item: clean_float(item.get("drive_distance_to_nearest_installation_km")),
            lambda item: clean_int(item.get("students_total")) or 0,
        ),
        "average_distance_to_basin_km": weighted_average(
            schools,
            lambda item: clean_float(item.get("distance_to_nearest_basin_km")),
            lambda item: clean_int(item.get("students_total")) or 0,
        ),
        "students_within_5km_installation_share": safe_divide(
            students_within_5km, students_geolocated_total
        ),
        "students_within_15min_installation_share": safe_divide(
            students_within_15min, students_with_drive_time_total
        ),
        "basins_total": basins_total,
        "installations_total": installations_total,
        "school_basins_total": school_basins_total,
        "students_per_basin": safe_divide(students_total, basins_total),
        "students_per_installation": safe_divide(students_total, installations_total),
        "students_per_school_basin": safe_divide(students_total, school_basins_total),
    }


def build_accessibility_epci_rows(
    communes: list[dict[str, Any]],
    installations_total: int,
) -> list[dict[str, Any]]:
    communes_by_epci: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for commune in communes:
        epci_code = clean_identifier(commune.get("epci_code"))
        if epci_code:
            communes_by_epci[epci_code].append(commune)

    rows: list[dict[str, Any]] = []
    for epci_code, items in communes_by_epci.items():
        reference = items[0]
        summary = build_accessibility_summary(items, installations_total)
        rows.append(
            {
                "epci_code": epci_code,
                "epci_nom": clean_text(reference.get("epci_nom")),
                "code_departement": clean_department_code(reference.get("code_departement")),
                "departement": clean_text(reference.get("departement")),
                **summary,
            }
        )

    rows.sort(
        key=lambda item: (
            -(item.get("average_drive_time_to_installation_min") or 0),
            item.get("epci_nom") or "",
        )
    )
    return rows


def build_accessibility_summary(
    communes: list[dict[str, Any]],
    installations_total: int,
) -> dict[str, Any]:
    population_total = int(sum(clean_int(item.get("population_2023")) or 0 for item in communes))
    routed_communes = [
        item
        for item in communes
        if clean_float(item.get("drive_time_to_nearest_installation_min")) is not None
    ]
    population_routed_total = int(
        sum(clean_int(item.get("population_2023")) or 0 for item in routed_communes)
    )

    return {
        "communes_total": len(communes),
        "communes_routed_total": len(routed_communes),
        "population_total": population_total,
        "population_routed_total": population_routed_total,
        "installations_total": installations_total,
        "reachable_installations_total": count_unique_records(
            routed_communes, "nearest_installation_id"
        ),
        "average_drive_time_to_installation_min": weighted_average(
            routed_communes,
            lambda item: clean_float(item.get("drive_time_to_nearest_installation_min")),
            lambda item: clean_int(item.get("population_2023")) or 0,
        ),
        "average_drive_distance_to_installation_km": weighted_average(
            routed_communes,
            lambda item: clean_float(item.get("drive_distance_to_nearest_installation_km")),
            lambda item: clean_int(item.get("population_2023")) or 0,
        ),
        "population_within_10min_share": safe_divide(
            sum(
                clean_int(item.get("population_2023")) or 0
                for item in routed_communes
                if float(clean_float(item.get("drive_time_to_nearest_installation_min")) or 0) <= 10
            ),
            population_routed_total,
        ),
        "population_within_15min_share": safe_divide(
            sum(
                clean_int(item.get("population_2023")) or 0
                for item in routed_communes
                if float(clean_float(item.get("drive_time_to_nearest_installation_min")) or 0) <= 15
            ),
            population_routed_total,
        ),
        "population_within_20min_share": safe_divide(
            sum(
                clean_int(item.get("population_2023")) or 0
                for item in routed_communes
                if float(clean_float(item.get("drive_time_to_nearest_installation_min")) or 0) <= 20
            ),
            population_routed_total,
        ),
        "communes_within_10min_share": safe_divide(
            sum(
                1
                for item in routed_communes
                if float(clean_float(item.get("drive_time_to_nearest_installation_min")) or 0) <= 10
            ),
            len(routed_communes),
        ),
        "communes_within_15min_share": safe_divide(
            sum(
                1
                for item in routed_communes
                if float(clean_float(item.get("drive_time_to_nearest_installation_min")) or 0) <= 15
            ),
            len(routed_communes),
        ),
        "communes_within_20min_share": safe_divide(
            sum(
                1
                for item in routed_communes
                if float(clean_float(item.get("drive_time_to_nearest_installation_min")) or 0) <= 20
            ),
            len(routed_communes),
        ),
    }


def build_transit_epci_rows(
    communes: list[dict[str, Any]],
    installations: list[dict[str, Any]],
    schools: list[dict[str, Any]],
    transit_hubs_total: int,
) -> list[dict[str, Any]]:
    communes_by_epci: dict[str, list[dict[str, Any]]] = defaultdict(list)
    installations_by_epci: dict[str, list[dict[str, Any]]] = defaultdict(list)
    schools_by_epci: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for commune in communes:
        epci_code = clean_identifier(commune.get("epci_code"))
        if epci_code:
            communes_by_epci[epci_code].append(commune)

    for installation in installations:
        epci_code = clean_identifier(installation.get("epci_code"))
        if epci_code:
            installations_by_epci[epci_code].append(installation)

    for school in schools:
        epci_code = clean_identifier(school.get("epci_code"))
        if epci_code:
            schools_by_epci[epci_code].append(school)

    rows: list[dict[str, Any]] = []
    for epci_code, items in communes_by_epci.items():
        reference = items[0]
        summary = build_transit_summary(
            items,
            installations_by_epci.get(epci_code, []),
            schools_by_epci.get(epci_code, []),
            transit_hubs_total,
        )
        rows.append(
            {
                "epci_code": epci_code,
                "epci_nom": clean_text(reference.get("epci_nom")),
                "code_departement": clean_department_code(reference.get("code_departement")),
                "departement": clean_text(reference.get("departement")),
                **summary,
            }
        )

    rows.sort(
        key=lambda item: (
            float(item.get("average_nearest_stop_distance_km") or 0),
            -(item.get("population_within_500m_share") or 0),
            item.get("epci_nom") or "",
        )
    )
    return rows


def build_transit_summary(
    communes: list[dict[str, Any]],
    installations: list[dict[str, Any]],
    schools: list[dict[str, Any]],
    transit_hubs_total: int,
) -> dict[str, Any]:
    population_total = int(sum(clean_int(item.get("population_2023")) or 0 for item in communes))
    geolocated_communes = [
        item for item in communes if clean_float(item.get("nearest_transit_distance_km")) is not None
    ]
    population_geolocated_total = int(
        sum(clean_int(item.get("population_2023")) or 0 for item in geolocated_communes)
    )

    geolocated_installations = [
        item
        for item in installations
        if clean_float(item.get("nearest_transit_distance_km")) is not None
    ]

    students_total = int(sum(clean_int(item.get("students_total")) or 0 for item in schools))
    geolocated_schools = [
        item for item in schools if clean_float(item.get("nearest_transit_distance_km")) is not None
    ]
    students_geolocated_total = int(
        sum(clean_int(item.get("students_total")) or 0 for item in geolocated_schools)
    )

    return {
        "communes_total": len(communes),
        "communes_geolocated_total": len(geolocated_communes),
        "population_total": population_total,
        "population_geolocated_total": population_geolocated_total,
        "transit_hubs_total": transit_hubs_total,
        "average_nearest_stop_distance_km": weighted_average(
            geolocated_communes,
            lambda item: clean_float(item.get("nearest_transit_distance_km")),
            lambda item: clean_int(item.get("population_2023")) or 0,
        ),
        "average_weekday_trips_within_1000m": weighted_average(
            geolocated_communes,
            lambda item: clean_float(item.get("weekday_trips_within_1000m")),
            lambda item: clean_int(item.get("population_2023")) or 0,
        ),
        "population_within_500m_share": safe_divide(
            sum(
                clean_int(item.get("population_2023")) or 0
                for item in geolocated_communes
                if float(clean_float(item.get("nearest_transit_distance_km")) or 0)
                <= TRANSIT_NEAR_DISTANCE_KM
            ),
            population_geolocated_total,
        ),
        "population_within_1000m_share": safe_divide(
            sum(
                clean_int(item.get("population_2023")) or 0
                for item in geolocated_communes
                if float(clean_float(item.get("nearest_transit_distance_km")) or 0)
                <= TRANSIT_WIDE_DISTANCE_KM
            ),
            population_geolocated_total,
        ),
        "communes_within_500m_share": safe_divide(
            sum(
                1
                for item in geolocated_communes
                if float(clean_float(item.get("nearest_transit_distance_km")) or 0)
                <= TRANSIT_NEAR_DISTANCE_KM
            ),
            len(geolocated_communes),
        ),
        "communes_within_1000m_share": safe_divide(
            sum(
                1
                for item in geolocated_communes
                if float(clean_float(item.get("nearest_transit_distance_km")) or 0)
                <= TRANSIT_WIDE_DISTANCE_KM
            ),
            len(geolocated_communes),
        ),
        "installations_total": len(installations),
        "installations_geolocated_total": len(geolocated_installations),
        "installations_within_500m_share": safe_divide(
            sum(
                1
                for item in geolocated_installations
                if float(clean_float(item.get("nearest_transit_distance_km")) or 0)
                <= TRANSIT_NEAR_DISTANCE_KM
            ),
            len(geolocated_installations),
        ),
        "installations_within_1000m_share": safe_divide(
            sum(
                1
                for item in geolocated_installations
                if float(clean_float(item.get("nearest_transit_distance_km")) or 0)
                <= TRANSIT_WIDE_DISTANCE_KM
            ),
            len(geolocated_installations),
        ),
        "schools_total": len(schools),
        "students_total": students_total,
        "students_geolocated_total": students_geolocated_total,
        "average_school_nearest_stop_distance_km": weighted_average(
            geolocated_schools,
            lambda item: clean_float(item.get("nearest_transit_distance_km")),
            lambda item: clean_int(item.get("students_total")) or 0,
        ),
        "students_within_500m_share": safe_divide(
            sum(
                clean_int(item.get("students_total")) or 0
                for item in geolocated_schools
                if float(clean_float(item.get("nearest_transit_distance_km")) or 0)
                <= TRANSIT_NEAR_DISTANCE_KM
            ),
            students_geolocated_total,
        ),
        "students_within_1000m_share": safe_divide(
            sum(
                clean_int(item.get("students_total")) or 0
                for item in geolocated_schools
                if float(clean_float(item.get("nearest_transit_distance_km")) or 0)
                <= TRANSIT_WIDE_DISTANCE_KM
            ),
            students_geolocated_total,
        ),
    }


def load_gtfs_transit_hubs() -> list[dict[str, Any]]:
    cache_file = TRANSPORT_CACHE_DIR / "offre_tc_potentielle_cache.json"
    cached_payload: dict[str, Any] = {}
    if cache_file.exists():
        try:
            cached_payload = json.loads(cache_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            cached_payload = {}

    try:
        resources = fetch_gtfs_resources()
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, RuntimeError):
        cached_rows = cached_payload.get("rows", [])
        if isinstance(cached_rows, list):
            return [row for row in cached_rows if isinstance(row, dict)]
        raise

    signature = build_gtfs_catalog_signature(resources)

    if cached_payload.get("signature") == signature:
        cached_rows = cached_payload.get("rows", [])
        if isinstance(cached_rows, list):
            return [row for row in cached_rows if isinstance(row, dict)]

    all_hubs: list[dict[str, Any]] = []
    for resource in resources:
        zip_path = download_gtfs_resource(resource)
        all_hubs.extend(parse_gtfs_resource_hubs(zip_path, resource))

    merged_hubs = merge_gtfs_hubs(all_hubs)
    payload = {
        "signature": signature,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "rows": merged_hubs,
    }
    cache_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged_hubs


def fetch_gtfs_resources() -> list[dict[str, Any]]:
    resources: list[dict[str, Any]] = []
    for dataset_id in GTFS_DATASET_IDS.values():
        url = f"{TRANSPORT_DATASET_API_BASE}/{dataset_id}"
        payload = fetch_json(url)
        dataset_title = clean_text(payload.get("title"))
        for resource in payload.get("resources", []):
            if not isinstance(resource, dict):
                continue
            if clean_text(resource.get("format")) != "GTFS":
                continue
            if not resource.get("is_available", True):
                continue
            download_url = clean_text(resource.get("url")) or clean_text(resource.get("original_url"))
            if not download_url:
                continue
            metadata = resource.get("metadata") if isinstance(resource.get("metadata"), dict) else {}
            resources.append(
                {
                    "dataset_id": dataset_id,
                    "dataset_title": dataset_title,
                    "resource_id": clean_identifier(resource.get("datagouv_id") or resource.get("id")),
                    "resource_title": clean_text(resource.get("title")),
                    "download_url": download_url,
                    "updated_at": clean_text(resource.get("updated")),
                    "modes": sorted(
                        {
                            clean_text(mode).lower()
                            for mode in resource.get("modes", [])
                            if clean_text(mode)
                        }
                    ),
                    "start_date": clean_text(metadata.get("start_date")),
                    "end_date": clean_text(metadata.get("end_date")),
                }
            )

    resources.sort(key=lambda item: (item.get("dataset_title") or "", item.get("resource_title") or ""))
    return resources


def build_gtfs_catalog_signature(resources: list[dict[str, Any]]) -> str:
    digest_source = "|".join(
        f"{item.get('resource_id')}:{item.get('updated_at')}:{item.get('download_url')}"
        for item in resources
    )
    return hashlib.sha256(digest_source.encode("utf-8")).hexdigest()


def download_gtfs_resource(resource: dict[str, Any]) -> Path:
    resource_id = clean_identifier(resource.get("resource_id")) or "resource"
    updated_label = re.sub(r"[^0-9A-Za-z]+", "", clean_text(resource.get("updated_at")) or "latest")
    target = TRANSPORT_CACHE_DIR / f"{resource_id}_{updated_label}.zip"
    if target.exists():
        return target

    try:
        with urlopen(str(resource["download_url"]), timeout=180) as response:
            with target.open("wb") as handle:
                shutil.copyfileobj(response, handle)
        return target
    except (HTTPError, URLError, TimeoutError):
        cached_matches = sorted(TRANSPORT_CACHE_DIR.glob(f"{resource_id}_*.zip"))
        if cached_matches:
            return cached_matches[-1]
        raise


def parse_gtfs_resource_hubs(zip_path: Path, resource: dict[str, Any]) -> list[dict[str, Any]]:
    with zipfile.ZipFile(zip_path) as archive:
        stops_rows = read_gtfs_rows(archive, "stops.txt")
        trips_rows = read_gtfs_rows(archive, "trips.txt")
        calendar_rows = read_gtfs_rows(archive, "calendar.txt", required=False)
        calendar_dates_rows = read_gtfs_rows(archive, "calendar_dates.txt", required=False)
        stop_times_rows = iter_gtfs_rows(archive, "stop_times.txt")

        active_service_ids = select_gtfs_active_service_ids(
            calendar_rows,
            calendar_dates_rows,
            clean_text(resource.get("start_date")),
            clean_text(resource.get("end_date")),
        )
        if not active_service_ids:
            active_service_ids = {
                clean_identifier(row.get("service_id"))
                for row in trips_rows
                if clean_identifier(row.get("service_id"))
            }

        active_trip_ids = {
            clean_identifier(row.get("trip_id"))
            for row in trips_rows
            if clean_identifier(row.get("service_id")) in active_service_ids
            and clean_identifier(row.get("trip_id"))
        }
        if not active_trip_ids:
            return []

        stop_trip_counts: dict[str, int] = defaultdict(int)
        for row in stop_times_rows:
            trip_id = clean_identifier(row.get("trip_id"))
            stop_id = clean_identifier(row.get("stop_id"))
            if trip_id in active_trip_ids and stop_id:
                stop_trip_counts[stop_id] += 1

        return build_gtfs_hubs_from_rows(stops_rows, stop_trip_counts, resource)


def read_gtfs_rows(
    archive: zipfile.ZipFile,
    filename: str,
    *,
    required: bool = True,
) -> list[dict[str, Any]]:
    try:
        with archive.open(filename) as handle:
            wrapper = io.TextIOWrapper(handle, encoding="utf-8-sig", newline="")
            reader = csv.DictReader(wrapper)
            return [dict(row) for row in reader]
    except KeyError:
        if required:
            raise
        return []


def iter_gtfs_rows(
    archive: zipfile.ZipFile,
    filename: str,
) -> Any:
    with archive.open(filename) as handle:
        wrapper = io.TextIOWrapper(handle, encoding="utf-8-sig", newline="")
        reader = csv.DictReader(wrapper)
        for row in reader:
            yield dict(row)


def select_gtfs_active_service_ids(
    calendar_rows: list[dict[str, Any]],
    calendar_dates_rows: list[dict[str, Any]],
    resource_start_date: str | None,
    resource_end_date: str | None,
) -> set[str]:
    calendar_by_service: dict[str, dict[str, Any]] = {}
    for row in calendar_rows:
        service_id = clean_identifier(row.get("service_id"))
        if service_id:
            calendar_by_service[service_id] = row

    calendar_date_lookup: dict[date, dict[str, set[str]]] = defaultdict(
        lambda: {"add": set(), "remove": set()}
    )
    for row in calendar_dates_rows:
        current_date = parse_gtfs_date(row.get("date"))
        service_id = clean_identifier(row.get("service_id"))
        exception_type = clean_int(row.get("exception_type")) or 0
        if current_date is None or not service_id:
            continue
        if exception_type == 1:
            calendar_date_lookup[current_date]["add"].add(service_id)
        elif exception_type == 2:
            calendar_date_lookup[current_date]["remove"].add(service_id)

    today = datetime.now(timezone.utc).date()
    candidate_start = max(
        [
            item
            for item in [
                today,
                parse_gtfs_date(resource_start_date),
                *[
                    parse_gtfs_date(row.get("start_date"))
                    for row in calendar_rows
                    if parse_gtfs_date(row.get("start_date")) is not None
                ],
            ]
            if item is not None
        ]
    )
    candidate_end = min(
        [
            item
            for item in [
                today + timedelta(days=21),
                parse_gtfs_date(resource_end_date),
                *[
                    parse_gtfs_date(row.get("end_date"))
                    for row in calendar_rows
                    if parse_gtfs_date(row.get("end_date")) is not None
                ],
            ]
            if item is not None
        ]
    )

    best_service_ids: set[str] = set()
    current = candidate_start
    while current <= candidate_end:
        if current.weekday() >= 5:
            current += timedelta(days=1)
            continue
        service_ids = get_active_service_ids_for_date(current, calendar_by_service, calendar_date_lookup)
        if len(service_ids) > len(best_service_ids):
            best_service_ids = service_ids
        current += timedelta(days=1)

    if best_service_ids:
        return best_service_ids

    if calendar_date_lookup:
        best_date, best_payload = max(
            (
                (key, payload)
                for key, payload in calendar_date_lookup.items()
                if key.weekday() < 5
            ),
            key=lambda item: len(item[1]["add"]),
            default=(None, None),
        )
        if best_date is not None and best_payload is not None:
            return set(best_payload["add"])

    return {
        service_id
        for service_id, row in calendar_by_service.items()
        if any(clean_int(row.get(day)) == 1 for day in ("monday", "tuesday", "wednesday", "thursday", "friday"))
    }


def get_active_service_ids_for_date(
    current_date: date,
    calendar_by_service: dict[str, dict[str, Any]],
    calendar_date_lookup: dict[date, dict[str, set[str]]],
) -> set[str]:
    weekday_labels = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ]
    weekday_label = weekday_labels[current_date.weekday()]
    active_service_ids = {
        service_id
        for service_id, row in calendar_by_service.items()
        if (
            parse_gtfs_date(row.get("start_date")) is None
            or parse_gtfs_date(row.get("start_date")) <= current_date
        )
        and (
            parse_gtfs_date(row.get("end_date")) is None
            or parse_gtfs_date(row.get("end_date")) >= current_date
        )
        and clean_int(row.get(weekday_label)) == 1
    }

    exceptions = calendar_date_lookup.get(current_date)
    if exceptions:
        active_service_ids.difference_update(exceptions["remove"])
        active_service_ids.update(exceptions["add"])
    return active_service_ids


def build_gtfs_hubs_from_rows(
    stops_rows: list[dict[str, Any]],
    stop_trip_counts: dict[str, int],
    resource: dict[str, Any],
) -> list[dict[str, Any]]:
    stops_lookup = {
        clean_identifier(row.get("stop_id")): row
        for row in stops_rows
        if clean_identifier(row.get("stop_id"))
    }
    resource_modes = sorted({mode for mode in resource.get("modes", []) if mode})
    resource_title = clean_text(resource.get("resource_title"))
    dataset_title = clean_text(resource.get("dataset_title"))

    hub_rows: dict[str, dict[str, Any]] = {}
    for stop_id, trip_count in stop_trip_counts.items():
        stop = stops_lookup.get(stop_id)
        if not stop:
            continue
        if clean_int(stop.get("location_type")) == 1:
            continue
        parent_station_id = clean_identifier(stop.get("parent_station"))
        parent_station = stops_lookup.get(parent_station_id) if parent_station_id else None
        latitude = clean_float(
            parent_station.get("stop_lat") if parent_station else stop.get("stop_lat")
        )
        longitude = clean_float(
            parent_station.get("stop_lon") if parent_station else stop.get("stop_lon")
        )
        if latitude is None or longitude is None:
            continue

        hub_id = parent_station_id or stop_id
        hub_name = clean_text(
            parent_station.get("stop_name") if parent_station else stop.get("stop_name")
        ) or resource_title
        existing = hub_rows.get(hub_id)
        if existing is None:
            existing = {
                "hub_id": hub_id,
                "hub_name": hub_name,
                "latitude": latitude,
                "longitude": longitude,
                "weekday_trip_count": 0,
                "modes": set(),
                "sources": set(),
            }
            hub_rows[hub_id] = existing
        existing["weekday_trip_count"] += trip_count
        existing["modes"].update(resource_modes)
        if dataset_title:
            existing["sources"].add(dataset_title)

    rows: list[dict[str, Any]] = []
    for hub in hub_rows.values():
        rows.append(
            {
                "hub_id": hub["hub_id"],
                "hub_name": hub["hub_name"],
                "latitude": round(float(hub["latitude"]), 6),
                "longitude": round(float(hub["longitude"]), 6),
                "weekday_trip_count": int(hub["weekday_trip_count"]),
                "modes": " | ".join(sorted(hub["modes"])),
                "sources": " | ".join(sorted(hub["sources"])),
            }
        )
    return rows


def merge_gtfs_hubs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for row in rows:
        latitude = clean_float(row.get("latitude"))
        longitude = clean_float(row.get("longitude"))
        if latitude is None or longitude is None:
            continue
        hub_name = clean_text(row.get("hub_name")) or "Arret TC"
        key = (
            f"{round(float(latitude), 4):.4f}|"
            f"{round(float(longitude), 4):.4f}|"
            f"{normalize_text_token(hub_name)}"
        )
        existing = merged.get(key)
        if existing is None:
            existing = {
                "hub_id": clean_identifier(row.get("hub_id")) or key,
                "hub_name": hub_name,
                "latitude": round(float(latitude), 6),
                "longitude": round(float(longitude), 6),
                "weekday_trip_count": 0,
                "modes": set(),
                "sources": set(),
            }
            merged[key] = existing
        existing["weekday_trip_count"] += clean_int(row.get("weekday_trip_count")) or 0
        existing["modes"].update(split_joined_values(row.get("modes")))
        existing["sources"].update(split_joined_values(row.get("sources")))

    merged_rows: list[dict[str, Any]] = []
    for row in merged.values():
        merged_rows.append(
            {
                "hub_id": row["hub_id"],
                "hub_name": row["hub_name"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "weekday_trip_count": int(row["weekday_trip_count"]),
                "modes": " | ".join(sorted(row["modes"])),
                "sources": " | ".join(sorted(row["sources"])),
            }
        )

    merged_rows.sort(
        key=lambda item: (-(item.get("weekday_trip_count") or 0), item.get("hub_name") or "")
    )
    return merged_rows


def build_spatial_grid(
    points: list[dict[str, Any]],
    *,
    cell_size: float = GTFS_GRID_CELL_DEGREES,
) -> dict[tuple[int, int], list[dict[str, Any]]]:
    grid: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for point in points:
        latitude = clean_float(point.get("latitude"))
        longitude = clean_float(point.get("longitude"))
        if latitude is None or longitude is None:
            continue
        grid[get_grid_key(latitude, longitude, cell_size=cell_size)].append(point)
    return dict(grid)


def get_grid_key(latitude: float | int, longitude: float | int, *, cell_size: float) -> tuple[int, int]:
    return (int(math.floor(float(latitude) / cell_size)), int(math.floor(float(longitude) / cell_size)))


def collect_grid_candidates(
    latitude: float | int,
    longitude: float | int,
    grid: dict[tuple[int, int], list[dict[str, Any]]],
    *,
    search_radius_cells: int,
    cell_size: float = GTFS_GRID_CELL_DEGREES,
) -> list[dict[str, Any]]:
    lat_key, lon_key = get_grid_key(latitude, longitude, cell_size=cell_size)
    candidates: list[dict[str, Any]] = []
    for lat_offset in range(-search_radius_cells, search_radius_cells + 1):
        for lon_offset in range(-search_radius_cells, search_radius_cells + 1):
            candidates.extend(grid.get((lat_key + lat_offset, lon_key + lon_offset), []))
    return candidates


def summarize_transit_proximity(
    latitude: float | int | None,
    longitude: float | int | None,
    transit_grid: dict[tuple[int, int], list[dict[str, Any]]],
    transit_hubs: list[dict[str, Any]],
) -> dict[str, Any]:
    if latitude is None or longitude is None:
        return {
            "nearest_transit_hub_id": None,
            "nearest_transit_hub": None,
            "nearest_transit_modes": None,
            "nearest_transit_distance_km": None,
            "active_transit_hubs_within_500m": 0,
            "active_transit_hubs_within_1000m": 0,
            "weekday_trips_within_500m": 0,
            "weekday_trips_within_1000m": 0,
        }

    candidate_points = collect_grid_candidates(
        latitude,
        longitude,
        transit_grid,
        search_radius_cells=1,
    )
    if not candidate_points:
        candidate_points = collect_grid_candidates(
            latitude,
            longitude,
            transit_grid,
            search_radius_cells=2,
        )
    if not candidate_points:
        candidate_points = transit_hubs

    nearest_hub = find_nearest_site(latitude, longitude, candidate_points)
    near_modes: set[str] = set()
    active_hubs_within_500m = 0
    active_hubs_within_1000m = 0
    weekday_trips_within_500m = 0
    weekday_trips_within_1000m = 0

    for point in candidate_points:
        point_latitude = clean_float(point.get("latitude"))
        point_longitude = clean_float(point.get("longitude"))
        if point_latitude is None or point_longitude is None:
            continue
        distance_km = haversine_km(latitude, longitude, point_latitude, point_longitude)
        if distance_km <= TRANSIT_WIDE_DISTANCE_KM:
            active_hubs_within_1000m += 1
            weekday_trips_within_1000m += clean_int(point.get("weekday_trip_count")) or 0
            near_modes.update(split_joined_values(point.get("modes")))
        if distance_km <= TRANSIT_NEAR_DISTANCE_KM:
            active_hubs_within_500m += 1
            weekday_trips_within_500m += clean_int(point.get("weekday_trip_count")) or 0

    return {
        "nearest_transit_hub_id": clean_identifier(nearest_hub.get("hub_id")) if nearest_hub else None,
        "nearest_transit_hub": clean_text(nearest_hub.get("hub_name")) if nearest_hub else None,
        "nearest_transit_modes": " | ".join(sorted(near_modes)) if near_modes else None,
        "nearest_transit_distance_km": (
            round(float(nearest_hub.get("distance_km") or 0), 3) if nearest_hub else None
        ),
        "active_transit_hubs_within_500m": active_hubs_within_500m,
        "active_transit_hubs_within_1000m": active_hubs_within_1000m,
        "weekday_trips_within_500m": weekday_trips_within_500m,
        "weekday_trips_within_1000m": weekday_trips_within_1000m,
    }


def parse_gtfs_date(value: Any) -> date | None:
    text = clean_text(value)
    if not text:
        return None
    for pattern in ("%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def normalize_text_token(value: str) -> str:
    lowered = value.lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", lowered)
    return normalized.strip("-") or "hub"


def find_nearest_site(
    latitude: float | int | None,
    longitude: float | int | None,
    sites: Any,
) -> dict[str, Any] | None:
    if latitude is None or longitude is None:
        return None

    best_site: dict[str, Any] | None = None
    best_distance: float | None = None
    for site in sites:
        site_latitude = clean_float(site.get("latitude"))
        site_longitude = clean_float(site.get("longitude"))
        if site_latitude is None or site_longitude is None:
            continue
        distance = haversine_km(latitude, longitude, site_latitude, site_longitude)
        if best_distance is None or distance < best_distance:
            best_site = dict(site)
            best_distance = distance

    if best_site is None or best_distance is None:
        return None

    best_site["distance_km"] = round(best_distance, 3)
    return best_site


def build_school_name(*parts: Any) -> str | None:
    values = [clean_text(part) for part in parts if clean_text(part)]
    return " ".join(values) if values else None


def format_source_summary(labels: list[str]) -> str:
    unique_labels = list(dict.fromkeys(label for label in labels if label))
    return " et ".join(unique_labels) if unique_labels else "Sources non renseignées"


def frame_to_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    records = frame.to_dict(orient="records")
    return [clean_record(record) for record in records]


def clean_record(record: dict[str, Any]) -> dict[str, Any]:
    return {str(key): clean_value(value, str(key)) for key, value in record.items()}


def clean_value(value: Any, key: str) -> Any:
    if pd.isna(value):
        return None

    if key in {"code_departement", "dep_code"}:
        return clean_department_code(value)
    if key == "code_commune":
        return clean_commune_code(value)
    if key in {"epci_code", "id_equipement", "id_installation", "uai"}:
        return str(value).replace(".0", "")
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else round(value, 6)
    return value


def clean_note_value(value: Any) -> str | None:
    if pd.isna(value):
        return None
    return str(value).strip()


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def normalize_search_text(value: Any) -> str:
    text = clean_text(value) or ""
    if not text:
        return ""
    ascii_text = unicodedata.normalize("NFKD", text)
    ascii_text = "".join(char for char in ascii_text if not unicodedata.combining(char))
    ascii_text = ascii_text.lower()
    ascii_text = re.sub(r"[^a-z0-9]+", "_", ascii_text)
    return ascii_text.strip("_")


def clean_identifier(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    return text.replace(".0", "")


def clean_department_code(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    digits = re.sub(r"\D", "", text)
    if not digits:
        return text
    if len(digits) == 3 and digits.startswith("0"):
        return digits[1:]
    if len(digits) == 1:
        return digits.zfill(2)
    return digits


def clean_commune_code(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    digits = re.sub(r"\D", "", text)
    return digits.zfill(5) if digits else text


def clean_float(value: Any) -> float | int | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        number = float(text.replace(",", "."))
    except ValueError:
        return None
    return int(number) if number.is_integer() else round(number, 6)


def clean_int(value: Any) -> int | None:
    number = clean_float(value)
    return int(number) if number is not None else None


def clean_bool(value: Any) -> int:
    text = clean_text(value)
    if not text:
        return 0
    return 1 if text.lower() in {"true", "1", "x", "oui"} else 0


def extract_year(value: Any) -> int | None:
    text = clean_text(value)
    if not text:
        return None
    match = re.search(r"(19|20)\d{2}", text)
    return int(match.group(0)) if match else None


def parse_literal_list(value: Any) -> list[str]:
    text = clean_text(value)
    if not text:
        return []
    try:
        parsed = ast.literal_eval(text)
    except (SyntaxError, ValueError):
        parsed = None
    if isinstance(parsed, list):
        return [str(item).strip() for item in parsed if str(item).strip()]
    return [text]


def join_literal_list(value: Any) -> str | None:
    items = parse_literal_list(value)
    return " | ".join(items) if items else None


def split_joined_values(value: Any) -> list[str]:
    text = clean_text(value)
    return [item.strip() for item in text.split("|") if item.strip()] if text else []


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    if size <= 0:
        return [items]
    return [items[index : index + size] for index in range(0, len(items), size)]


def count_unique_records(records: list[dict[str, Any]], key: str) -> int:
    return len({record[key] for record in records if record.get(key)})


def count_unique_values(records: list[dict[str, Any]], key: str) -> int:
    return len({record[key] for record in records if record.get(key)})


def average(values: Any) -> float:
    values_list = [float(value) for value in values if value is not None]
    return round(sum(values_list) / len(values_list), 6) if values_list else 0.0


def weighted_average(items: list[dict[str, Any]], value_getter: Any, weight_getter: Any) -> float:
    numerator = 0.0
    denominator = 0.0
    for item in items:
        value = value_getter(item)
        weight = weight_getter(item)
        if value is None or weight <= 0:
            continue
        numerator += float(value) * float(weight)
        denominator += float(weight)
    return round(numerator / denominator, 6) if denominator > 0 else 0.0


def haversine_km(
    latitude_a: float | int,
    longitude_a: float | int,
    latitude_b: float | int,
    longitude_b: float | int,
) -> float:
    radius_km = 6371.0088
    lat1 = math.radians(float(latitude_a))
    lon1 = math.radians(float(longitude_a))
    lat2 = math.radians(float(latitude_b))
    lon2 = math.radians(float(longitude_b))
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


def safe_divide(numerator: float | int, denominator: float | int) -> float:
    if not denominator:
        return 0.0
    return round(float(numerator) / float(denominator), 6)


if __name__ == "__main__":
    main()
