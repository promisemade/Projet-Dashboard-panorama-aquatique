from __future__ import annotations

import base64
import csv
import hashlib
import html
import json
import re
import time
import unicodedata
from argparse import ArgumentParser
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests


ROOT = Path(__file__).resolve().parents[1]
QUEUE_FILE = ROOT / "public" / "data" / "exports" / "controle_statuts_prioritaires.csv"
DASHBOARD_FILE = ROOT / "public" / "data" / "dashboard.json"
OVERRIDE_FILE = ROOT / "data" / "raw" / "statut_installations_verifies.csv"
OUTPUT_FILE = ROOT / "data" / "raw" / "statut_installations_suggestions.csv"
REMAINING_OUTPUT_FILE = ROOT / "data" / "raw" / "statut_installations_suggestions_remaining.csv"
CACHE_DIR = ROOT / "data" / "raw" / "status_web_cache"
SEARCH_CACHE_DIR = CACHE_DIR / "search"
PAGE_CACHE_DIR = CACHE_DIR / "pages"

SEARCH_URL = "https://www.bing.com/search"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
)
REQUEST_TIMEOUT = 20
REQUEST_PAUSE_SECONDS = 0.7
MAX_RESULTS_PER_QUERY = 5
MAX_FETCHED_PAGES = 3

GENERIC_TOKENS = {
    "piscine",
    "centre",
    "aquatique",
    "municipale",
    "municipal",
    "nautique",
    "intercommunale",
    "complexe",
    "sportif",
    "espace",
    "structurant",
    "site",
    "bassin",
    "bassins",
    "le",
    "la",
    "les",
    "de",
    "du",
    "des",
    "d",
    "l",
    "et",
}

OFFICIAL_HINTS = [
    ".gouv.fr",
    "ville-",
    ".ville-",
    "mairie",
    "metropole",
    "agglo",
    "agglomeration",
    "communaute",
    "communes",
    "departement",
    "pasdecalais.fr",
    "lenord.fr",
    "oise.fr",
    "somme.fr",
    "aisne.com",
]
OPERATOR_HINTS = [
    "vert-marine",
    "equalia",
    "recrea",
    "ucpa",
    "prestalis",
    "vertmarine",
]
PRESS_HINTS = [
    "actu.fr",
    "francebleu.fr",
    "courrier-picard.fr",
    "voixdunord.fr",
    "lavoixdunord.fr",
    "france3-regions.francetvinfo.fr",
    "leparisien.fr",
]
MAP_HINTS = [
    "google.",
    "pagesjaunes.",
    "facebook.com",
    "instagram.com",
    "tripadvisor.",
]

CLOSED_PATTERNS = [
    r"hors service",
    r"fermeture definitive",
    r"definitivement ferm",
    r"fermee? depuis",
    r"n accueille plus",
    r"ne rouvrira pas",
]
TEMPORARY_PATTERNS = [
    r"fermee? pour travaux",
    r"fermee? temporairement",
    r"fermeture temporaire",
    r"travaux",
    r"en renovation",
    r"en rehabilitation",
    r"reouverture",
    r"reouvrira",
    r"fermeture exceptionnelle",
    r"indisponible",
]
OPEN_PATTERNS = [
    r"\bhoraires\b",
    r"\btarifs\b",
    r"\breservation\b",
    r"\bbilletterie\b",
    r"acheter vos entrees",
    r"nous vous accueill",
    r"\bouvert au public\b",
]


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    domain: str
    domain_type: str
    query: str


def normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"\s+", " ", text)


def clean_html_fragment(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def strip_html_document(content: str) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", content)
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?is)<noscript.*?>.*?</noscript>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def cache_path(cache_dir: Path, key: str, extension: str) -> Path:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return cache_dir / f"{digest}.{extension}"


def get_cached_text(cache_dir: Path, key: str) -> str | None:
    path = cache_path(cache_dir, key, "txt")
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def set_cached_text(cache_dir: Path, key: str, content: str) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_path(cache_dir, key, "txt")
    path.write_text(content, encoding="utf-8")


def fetch_text(url: str, *, params: dict[str, Any] | None = None, cache_dir: Path, cache_key: str) -> str:
    cached = get_cached_text(cache_dir, cache_key)
    if cached is not None:
        return cached

    response = requests.get(
        url,
        params=params,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7"},
    )
    response.raise_for_status()
    response.encoding = response.encoding or "utf-8"
    set_cached_text(cache_dir, cache_key, response.text)
    time.sleep(REQUEST_PAUSE_SECONDS)
    return response.text


def decode_bing_redirect(url: str) -> str:
    parsed = urlparse(html.unescape(url))
    query = parse_qs(parsed.query)
    encoded = query.get("u", [None])[0]
    if not encoded:
        return html.unescape(url)
    if encoded.startswith("a1"):
        raw = encoded[2:]
        try:
            return base64.b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8")
        except Exception:
            return html.unescape(url)
    return html.unescape(url)


def classify_domain(url: str) -> str:
    hostname = (urlparse(url).hostname or "").lower()
    if any(hint in hostname for hint in OFFICIAL_HINTS):
        return "official"
    if any(hint in hostname for hint in OPERATOR_HINTS):
        return "operator"
    if any(hint in hostname for hint in PRESS_HINTS):
        return "press"
    if any(hint in hostname for hint in MAP_HINTS):
        return "directory"
    return "other"


def extract_search_results(search_html: str, query: str) -> list[SearchResult]:
    matches = list(
        re.finditer(
            r"<h2[^>]*><a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a></h2>",
            search_html,
            re.S,
        )
    )
    results: list[SearchResult] = []
    for index, match in enumerate(matches[:MAX_RESULTS_PER_QUERY]):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else start + 2500
        window = search_html[start:end]
        snippet_match = re.search(r"<p[^>]*>(.*?)</p>", window, re.S)
        snippet = clean_html_fragment(snippet_match.group(1)) if snippet_match else ""
        title = clean_html_fragment(match.group(2))
        final_url = decode_bing_redirect(match.group(1))
        if not title or not final_url.startswith("http"):
            continue
        results.append(
            SearchResult(
                title=title,
                url=final_url,
                snippet=snippet,
                domain=urlparse(final_url).hostname or "",
                domain_type=classify_domain(final_url),
                query=query,
            )
        )
    return results


def significant_tokens(installation: str, commune: str) -> set[str]:
    tokens = set(re.findall(r"[a-z0-9]{3,}", normalize_text(f"{installation} {commune}")))
    return {token for token in tokens if token not in GENERIC_TOKENS}


def relevance_score(result: SearchResult, installation: str, commune: str) -> int:
    haystack = normalize_text(f"{result.title} {result.snippet} {result.url}")
    commune_token = normalize_text(commune)
    score = 0
    if commune_token and commune_token in haystack:
        score += 2
    tokens = significant_tokens(installation, commune)
    score += sum(1 for token in tokens if token in haystack)
    return score


def detect_status_signal(text: str) -> tuple[str | None, list[str]]:
    normalized = normalize_text(text)
    reasons: list[str] = []
    if any(re.search(pattern, normalized) for pattern in CLOSED_PATTERNS):
        reasons.append("signal fermeture durable")
        return "closed", reasons
    if any(re.search(pattern, normalized) for pattern in TEMPORARY_PATTERNS):
        reasons.append("signal travaux / fermeture temporaire")
        return "temporary_closed", reasons
    if any(re.search(pattern, normalized) for pattern in OPEN_PATTERNS):
        reasons.append("signal d'ouverture / horaires")
        return "open_probable", reasons
    return None, reasons


def fetch_page_signal(result: SearchResult) -> tuple[str | None, str | None]:
    if result.domain_type not in {"official", "operator", "press"}:
        return None, None
    if result.url.lower().endswith(".pdf"):
        return None, None

    try:
        page_html = fetch_text(
            result.url,
            cache_dir=PAGE_CACHE_DIR,
            cache_key=result.url,
        )
    except Exception:
        return None, None

    page_text = strip_html_document(page_html[:250000])
    signal, _ = detect_status_signal(page_text)
    if not signal:
        return None, None
    return signal, page_text[:1200]


def score_result(
    result: SearchResult,
    *,
    installation: str,
    commune: str,
) -> dict[str, Any] | None:
    relevance = relevance_score(result, installation, commune)
    if relevance <= 0:
        return None

    snippet_signal, snippet_reasons = detect_status_signal(f"{result.title} {result.snippet}")
    page_signal = None
    page_excerpt = None
    if snippet_signal is None or result.domain_type in {"official", "operator"}:
        page_signal, page_excerpt = fetch_page_signal(result)

    signal = page_signal or snippet_signal
    if signal is None:
        return None

    source_bonus = {
        "official": 45,
        "operator": 40,
        "press": 25,
        "directory": 10,
        "other": 5,
    }.get(result.domain_type, 0)
    signal_bonus = {
        "closed": 50,
        "temporary_closed": 48,
        "open_probable": 30,
        "verify": 10,
    }.get(signal, 0)
    score = source_bonus + signal_bonus + (relevance * 8)

    confidence = "Faible"
    if result.domain_type in {"official", "operator"} and signal in {"closed", "temporary_closed"}:
        confidence = "Forte"
    elif result.domain_type in {"official", "operator"}:
        confidence = "Moyenne"
    elif result.domain_type == "press" and signal in {"closed", "temporary_closed"}:
        confidence = "Moyenne"

    return {
        "suggested_status": signal,
        "confidence": confidence,
        "score": score,
        "domain_type": result.domain_type,
        "url": result.url,
        "title": result.title,
        "snippet": result.snippet,
        "page_excerpt": page_excerpt,
        "query": result.query,
        "signal_origin": "page" if page_signal else "snippet",
        "reasons": "; ".join(snippet_reasons),
    }


def build_queries(row: dict[str, str]) -> list[str]:
    installation = row.get("installation", "")
    commune = row.get("commune", "")
    return [
        f'"{installation}" "{commune}" piscine',
        f'"{installation}" "{commune}" piscine fermeture travaux',
    ]


def load_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_remaining_rows() -> list[dict[str, str]]:
    if not DASHBOARD_FILE.exists():
        raise FileNotFoundError(f"Dashboard introuvable: {DASHBOARD_FILE}")

    payload = json.loads(DASHBOARD_FILE.read_text(encoding="utf-8"))
    rows: list[dict[str, str]] = []
    for row in payload.get("installation_status", []):
        if int(row.get("status_is_manual") or 0) == 1:
            continue
        rows.append(
            {
                "id_installation": str(row.get("id_installation") or ""),
                "installation": str(row.get("installation") or ""),
                "commune": str(row.get("commune") or ""),
                "departement": str(row.get("departement") or ""),
                "epci_nom": str(row.get("epci_nom") or ""),
                "operational_status_label": str(row.get("operational_status_label") or ""),
                "priority_label": "",
                "priority_score": str(row.get("bassins_total") or "0"),
                "bassins_total": str(row.get("bassins_total") or "0"),
            }
        )

    rows.sort(
        key=lambda item: (
            -int(item.get("bassins_total") or 0),
            item.get("installation") or "",
        )
    )
    return rows


def existing_override_installations() -> set[str]:
    if not OVERRIDE_FILE.exists():
        return set()
    with OVERRIDE_FILE.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))
    return {row["id_installation"] for row in rows if row.get("id_installation")}


def audit_row(row: dict[str, str]) -> dict[str, Any]:
    installation = row.get("installation", "") or ""
    commune = row.get("commune", "") or ""
    candidate_evidences: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    for query in build_queries(row):
        try:
            search_html = fetch_text(
                SEARCH_URL,
                params={"q": query, "setlang": "fr-FR", "count": MAX_RESULTS_PER_QUERY},
                cache_dir=SEARCH_CACHE_DIR,
                cache_key=f"bing::{query}",
            )
        except Exception:
            continue

        results = extract_search_results(search_html, query)
        for result in results:
            if result.url in seen_urls:
                continue
            seen_urls.add(result.url)
            scored = score_result(result, installation=installation, commune=commune)
            if scored:
                candidate_evidences.append(scored)
            if len(candidate_evidences) >= MAX_FETCHED_PAGES * len(build_queries(row)):
                break

    candidate_evidences.sort(key=lambda item: int(item["score"]), reverse=True)
    best = candidate_evidences[0] if candidate_evidences else None

    return {
        "id_installation": row.get("id_installation"),
        "installation": installation,
        "commune": commune,
        "departement": row.get("departement"),
        "epci_nom": row.get("epci_nom"),
        "current_status": row.get("operational_status_label"),
        "priority_label": row.get("priority_label"),
        "priority_score": row.get("priority_score"),
        "suggested_status": best["suggested_status"] if best else "",
        "suggested_status_label": {
            "open_probable": "Ouvert probable",
            "temporary_closed": "Fermé temporairement / travaux",
            "closed": "Fermé / hors service",
            "verify": "Statut à vérifier",
        }.get(best["suggested_status"], "") if best else "",
        "confidence": best["confidence"] if best else "",
        "ready_for_override": "1"
        if best and best["confidence"] == "Forte" and best["suggested_status"] in {"closed", "temporary_closed"}
        else "0",
        "evidence_domain_type": best["domain_type"] if best else "",
        "evidence_url": best["url"] if best else "",
        "evidence_title": best["title"] if best else "",
        "evidence_snippet": best["snippet"] if best else "",
        "evidence_origin": best["signal_origin"] if best else "",
        "query_used": best["query"] if best else "",
        "review_comment": best["reasons"] if best else "Aucune evidence suffisamment fiable detectee.",
    }


def write_rows(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "id_installation",
        "installation",
        "commune",
        "departement",
        "epci_nom",
        "current_status",
        "priority_label",
        "priority_score",
        "suggested_status",
        "suggested_status_label",
        "confidence",
        "ready_for_override",
        "evidence_domain_type",
        "evidence_url",
        "evidence_title",
        "evidence_snippet",
        "evidence_origin",
        "query_used",
        "review_comment",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> Any:
    parser = ArgumentParser()
    parser.add_argument("--limit", type=int, default=43)
    parser.add_argument("--source", choices=["queue", "remaining"], default="queue")
    parser.add_argument("--output", type=Path, default=OUTPUT_FILE)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.source == "queue":
        if not QUEUE_FILE.exists():
            raise FileNotFoundError(f"File de controle introuvable: {QUEUE_FILE}")
        rows = load_rows(QUEUE_FILE)
        output = args.output
    else:
        rows = load_remaining_rows()
        output = args.output if args.output != OUTPUT_FILE else REMAINING_OUTPUT_FILE

    overridden_installations = existing_override_installations()
    target_rows = [row for row in rows if row.get("id_installation") not in overridden_installations][: args.limit]

    audited_rows = [audit_row(row) for row in target_rows]
    audited_rows.sort(
        key=lambda item: (
            -int(item.get("ready_for_override") or 0),
            {"Forte": 0, "Moyenne": 1, "Faible": 2, "": 3}.get(item.get("confidence", ""), 4),
            -(int(item.get("priority_score") or 0)),
            item.get("installation") or "",
        )
    )
    write_rows(output, audited_rows)

    summary = {
        "source": args.source,
        "rows": len(audited_rows),
        "ready_for_override": sum(1 for row in audited_rows if row.get("ready_for_override") == "1"),
        "with_confidence": sum(1 for row in audited_rows if row.get("confidence")),
    }
    print(json.dumps(summary, ensure_ascii=False))
    print(f"Suggestions écrites dans {output}")


if __name__ == "__main__":
    main()
