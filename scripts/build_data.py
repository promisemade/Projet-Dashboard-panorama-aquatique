from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILE = ROOT / "socle_donnees_publiques_filiere_aquatique_HDF_v5_dashboard.xlsx"
PUBLIC_DATA_DIR = ROOT / "public" / "data"
PUBLIC_EXPORT_DIR = PUBLIC_DATA_DIR / "exports"
EXPORT_DIR = ROOT / "data" / "exports"
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
    export_csvs(tables)
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
        "downloads": [
            {"label": "classeur excel source", "path": f"data/{SOURCE_FILE.name}"},
            *[
            {"label": export_name.replace("_", " "), "path": f"data/exports/{export_name}.csv"}
            for export_name in TABLE_SHEETS
            ],
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

    return cleaned


def export_csvs(tables: dict[str, pd.DataFrame]) -> None:
    for export_name, frame in tables.items():
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


if __name__ == "__main__":
    main()
