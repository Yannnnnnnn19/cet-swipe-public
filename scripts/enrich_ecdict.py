#!/usr/bin/env python3
"""Join normalized official CET entries with ECDICT.

ECDICT fields used in V0.1:
- phonetic
- translation (Chinese meaning)
- pos
- collins / oxford / tag
- bnc / frq frequency ranks
- exchange (inflections and lemma links)

The join is deliberately simple and auditable:
1. exact case-insensitive headword match;
2. if absent, exact case-insensitive match against official variants;
3. otherwise leave the entry unmatched for later Wiktionary/manual fallback.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

KEEP_FIELDS = {
    "phonetic",
    "translation",
    "pos",
    "collins",
    "oxford",
    "tag",
    "bnc",
    "frq",
    "exchange",
}

EXCHANGE_LABELS = {
    "p": "past",
    "d": "past_participle",
    "i": "present_participle",
    "3": "third_person_singular",
    "r": "comparative",
    "t": "superlative",
    "s": "plural",
    "0": "lemma",
    "1": "lemma_relation",
}


def clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value if value else None


def parse_pos(raw: str | None) -> list[dict]:
    if not raw:
        return []
    out = []
    for part in raw.split("/"):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            tag, weight = part.split(":", 1)
            try:
                weight_value = int(weight)
            except ValueError:
                weight_value = None
            out.append({"tag": tag, "weight": weight_value})
        else:
            out.append({"tag": part, "weight": None})
    return out


def parse_exchange(raw: str | None) -> dict[str, list[str]]:
    if not raw:
        return {}
    out: dict[str, list[str]] = {}
    for part in raw.split("/"):
        if ":" not in part:
            continue
        code, value = part.split(":", 1)
        value = value.strip()
        if not value:
            continue
        key = EXCHANGE_LABELS.get(code, f"raw_{code}")
        out.setdefault(key, [])
        if value not in out[key]:
            out[key].append(value)
    return out


def load_needed_ecdict(csv_path: Path, needed: set[str]) -> dict[str, dict]:
    wanted = {w.casefold() for w in needed if w}
    found: dict[str, dict] = {}
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = clean(row.get("word"))
            if not word:
                continue
            key = word.casefold()
            if key not in wanted or key in found:
                continue
            found[key] = {
                "word": word,
                **{field: clean(row.get(field)) for field in KEEP_FIELDS},
            }
            if len(found) == len(wanted):
                break
    return found


def compact_ecdict(row: dict | None) -> dict | None:
    if row is None:
        return None
    return {
        "matched_word": row["word"],
        "phonetic": row["phonetic"],
        "translation": row["translation"],
        "pos": parse_pos(row["pos"]),
        "inflections": parse_exchange(row["exchange"]),
        "frequency": {
            "bnc_rank": int(row["bnc"]) if row["bnc"] and row["bnc"].isdigit() and int(row["bnc"]) > 0 else None,
            "frq_rank": int(row["frq"]) if row["frq"] and row["frq"].isdigit() and int(row["frq"]) > 0 else None,
            "collins_stars": int(row["collins"]) if row["collins"] and row["collins"].isdigit() else None,
            "oxford_3000": row["oxford"] == "1",
            "tags": row["tag"].split() if row["tag"] else [],
        },
    }


def enrich(official: dict, ecdict_csv: Path) -> dict:
    needed: set[str] = set()
    for entry in official["entries"]:
        needed.add(entry["headword"])
        needed.update(entry.get("variants", []))

    lookup = load_needed_ecdict(ecdict_csv, needed)
    enriched = []
    match_stats = {"headword": 0, "variant": 0, "unmatched": 0}

    for entry in official["entries"]:
        candidates = [("headword", entry["headword"])] + [
            ("variant", v) for v in entry.get("variants", [])
        ]
        matched_kind = None
        row = None
        for kind, candidate in candidates:
            row = lookup.get(candidate.casefold())
            if row is not None:
                matched_kind = kind
                break

        if matched_kind is None:
            match_stats["unmatched"] += 1
        else:
            match_stats[matched_kind] += 1

        enriched.append({
            **entry,
            "lexical": compact_ecdict(row),
            "lexical_source": "ecdict" if row else None,
            "lexical_match": matched_kind,
        })

    metadata = {
        **official["metadata"],
        "enrichment_schema_version": 1,
        "ecdict_match": match_stats,
        "ecdict_match_rate": round(
            (match_stats["headword"] + match_stats["variant"]) / max(1, len(enriched)),
            6,
        ),
    }
    return {"metadata": metadata, "entries": enriched}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("official_json", type=Path)
    ap.add_argument("ecdict_csv", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--report", type=Path)
    args = ap.parse_args()

    official = json.loads(args.official_json.read_text(encoding="utf-8"))
    result = enrich(official, args.ecdict_csv)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    if args.report:
        report = {
            "entry_count": len(result["entries"]),
            **result["metadata"]["ecdict_match"],
            "match_rate": result["metadata"]["ecdict_match_rate"],
            "unmatched_words": [
                e["headword"] for e in result["entries"] if e["lexical"] is None
            ],
        }
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    print(json.dumps(result["metadata"]["ecdict_match"], ensure_ascii=False))
    print(f"match_rate={result['metadata']['ecdict_match_rate']:.2%}")


if __name__ == "__main__":
    main()
