# QA checks

The auditor classifies findings as `ERROR`, `WARNING`, or `INFO`. Errors block a strict release.

## Errors

- Unknown equipment ID or P2P device absent from Equipment List.
- P2P room, rack, or RU conflicts with Equipment List.
- Missing device, port, allocation group, cable type, or assigned length on a field link.
- Duplicate A or Z port without an explicit sharing/breakout rule.
- Cable model suffix disagrees with the assigned length.
- P2P quantity differs from a BOM allocation group or length bucket.
- Passive copper row contains a transceiver without an explicit exception.
- Optical transceiver presence violates `transceiverRule`.
- A grouped breakout records more than one physical module for the same group and side.
- Calculated raw route exceeds assigned cable length.
- Locked length cannot be reserved from the BOM inventory.

## Warnings

- BOM-first route ordering appears inverted: a shorter route has a longer cable while a longer route has a shorter cable in the same group.
- Optical row has blank transceiver cells but no rule or module group explains the blank.
- Same physical module key appears in more than one workbook.
- Length is stored as text or contains an unparsed unit.
- Summary values are static and not traceable to row-level data.
- Same-rack overhead rule is absent in calculated mode.
- A repeated port is permitted only by a broad shared flag and lacks a documented breakout group.
- Equipment model or RU remains unconfirmed.

## Informational findings

- Connection is a documented spare or unterminated cable.
- Length came from BOM-first allocation rather than measured route geometry.
- Module is intentionally recorded only once for a physical breakout group.

## Audit behavior

- Audit never edits its input workbook.
- Audit maps headers by normalized English or Chinese aliases.
- If a required fact cannot be discovered reliably, report it instead of inventing a value.
- A workbook can pass semantic QA and still require visual QA.
- Render every output sheet and check title rows, merged cells, clipping, row heights, widths, wrapping, formula errors, and print readability.
