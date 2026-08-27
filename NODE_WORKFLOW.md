# Node.js implementation workflow

This project keeps spreadsheet I/O separate from engineering logic:

- `scripts/p2p.mjs` parses CLI arguments and controls files.
- `scripts/lib/p2p-core.mjs` validates inputs, assigns lengths, applies module rules, creates workbooks, renders previews, and audits existing workbooks.

## Build pipeline

```text
project JSON
  -> normalize equipment and ports
  -> validate equipment/BOM references
  -> allocate cable length
  -> apply copper/transceiver/breakout rules
  -> reconcile BOM quantities
  -> generate Excel + formula-backed QA
  -> export and render
```

The code deliberately uses stable JSON input rather than reading design intent directly from arbitrary workbook layouts. This makes generation deterministic and reviewable.

## Audit pipeline

```text
existing Excel
  -> detect sheets and endpoint headers
  -> read Equipment List and BOM when present
  -> normalize P2P rows
  -> check endpoints, locations, ports, modules, cable suffixes, lengths, and BOM buckets
  -> produce JSON + Markdown findings
```

Audit is read-only. It never saves over the input workbook.

## Add a new check

1. Add a stable finding code to `references/qa-checks.md`.
2. Implement the check in `buildModel`, `auditWorkbook`, or both.
3. Return a finding with `severity`, `code`, `message`, and row or connection context.
4. Add a clean test and an intentionally broken test.
5. Confirm strict audit exits with status 2 for errors.

## Add header aliases

Extend `HEADER_ALIASES`, `EQUIPMENT_ALIASES`, or `BOM_ALIASES` in `p2p-core.mjs`. Normalize aliases rather than hard-coding column numbers. Keep aliases unambiguous; a broad alias can cause the wrong row to be detected as a header.

## Add a cable or breakout rule

1. Document the physical behavior in `references/engineering-rules.md`.
2. Add the rule name to `references/input-schema.md`.
3. Implement display normalization in `applyTransceiverRule`.
4. Implement independent audit checks so manually edited workbooks are still checked.
5. Test physical-module counts separately from logical branch counts.

## Testing checklist

Run a clean build and audit:

```bash
node scripts/p2p.mjs build --config examples/sample-project.json --output /tmp/sample-p2p.xlsx
node scripts/p2p.mjs audit --input /tmp/sample-p2p.xlsx --report /tmp/audit.json --markdown /tmp/audit.md --strict
```

Render all standard sheets:

```bash
node scripts/p2p.mjs render --input /tmp/sample-p2p.xlsx --output-dir /tmp/p2p-previews
```

Then intentionally introduce at least one duplicate port, one copper transceiver, one BOM mismatch, and one undersized calculated route. The auditor must find each defect.

## Release checklist

- `SKILL.md` passes the Codex skill validator.
- Sample generation reports zero errors and zero warnings.
- Sample audit reports zero errors and zero warnings.
- Intentional-defect tests are detected.
- No customer names, paths, ports, quantities, or models are committed.
- Generated workbook formulas contain no visible Excel errors.
- Every worksheet has been rendered and visually reviewed.
