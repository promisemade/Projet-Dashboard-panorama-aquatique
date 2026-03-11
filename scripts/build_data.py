from __future__ import annotations

import ast
import csv
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILE = ROOT / "socle_donnees_publiques_filiere_aquatique_HDF_v5_dashboard.xlsx"
EXTENDED_INVENTORY_FILE = ROOT / "data" / "raw" / "equipements-sportifs.csv"
PUBLIC_DATA_DIR = ROOT / "public" / "data"
PUBLIC_EXPORT_DIR = PUBLIC_DATA_DIR / "exports"
EXPORT_DIR = ROOT / "data" / "exports"
EXTENDED_INVENTORY_EXPORT_NAME = "equipements_sportifs_non_filtres"
META_TITLE = "Panorama aquatique en Hauts-de-France"
META_SUBTITLE = (
    "Croisement de données publiques pour lire la pratique FFN, l'offre en bassins, "
    "les usages scolaires, les modes de gestion et les enjeux QPV."
)
META_SOURCE_SUMMARY = (
    "Données publiques croisées sur les licences FFN, les bassins, les usages scolaires, "
    "les modes de gestion et les quartiers prioritaires."
)

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


def main() -> None:
    if not SOURCE_FILE.exists():
        raise FileNotFoundError(f"Classeur source introuvable: {SOURCE_FILE}")

    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    tables = {name: load_table(sheet_name) for name, sheet_name in TABLE_SHEETS.items()}
    tables["sources"] = sanitize_sources_table(tables["sources"])
    notes = load_notes()
    extended_inventory = load_extended_inventory()
    export_csvs(tables)
    export_additional_records(EXTENDED_INVENTORY_EXPORT_NAME, extended_inventory)
    shutil.copy2(SOURCE_FILE, PUBLIC_DATA_DIR / SOURCE_FILE.name)

    payload = {
        "meta": {
            "title": META_TITLE,
            "subtitle": META_SUBTITLE,
            "region": "Hauts-de-France",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_file": SOURCE_FILE.name,
            "source_summary": META_SOURCE_SUMMARY,
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
        "basins": frame_to_records(tables["bassins_points"]),
        "epci_management": frame_to_records(tables["gestion_epci"]),
        "epci_schools": frame_to_records(tables["scolaires_epci"]),
        "school_basins": frame_to_records(tables["bassins_scolaires"]),
        "age_sex": frame_to_records(tables["ages_dep_sexe"]),
        "sex_2024": frame_to_records(tables["dep_sexe_2024"]),
        "sources": frame_to_records(tables["sources"]),
        "extended_inventory_overview": build_extended_inventory_overview(extended_inventory),
        "extended_inventory": extended_inventory,
        "downloads": [
            {"label": "classeur excel source", "path": f"data/{SOURCE_FILE.name}"},
            *[
                {"label": export_name.replace("_", " "), "path": f"data/exports/{export_name}.csv"}
                for export_name in TABLE_SHEETS
            ],
            {
                "label": "equipements sportifs non filtres",
                "path": f"data/exports/{EXTENDED_INVENTORY_EXPORT_NAME}.csv",
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


def load_extended_inventory() -> list[dict[str, Any]]:
    if not EXTENDED_INVENTORY_FILE.exists():
        return []

    records: list[dict[str, Any]] = []
    with EXTENDED_INVENTORY_FILE.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter=";")
        next(reader, None)
        for row in reader:
            if not any(value.strip() for value in row):
                continue

            padded = row + [""] * max(0, 113 - len(row))
            records.append(
                {
                    "id_equipement": clean_identifier(padded[0]),
                    "id_installation": clean_identifier(padded[1]),
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
                    "type_utilisation": join_literal_list(padded[81]),
                    "longueur_m": clean_float(padded[70]),
                    "largeur_m": clean_float(padded[71]),
                    "surface_bassin_m2": clean_float(padded[72]),
                    "profondeur_min_m": clean_float(padded[73]),
                    "profondeur_max_m": clean_float(padded[74]),
                    "nb_couloirs": clean_int(padded[59]),
                    "longitude": clean_float(padded[109]),
                    "latitude": clean_float(padded[110]),
                    "activites": join_literal_list(padded[112]),
                }
            )

    return records


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
        cleaned.loc[definition_mask, "source"] = "traitement DRAJES à partir de données publiques croisées"

    if "millesime" in cleaned.columns:
        cleaned["millesime"] = cleaned["millesime"].replace({"V5": "version web"})
        cleaned.loc[definition_mask, "millesime"] = "version web"

    if "usage_principal" in cleaned.columns:
        cleaned["usage_principal"] = cleaned["usage_principal"].replace(
            {"benchmark national FFN": "repère national FFN"}
        )

    return cleaned


def export_csvs(tables: dict[str, pd.DataFrame]) -> None:
    for export_name, frame in tables.items():
        frame.to_csv(EXPORT_DIR / f"{export_name}.csv", index=False, encoding="utf-8-sig")
        frame.to_csv(PUBLIC_EXPORT_DIR / f"{export_name}.csv", index=False, encoding="utf-8-sig")


def export_additional_records(export_name: str, records: list[dict[str, Any]]) -> None:
    if not records:
        return

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


def frame_to_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    records = frame.to_dict(orient="records")
    return [clean_record(record) for record in records]


def clean_record(record: dict[str, Any]) -> dict[str, Any]:
    return {str(key): clean_value(value, str(key)) for key, value in record.items()}


def clean_value(value: Any, key: str) -> Any:
    if pd.isna(value):
        return None

    if key in {"code_departement", "dep_code"}:
        return f"{int(value):02d}" if isinstance(value, (int, float)) else str(value)

    if key == "code_commune":
        return f"{int(value):05d}" if isinstance(value, (int, float)) else str(value)

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
    return text or None


def clean_identifier(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    return text.replace(".0", "")


def clean_department_code(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    if text.isdigit():
        return text.zfill(2)
    return text


def clean_commune_code(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    if text.isdigit():
        return text.zfill(5)
    return text


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
    if number is None:
        return None
    return int(number)


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
    if not text:
        return []
    return [item.strip() for item in text.split("|") if item.strip()]


def count_unique_records(records: list[dict[str, Any]], key: str) -> int:
    return len({record[key] for record in records if record.get(key)})


def count_unique_values(records: list[dict[str, Any]], key: str) -> int:
    return len({record[key] for record in records if record.get(key)})


if __name__ == "__main__":
    main()
