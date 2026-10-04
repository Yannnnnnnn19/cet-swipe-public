# CET Swipe

A browser-based CET vocabulary review tool for a 30-day study plan.

## Current V0.1

- Official CET vocabulary-derived study entries
- Swipe recognition: ← familiar / → unknown
- Local-only learning progress via IndexedDB
- ECDICT enrichment: Chinese meanings, POS, phonetics, inflections, frequency metadata
- Study-priority tags derived from three CET review materials
- GitHub Pages deployment

## Privacy

Learning progress is stored only in the browser's IndexedDB. It is not committed to GitHub and is not uploaded to a server.

This public repository contains no API keys, access tokens, passwords, private account connections, or personal study history.

## Local development

```bash
npm install
npm run dev
```

## Data build

The committed source shards under `data/source/` are normalized, derived vocabulary/tag data. The original user-provided PDFs are not included.

The GitHub Action `Build enriched CET vocabulary` downloads ECDICT during the build and generates:

```text
public/data/vocabulary.json
data/generated/ecdict-report.json
```

See `THIRD_PARTY_NOTICES.md` for third-party data notices.
