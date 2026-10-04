#!/usr/bin/env python3
"""Rebuild app-friendly official CET JSON from readable TSV shards.

The TSV shards are a text-only, auditable replacement for the previously
committed gzip artifact. They preserve:
- official visible study headword
- spelling variants
- homonym index
- CET-6 star marker
- official same-row family forms

The official source declares 5418 headwords, while the visible study-row
extraction contains 5377 rows. This script keeps one visible row as one card.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def read_core(source_dir: Path) -> list[dict]:
    rows: list[dict] = []
    paths = sorted(source_dir.glob("cet-official-core-*.tsv"))
    if not paths:
        raise SystemExit("No CET core TSV shards found")

    for path in paths:
        with path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f, delimiter="\t")
            for cols in reader:
                if not cols:
                    continue
                if cols[0] == "headword":
                    continue
                while len(cols) < 4:
                    cols.append("")
                headword, variants, homonym_index, cet6 = cols[:4]
                rows.append({
                    "headword": headword,
                    "variants": [v for v in variants.split(";") if v],
                    "homonym_index": int(homonym_index) if homonym_index else None,
                    "cet6": cet6 == "1",
                })
    return rows


def parse_family_item(raw: str) -> dict:
    item = raw
    homonym_index = None
    variants: list[str] = []

    if "#" in item and item.rsplit("#", 1)[1].isdigit():
        item, idx = item.rsplit("#", 1)
        homonym_index = int(idx)

    if item.endswith("}") and "{" in item:
        base, variant_part = item.rsplit("{", 1)
        item = base
        variants = [v for v in variant_part[:-1].split(",") if v]

    return {
        "headword": item,
        "variants": variants,
        "homonym_index": homonym_index,
        "raw": raw,
    }


def read_family(source_dir: Path) -> dict[str, list[dict]]:
    families: dict[str, list[dict]] = {}
    paths = sorted(source_dir.glob("cet-official-family-*.tsv"))
    for path in paths:
        with path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f, delimiter="\t")
            for cols in reader:
                if not cols or cols[0] == "headword":
                    continue
                while len(cols) < 2:
                    cols.append("")
                headword, family_raw = cols[:2]
                families.setdefault(headword.casefold(), []).extend(
                    parse_family_item(x) for x in family_raw.split(";") if x
                )
    return families


def build(source_dir: Path) -> dict:
    core = read_core(source_dir)
    families = read_family(source_dir)

    entries = []
    for i, row in enumerate(core, start=1):
        entries.append({
            "id": f"cet-{i:04d}",
            **row,
            "family": families.get(row["headword"].casefold(), []),
            "source": {
                "raw_headword": row["headword"],
                "raw_family": [
                    x["raw"] for x in families.get(row["headword"].casefold(), [])
                ],
                "source_kind": "official-cet-2016-derived-tsv",
            },
        })

    return {
        "metadata": {
            "source": "全国大学英语四、六级考试大纲（2016年修订版）",
            "official_declared_headword_count": 5418,
            "normalized_study_entry_count": len(entries),
            "normalized_cet6_starred_entry_count": sum(1 for e in entries if e["cet6"]),
            "schema_version": 2,
            "study_unit_policy": (
                "One visible official table row equals one study card; "
                "spelling alternatives remain attached as variants."
            ),
        },
        "entries": entries,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-dir", type=Path, default=Path("data/source"))
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    result = build(args.source_dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(json.dumps(result["metadata"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
