# Input schema

The Node builder accepts one UTF-8 JSON object with these top-level keys:

```json
{
  "project": {},
  "equipment": [],
  "bom": [],
  "connections": [],
  "options": {}
}
```

Unknown fields are preserved in the source JSON but are not written to the workbook.

## `project`

| Field | Required | Meaning |
|---|---:|---|
| `name` | yes | Workbook title and project name. |
| `site` | yes | Site or room prefix used in labels. |
| `lengthMode` | yes | `bom-first` or `calculated`. |
| `aEndToTrayM` | calculated only | A-end vertical allowance in metres. |
| `zEndToRackM` | calculated only | Z-end vertical allowance in metres. |
| `sameRackOverheadM` | no | Explicit total allowance for a same-rack route. If omitted, both endpoint allowances apply. |
| `slackM` | no | Additional engineering slack in metres; default `0`. |

## `equipment[]`

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Stable unique identifier used by connections. |
| `name` | yes | Full equipment name written to P2P. |
| `room` | yes | Room or site. |
| `rack` | yes | Rack identifier. |
| `ru` | yes | Starting U position only, for example `U22`; do not write `U22-U29`. |
| `role` | yes | Functional role such as `DATA-SPINE`, `SERVER`, or `OOB-LEAF`. |
| `model` | no | Vendor model when confirmed by a source. |
| `xM`, `yM` | calculated mode | Optional plan coordinates in metres. |

Equipment metadata is authoritative. Connection records reference `id`; they do not repeat rack or RU fields.

## `bom[]`

Each row represents one purchasable cable length bucket.

| Field | Required | Meaning |
|---|---:|---|
| `allocationGroup` | yes | Group shared with connection rows, such as `DATA_SERVER`. |
| `network` | yes | Reporting category. |
| `cableModel` | yes | BOM cable SKU/model. |
| `cableClass` | yes | `optical`, `copper`, or another explicit class. |
| `lengthM` | yes | Purchasable cable length in metres. |
| `quantity` | yes | Customer BOM quantity for this bucket. |
| `transceiverRule` | yes | Rule that controls module display and validation. |

Supported `transceiverRule` values:

- `none`: no transceiver is expected on either end.
- `both`: A and Z modules are expected on every row.
- `a-once-per-group`: A module is recorded once per A physical module group; Z is expected on each branch.
- `z-once-per-group`: the inverse of the previous rule.
- `both-once-per-group`: each end is recorded once per physical module group.
- `explicit`: module cells are used exactly as supplied, without inferred blanking.

Multiple BOM buckets can share an `allocationGroup` and cable model if their `lengthM` values differ.

## `connections[]`

One object equals one physical cable or one breakout branch.

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Unique link identifier. |
| `allocationGroup` | yes | Joins this row to the BOM bucket family. |
| `aDeviceId`, `zDeviceId` | yes | Equipment IDs. |
| `aPort`, `zPort` | yes | Exactly one endpoint port per field. |
| `aTransceiver`, `zTransceiver` | by rule | Explicit module names. |
| `aModuleGroup`, `zModuleGroup` | breakout rules | Stable physical module identifiers. |
| `routeScore` | no | Relative route distance used by BOM-first ranking. |
| `routeM` | no | Explicit horizontal route in metres. |
| `lockedLengthM` | no | User-approved cable length that must be reserved before allocation. |
| `sharedA`, `sharedZ` | no | Allow repeated endpoint port on that side. Default `false`. |
| `remark` | no | Design or installation note. |

Use `routeScore` when the exact route is unknown but relative near/far ordering is known. Use `routeM` when a measured horizontal route is available.

## `options`

| Field | Default | Meaning |
|---|---:|---|
| `maxRows` | `5000` | Maximum editable rows reserved by formulas and validations. |
| `labelSeparator` | `|` | Separator in A-end and Z-end labels. |
| `lengthToleranceM` | `0.01` | Numeric tolerance used by suffix and route checks. |

## Cross-workbook physical module registry

The auditor can receive a JSON module registry with keys formed as:

```text
device-name|port-name|physical-module-group
```

The value is the workbook that owns the physical module. A repeated key in another workbook is reported as a warning or error according to the audit policy.
