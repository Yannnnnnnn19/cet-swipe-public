#!/usr/bin/env python3
"""Attach study-priority tags derived from user-supplied CET study materials.

Only sparse derived tags are stored. The original source documents, definitions,
example sentences and phrase text are not redistributed.

Priority policy:
- A: appears in at least two supplied study sources
- B: appears in the general CET-6 high-frequency source only
- C: appears only in listening and/or translation source
- N: no supplied-source boost (default; not explicitly stored)

Score policy:
- general high-frequency: +3
- listening high-frequency: +2
- translation-topic hot word: +2
- appears in >=2 sources: +2
- appears in all 3 sources: additional +2
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

SOURCE_FILES = {
    "general_highfreq": "highfreq-general.txt",
    "listening_highfreq": "highfreq-listening.txt",
    "translation_hot": "highfreq-translation.txt",
}


def load_words(path: Path) -> set[str]:
    return {
        line.strip().casefold()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def priority_for(sources: list[str]) -> tuple[str, int]:
    score = 0
    if "general_highfreq" in sources:
        score += 3
    if "listening_highfreq" in sources:
        score += 2
    if "translation_hot" in sources:
        score += 2
    if len(sources) >= 2:
        score += 2
    if len(sources) == 3:
        score += 2

    if len(sources) >= 2:
        tier = "A"
    elif sources == ["general_highfreq"]:
        tier = "B"
    elif sources:
        tier = "C"
    else:
        tier = "N"
    return tier, score


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("vocabulary_json", type=Path)
    ap.add_argument("--source-dir", type=Path, default=Path("data/source"))
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    data = json.loads(args.vocabulary_json.read_text(encoding="utf-8"))
    source_sets = {
        name: load_words(args.source_dir / filename)
        for name, filename in SOURCE_FILES.items()
    }

    counts = {name: 0 for name in source_sets}
    tier_counts = {"A": 0, "B": 0, "C": 0, "N": 0}

    for entry in data["entries"]:
        candidate_words = {
            entry["headword"].casefold(),
            *(v.casefold() for v in entry.get("variants", [])),
        }
        lexical = entry.get("lexical") or {}
        matched = lexical.get("matched_word")
        if matched:
            candidate_words.add(matched.casefold())

        sources = [
            name
            for name, words in source_sets.items()
            if candidate_words & words
        ]
        for source in sources:
            counts[source] += 1

        tier, score = priority_for(sources)
        tier_counts[tier] += 1
        entry["study_priority"] = {
            "tier": tier,
            "score": score,
            "sources": sources,
        }

    data.setdefault("metadata", {})["study_priority"] = {
        "source_match_counts": counts,
        "tier_counts": tier_counts,
        "policy": {
            "A": "matched by at least two supplied study sources",
            "B": "matched by general CET-6 high-frequency source only",
            "C": "matched only by listening and/or translation source",
            "N": "no supplied-source boost",
        },
    }

    out = args.out or args.vocabulary_json
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(json.dumps(data["metadata"]["study_priority"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
