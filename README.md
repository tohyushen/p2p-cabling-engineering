# P2P Cabling Engineering Skill

A shareable Codex skill and Node.js toolkit for producing and checking engineering-grade P2P cabling workbooks.

The repository contains no customer project data. Its sample equipment, ports, cable models, coordinates, and quantities are fictional.

## What it does

- Builds a normalized P2P Excel workbook from equipment, BOM, and connection JSON.
- Allocates cable lengths using either customer-BOM-first or calculated-route logic.
- Keeps one physical link, one device, and one port per row/cell.
- Validates port uniqueness, rack/RU metadata, cable length suffixes, BOM quantities, copper/transceiver rules, and breakout module grouping.
- Audits existing P2P workbooks without modifying them.
- Produces human-readable QA sheets plus JSON and Markdown audit reports.

## Repository layout

```text
p2p-cabling-engineering/
├── SKILL.md
├── agents/openai.yaml
├── scripts/p2p.mjs
├── scripts/lib/p2p-core.mjs
├── references/
├── examples/sample-project.json
├── NODE_WORKFLOW.md
├── NOTE.md
└── assets/p2p-mini-template.xlsx
```

## Installation

Clone or copy this directory into your Codex skills directory, then invoke it as `$p2p-cabling-engineering`.

The Node CLI requires Node.js 20+ and `@oai/artifact-tool`. In the Codex desktop spreadsheet runtime the dependency is bundled. For a standalone environment, install a compatible artifact-tool package supplied by your organization.

## Quick start

```bash
node scripts/p2p.mjs template --output assets/p2p-mini-template.xlsx
node scripts/p2p.mjs build --config examples/sample-project.json --output sample-p2p.xlsx
node scripts/p2p.mjs audit --input sample-p2p.xlsx --report sample-audit.json --markdown sample-audit.md
```

Add `--strict` to `audit` when CI should exit with status 2 if an error is found.

## How a workbook is made

1. Define equipment once in `equipment`.
2. Define immutable BOM length buckets in `bom`.
3. Define one cable or breakout branch per `connections` entry.
4. Choose `project.lengthMode`:
   - `bom-first`: preserves BOM quantities and assigns shorter routes to shorter cables.
   - `calculated`: computes required length and selects the shortest sufficient BOM bucket.
5. Run `build`, review the generated `QA` sheet, then visually check every sheet.
6. Run `audit` before release or after manual edits.

See [references/input-schema.md](references/input-schema.md), [references/engineering-rules.md](references/engineering-rules.md), and [references/qa-checks.md](references/qa-checks.md) for the complete logic.

For implementation and extension details, see [NODE_WORKFLOW.md](NODE_WORKFLOW.md). A short Chinese handoff note is in [NOTE.md](NOTE.md).

## Safety and design boundaries

- The tool never invents vendor-specific ports or transceivers.
- The tool never changes customer BOM quantities to hide a mismatch.
- An audit is read-only.
- Cross-workbook module checking is supported through stable physical group identifiers.

## License

MIT. See [LICENSE](LICENSE).
