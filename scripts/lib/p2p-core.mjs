import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const COLORS = {
  navy: "#17365D",
  teal: "#17859B",
  purple: "#5F497A",
  blue: "#D9EAF7",
  green: "#E2F0D9",
  orange: "#F4B183",
  red: "#FCE4D6",
  gray: "#F2F2F2",
  white: "#FFFFFF",
  border: "#A6A6A6",
};

const HEADER_ALIASES = {
  seq: ["seq", "sequence", "序号", "序號"],
  aDevice: ["a device", "a end device", "a端设备", "a端設備", "a设备名"],
  aRoom: ["a room", "a机房", "a機房"],
  aRack: ["a rack", "a机柜", "a機櫃"],
  aRu: ["a ru", "a u", "a u位", "a端u位"],
  aPort: ["a port", "a端口", "a端端口"],
  aTransceiver: ["a transceiver", "a module", "a模块", "a模組"],
  zDevice: ["z device", "z end device", "z端设备", "z端設備", "z设备名"],
  zRoom: ["z room", "z机房", "z機房"],
  zRack: ["z rack", "z机柜", "z機櫃"],
  zRu: ["z ru", "z u", "z u位", "z端u位"],
  zPort: ["z port", "z端口", "z端端口"],
  zTransceiver: ["z transceiver", "z module", "z模块", "z模組"],
  cableType: ["cable type", "cable model", "线缆类型", "線纜類型", "线缆型号"],
  lengthM: ["length (m)", "length", "cable length", "长度", "長度", "线缆长度"],
  remark: ["remark", "备注", "備註"],
  allocationGroup: ["allocation group", "bom group", "分配组", "分配組"],
  transceiverRule: ["transceiver rule", "模块规则", "模組規則"],
  aModuleGroup: ["a module group", "a模块组", "a模組組"],
  zModuleGroup: ["z module group", "z模块组", "z模組組"],
  routeScore: ["route score", "route rank", "路由分数", "路由分數"],
  rawRouteM: ["raw route (m)", "required length", "原始路由", "需求长度"],
};

const EQUIPMENT_ALIASES = {
  id: ["id", "equipment id", "设备id", "設備id"],
  name: ["device name", "equipment name", "设备名", "設備名"],
  room: ["room", "机房", "機房"],
  rack: ["rack", "机柜", "機櫃"],
  ru: ["ru", "u", "u位"],
  role: ["role", "equipment role", "设备角色", "設備角色"],
  model: ["model", "equipment model", "型号", "型號"],
};

const BOM_ALIASES = {
  allocationGroup: ["allocation group", "bom group", "分配组", "分配組"],
  network: ["network", "subnet", "网络", "網絡"],
  cableClass: ["cable class", "category", "线缆类别", "線纜類別"],
  cableModel: ["cable model", "model", "线缆型号", "線纜型號"],
  lengthM: ["length (m)", "length", "cable length", "长度", "長度"],
  plannedQty: ["planned qty", "bom qty", "quantity", "qty", "数量", "數量"],
  transceiverRule: ["transceiver rule", "模块规则", "模組規則"],
};

function finding(severity, code, message, context = {}) {
  return { severity, code, message, ...context };
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase().replace(/[\n\r_\-/]+/g, " ").replace(/[()（）]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeRu(value) {
  const text = normalizeText(value).toUpperCase();
  const match = text.match(/U?\s*(\d+)/);
  return match ? `U${Number(match[1])}` : text;
}

function isCopper(cableClass, cableModel) {
  return /copper|utp|cat\s*[5678]|cat6a|rj\s*45/i.test(`${cableClass ?? ""} ${cableModel ?? ""}`);
}

function parseModelLength(model) {
  const match = normalizeText(model).match(/N(\d{3,4})(?:\D|$)/i);
  return match ? Number(match[1]) : null;
}

function rackHeuristic(rack) {
  const text = normalizeText(rack).toUpperCase();
  const match = text.match(/([A-Z]+)?\s*0*(\d+)/);
  if (!match) return 0;
  let row = 0;
  for (const char of match[1] || "") row = row * 26 + char.charCodeAt(0) - 64;
  return row * 100 + Number(match[2]);
}

function routeScore(connection, a, z) {
  if (Number.isFinite(Number(connection.routeScore))) return Number(connection.routeScore);
  if (Number.isFinite(Number(connection.routeM))) return Number(connection.routeM);
  if ([a.xM, a.yM, z.xM, z.yM].every((value) => Number.isFinite(Number(value)))) {
    return Math.abs(Number(a.xM) - Number(z.xM)) + Math.abs(Number(a.yM) - Number(z.yM));
  }
  return Math.abs(rackHeuristic(a.rack) - rackHeuristic(z.rack));
}

function mapEquipment(config, findings) {
  const map = new Map();
  for (const source of config.equipment || []) {
    const item = { ...source, id: normalizeText(source.id), name: normalizeText(source.name), ru: normalizeRu(source.ru) };
    if (!item.id || !item.name) {
      findings.push(finding("ERROR", "EQUIPMENT_REQUIRED", "Equipment requires id and name.", { equipmentId: item.id }));
      continue;
    }
    if (map.has(item.id)) findings.push(finding("ERROR", "EQUIPMENT_DUPLICATE_ID", `Duplicate equipment id: ${item.id}`, { equipmentId: item.id }));
    if (/\d+\s*[-–]\s*U?\d+/i.test(normalizeText(source.ru))) {
      findings.push(finding("WARNING", "RU_RANGE_NORMALIZED", `${item.name} RU was normalized to starting value ${item.ru}.`, { equipmentId: item.id }));
    }
    map.set(item.id, item);
  }
  return map;
}

function allocationInventory(bomRows) {
  const byGroup = new Map();
  for (const row of bomRows) {
    const group = normalizeText(row.allocationGroup);
    if (!byGroup.has(group)) byGroup.set(group, []);
    for (let index = 0; index < Number(row.quantity || 0); index += 1) {
      byGroup.get(group).push({ lengthM: Number(row.lengthM), cableModel: normalizeText(row.cableModel), bom: row, used: false });
    }
  }
  for (const slots of byGroup.values()) slots.sort((a, b) => a.lengthM - b.lengthM || a.cableModel.localeCompare(b.cableModel));
  return byGroup;
}

function deriveRawRoute(project, connection, a, z, findings) {
  let horizontal = Number(connection.routeM);
  if (!Number.isFinite(horizontal) && [a.xM, a.yM, z.xM, z.yM].every((value) => Number.isFinite(Number(value)))) {
    horizontal = Math.abs(Number(a.xM) - Number(z.xM)) + Math.abs(Number(a.yM) - Number(z.yM));
  }
  if (!Number.isFinite(horizontal)) {
    findings.push(finding("ERROR", "ROUTE_MISSING", `Calculated mode requires routeM or coordinates for ${connection.id}.`, { connectionId: connection.id }));
    return null;
  }
  const sameRack = normalizeText(a.rack) === normalizeText(z.rack);
  let overhead;
  if (sameRack && Number.isFinite(Number(project.sameRackOverheadM))) {
    overhead = Number(project.sameRackOverheadM);
  } else {
    overhead = Number(project.aEndToTrayM || 0) + Number(project.zEndToRackM || 0);
    if (sameRack) findings.push(finding("WARNING", "SAME_RACK_RULE_ASSUMED", `Both endpoint allowances were applied to same-rack connection ${connection.id}.`, { connectionId: connection.id }));
  }
  return horizontal + overhead + Number(project.slackM || 0);
}

function applyTransceiverRule(row, rule, seenA, seenZ, findings) {
  const copper = isCopper(row.cableClass, row.cableModel);
  if (copper || rule === "none") {
    if (normalizeText(row.aTransceiver) || normalizeText(row.zTransceiver)) {
      findings.push(finding("ERROR", "COPPER_TRANSCEIVER", `Passive copper connection ${row.id} must not contain a transceiver.`, { connectionId: row.id }));
    }
    row.aTransceiver = "";
    row.zTransceiver = "";
    return;
  }

  if (rule === "both") {
    if (!normalizeText(row.aTransceiver) || !normalizeText(row.zTransceiver)) {
      findings.push(finding("ERROR", "TRANSCEIVER_BOTH_REQUIRED", `Connection ${row.id} requires modules on both ends.`, { connectionId: row.id }));
    }
    return;
  }

  const processSide = (side, seen, mode) => {
    const groupKey = normalizeText(row[`${side}ModuleGroup`]);
    const moduleKey = `${side}Transceiver`;
    if (!groupKey) {
      findings.push(finding("ERROR", "MODULE_GROUP_REQUIRED", `${row.id} requires ${side.toUpperCase()} module group for ${rule}.`, { connectionId: row.id }));
      return;
    }
    if (seen.has(groupKey)) {
      if (normalizeText(row[moduleKey])) findings.push(finding("WARNING", "GROUP_MODULE_DEDUPED", `Repeated ${side.toUpperCase()} module on group ${groupKey} was blanked on ${row.id}.`, { connectionId: row.id }));
      row[moduleKey] = "";
    } else {
      seen.add(groupKey);
      if (!normalizeText(row[moduleKey])) findings.push(finding("ERROR", "GROUP_MODULE_REQUIRED", `First row of ${side.toUpperCase()} module group ${groupKey} requires a module.`, { connectionId: row.id }));
    }
    if (mode === "each" && !normalizeText(row[moduleKey])) findings.push(finding("ERROR", "BRANCH_MODULE_REQUIRED", `${row.id} requires a ${side.toUpperCase()} branch module.`, { connectionId: row.id }));
  };

  if (rule === "a-once-per-group") {
    processSide("a", seenA, "once");
    if (!normalizeText(row.zTransceiver)) findings.push(finding("ERROR", "Z_BRANCH_MODULE_REQUIRED", `${row.id} requires a Z-end branch module.`, { connectionId: row.id }));
  } else if (rule === "z-once-per-group") {
    processSide("z", seenZ, "once");
    if (!normalizeText(row.aTransceiver)) findings.push(finding("ERROR", "A_BRANCH_MODULE_REQUIRED", `${row.id} requires an A-end branch module.`, { connectionId: row.id }));
  } else if (rule === "both-once-per-group") {
    processSide("a", seenA, "once");
    processSide("z", seenZ, "once");
  } else if (rule !== "explicit") {
    findings.push(finding("ERROR", "TRANSCEIVER_RULE_UNKNOWN", `Unknown transceiver rule ${rule}.`, { connectionId: row.id }));
  }
}

export function buildModel(config) {
  const findings = [];
  const project = config.project || {};
  const mode = project.lengthMode;
  if (!project.name || !project.site) findings.push(finding("ERROR", "PROJECT_REQUIRED", "Project name and site are required."));
  if (!["bom-first", "calculated"].includes(mode)) findings.push(finding("ERROR", "LENGTH_MODE", "project.lengthMode must be bom-first or calculated."));

  const equipmentMap = mapEquipment(config, findings);
  const equipment = [...equipmentMap.values()];
  const bom = (config.bom || []).map((row) => ({
    ...row,
    allocationGroup: normalizeText(row.allocationGroup),
    network: normalizeText(row.network),
    cableModel: normalizeText(row.cableModel),
    cableClass: normalizeText(row.cableClass).toLowerCase(),
    lengthM: Number(row.lengthM),
    quantity: Number(row.quantity),
    transceiverRule: normalizeText(row.transceiverRule).toLowerCase(),
  }));

  const connectionIds = new Set();
  const rows = [];
  const byGroup = new Map();
  for (const source of config.connections || []) {
    const id = normalizeText(source.id);
    if (!id) findings.push(finding("ERROR", "CONNECTION_ID_REQUIRED", "Connection id is required."));
    if (connectionIds.has(id)) findings.push(finding("ERROR", "CONNECTION_DUPLICATE_ID", `Duplicate connection id: ${id}`, { connectionId: id }));
    connectionIds.add(id);
    const a = equipmentMap.get(normalizeText(source.aDeviceId));
    const z = equipmentMap.get(normalizeText(source.zDeviceId));
    if (!a || !z) {
      findings.push(finding("ERROR", "UNKNOWN_EQUIPMENT", `Connection ${id} references unknown equipment.`, { connectionId: id }));
      continue;
    }
    const group = normalizeText(source.allocationGroup);
    const bomMatches = bom.filter((item) => item.allocationGroup === group);
    if (!bomMatches.length) findings.push(finding("ERROR", "UNKNOWN_ALLOCATION_GROUP", `Connection ${id} has no BOM allocation group ${group}.`, { connectionId: id }));
    const ruleSet = [...new Set(bomMatches.map((item) => item.transceiverRule))];
    if (ruleSet.length > 1) findings.push(finding("ERROR", "GROUP_RULE_CONFLICT", `Allocation group ${group} has conflicting transceiver rules.`, { allocationGroup: group }));
    const row = {
      ...source,
      id,
      allocationGroup: group,
      a,
      z,
      aPort: normalizeText(source.aPort),
      zPort: normalizeText(source.zPort),
      aTransceiver: normalizeText(source.aTransceiver),
      zTransceiver: normalizeText(source.zTransceiver),
      aModuleGroup: normalizeText(source.aModuleGroup),
      zModuleGroup: normalizeText(source.zModuleGroup),
      routeScore: routeScore(source, a, z),
      transceiverRule: ruleSet[0] || "explicit",
      cableClass: bomMatches[0]?.cableClass || "",
      cableModel: "",
      assignedLengthM: null,
      rawRouteM: null,
      remark: normalizeText(source.remark),
    };
    if (!row.aPort || !row.zPort) findings.push(finding("ERROR", "PORT_REQUIRED", `Connection ${id} requires one A port and one Z port.`, { connectionId: id }));
    rows.push(row);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(row);
  }

  const inventory = allocationInventory(bom);
  for (const [group, groupRows] of byGroup) {
    const slots = inventory.get(group) || [];
    const locked = groupRows.filter((row) => Number.isFinite(Number(row.lockedLengthM)));
    for (const row of locked) {
      const length = Number(row.lockedLengthM);
      const slot = slots.find((item) => !item.used && item.lengthM === length);
      if (!slot) {
        findings.push(finding("ERROR", "LOCKED_LENGTH_UNAVAILABLE", `No ${length} m BOM slot is available for ${row.id}.`, { connectionId: row.id }));
      } else {
        slot.used = true;
        row.assignedLengthM = slot.lengthM;
        row.cableModel = slot.cableModel;
      }
    }

    const remainingRows = groupRows.filter((row) => !Number.isFinite(row.assignedLengthM)).sort((a, b) => a.routeScore - b.routeScore || a.id.localeCompare(b.id));
    if (mode === "bom-first") {
      const freeSlots = slots.filter((slot) => !slot.used).sort((a, b) => a.lengthM - b.lengthM);
      remainingRows.forEach((row, index) => {
        const slot = freeSlots[index];
        if (!slot) {
          findings.push(finding("ERROR", "BOM_SHORTAGE", `No BOM cable remains for ${row.id}.`, { connectionId: row.id, allocationGroup: group }));
          return;
        }
        slot.used = true;
        row.assignedLengthM = slot.lengthM;
        row.cableModel = slot.cableModel;
      });
    } else if (mode === "calculated") {
      for (const row of remainingRows) {
        row.rawRouteM = deriveRawRoute(project, row, row.a, row.z, findings);
        const slot = slots.find((item) => !item.used && row.rawRouteM !== null && item.lengthM >= row.rawRouteM);
        if (!slot) {
          findings.push(finding("ERROR", "NO_SUFFICIENT_LENGTH", `No available BOM length covers ${row.id} (${row.rawRouteM ?? "unknown"} m).`, { connectionId: row.id, allocationGroup: group }));
          continue;
        }
        slot.used = true;
        row.assignedLengthM = slot.lengthM;
        row.cableModel = slot.cableModel;
      }
    }
  }

  for (const row of rows) {
    if (mode === "calculated" && row.rawRouteM === null && Number.isFinite(row.assignedLengthM)) row.rawRouteM = deriveRawRoute(project, row, row.a, row.z, findings);
    const suffixLength = parseModelLength(row.cableModel);
    const tolerance = Number(config.options?.lengthToleranceM || 0.01);
    if (suffixLength !== null && Number.isFinite(row.assignedLengthM) && Math.abs(suffixLength - row.assignedLengthM) > tolerance) {
      findings.push(finding("ERROR", "MODEL_LENGTH_MISMATCH", `${row.cableModel} suffix does not match ${row.assignedLengthM} m on ${row.id}.`, { connectionId: row.id }));
    }
  }

  const seenA = new Set();
  const seenZ = new Set();
  for (const row of rows) applyTransceiverRule(row, row.transceiverRule, seenA, seenZ, findings);

  const endpointMap = new Map();
  for (const row of rows) {
    for (const side of ["A", "Z"]) {
      const lower = side.toLowerCase();
      const key = `${row[lower].name}|${row[`${lower}Port`]}`.toLowerCase();
      const shared = Boolean(row[`shared${side}`]);
      const previous = endpointMap.get(key);
      if (previous && !shared && !previous.shared) {
        findings.push(finding("ERROR", "DUPLICATE_PORT", `${side}-end port is reused: ${row[lower].name} ${row[`${lower}Port`]}.`, { connectionId: row.id }));
      }
      endpointMap.set(key, { connectionId: row.id, shared: shared || Boolean(previous?.shared) });
    }
  }

  for (const [group, groupRows] of byGroup) {
    const ordered = [...groupRows].filter((row) => Number.isFinite(row.assignedLengthM)).sort((a, b) => a.routeScore - b.routeScore || a.id.localeCompare(b.id));
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].assignedLengthM < ordered[index - 1].assignedLengthM) {
        findings.push(finding("WARNING", "ROUTE_ORDER_INVERSION", `${group}: longer route ${ordered[index].id} received a shorter cable than ${ordered[index - 1].id}.`, { connectionId: ordered[index].id, allocationGroup: group }));
      }
    }
  }

  for (const bomRow of bom) {
    const actual = rows.filter((row) => row.allocationGroup === bomRow.allocationGroup && row.cableModel === bomRow.cableModel && row.assignedLengthM === bomRow.lengthM).length;
    if (actual !== bomRow.quantity) {
      findings.push(finding("ERROR", "BOM_BUCKET_MISMATCH", `${bomRow.allocationGroup} ${bomRow.cableModel} ${bomRow.lengthM} m: P2P ${actual}, BOM ${bomRow.quantity}.`, { allocationGroup: bomRow.allocationGroup }));
    }
  }

  return { project, equipment, bom, rows, findings, options: config.options || {} };
}

function columnLetter(index) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function titleBand(sheet, title, width, color = COLORS.navy) {
  const last = columnLetter(width - 1);
  sheet.getRange(`A1:${last}1`).merge();
  sheet.getRange("A1").values = [[title]];
  sheet.getRange(`A1:${last}1`).format = {
    fill: color,
    font: { bold: true, color: COLORS.white, size: 16 },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  sheet.getRange("A1").format.rowHeight = 30;
}

function styleHeader(sheet, range, color = COLORS.teal) {
  sheet.getRange(range).format = {
    fill: color,
    font: { bold: true, color: COLORS.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: COLORS.border },
  };
}

function styleBody(sheet, range) {
  sheet.getRange(range).format = {
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: COLORS.border },
  };
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getRange(`${columnLetter(index)}:${columnLetter(index)}`).format.columnWidth = width;
  });
}

function sheetBase(sheet, freezeRows = 3) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(freezeRows);
}

export async function createWorkbook(model) {
  const workbook = Workbook.create();
  const instructions = workbook.worksheets.add("Instructions");
  const equipmentSheet = workbook.worksheets.add("Equipment List");
  const bomSheet = workbook.worksheets.add("BOM");
  const connectionSheet = workbook.worksheets.add("Connections");
  const p2pSheet = workbook.worksheets.add("P2P");
  const qaSheet = workbook.worksheets.add("QA");

  titleBand(instructions, `${model.project.name || "P2P Project"} - Instructions`, 4);
  instructions.getRange("A3:D3").values = [["Topic", "Value", "Source / Rule", "Action"]];
  styleHeader(instructions, "A3:D3");
  const instructionRows = [
    ["Length mode", model.project.lengthMode || "", "project.lengthMode", "Do not change without approval"],
    ["Equipment authority", "Equipment List", "Device name, room, rack, RU, role, model", "Resolve every endpoint"],
    ["P2P granularity", "One physical cable or breakout branch per row", "Engineering rule", "One device and one port per cell"],
    ["BOM behavior", "BOM quantities are immutable inputs", "Customer BOM", "Report deltas; never hide them"],
    ["Copper modules", "Blank", "UTP/CAT6/CAT6A/RJ45 are passive", "Do not add transceivers"],
    ["Visual QA", "Required", "Render every sheet", "Check clipping, merges, widths, formulas"],
  ];
  instructions.getRange(`A4:D${3 + instructionRows.length}`).values = instructionRows;
  styleBody(instructions, `A4:D${3 + instructionRows.length}`);
  setWidths(instructions, [24, 38, 44, 34]);
  sheetBase(instructions, 3);

  const eqHeaders = ["ID", "Device Name", "Room", "Rack", "RU", "Role", "Model", "X (m)", "Y (m)"];
  titleBand(equipmentSheet, `${model.project.name || "P2P Project"} - Equipment List`, eqHeaders.length);
  equipmentSheet.getRange(`A3:I3`).values = [eqHeaders];
  styleHeader(equipmentSheet, "A3:I3");
  const eqRows = model.equipment.map((item) => [item.id, item.name, item.room, item.rack, item.ru, item.role, item.model || "", item.xM ?? "", item.yM ?? ""]);
  if (eqRows.length) {
    equipmentSheet.getRange(`A4:I${3 + eqRows.length}`).values = eqRows;
    styleBody(equipmentSheet, `A4:I${3 + eqRows.length}`);
    equipmentSheet.getRange(`H4:I${3 + eqRows.length}`).format.numberFormat = "0.00";
  }
  setWidths(equipmentSheet, [18, 34, 14, 12, 10, 20, 24, 10, 10]);
  sheetBase(equipmentSheet, 3);

  const bomHeaders = ["Allocation Group", "Network", "Cable Class", "Cable Model", "Length (m)", "Planned Qty", "Actual Qty", "Delta", "Transceiver Rule"];
  titleBand(bomSheet, `${model.project.name || "P2P Project"} - Cable BOM`, bomHeaders.length);
  bomSheet.getRange("A3:I3").values = [bomHeaders];
  styleHeader(bomSheet, "A3:I3");
  const bomRows = model.bom.map((item) => [item.allocationGroup, item.network, item.cableClass, item.cableModel, item.lengthM, item.quantity, "", "", item.transceiverRule]);
  if (bomRows.length) {
    const end = 3 + bomRows.length;
    bomSheet.getRange(`A4:I${end}`).values = bomRows;
    for (let row = 4; row <= end; row += 1) {
      bomSheet.getRange(`G${row}`).formulas = [[`=COUNTIFS(P2P!$S$4:$S$${Math.max(503, model.rows.length + 10)},A${row},P2P!$N$4:$N$${Math.max(503, model.rows.length + 10)},D${row},P2P!$O$4:$O$${Math.max(503, model.rows.length + 10)},E${row})`]];
      bomSheet.getRange(`H${row}`).formulas = [[`=G${row}-F${row}`]];
    }
    styleBody(bomSheet, `A4:I${end}`);
    bomSheet.getRange(`E4:H${end}`).format.numberFormat = "0";
  }
  setWidths(bomSheet, [24, 24, 14, 24, 12, 12, 12, 10, 24]);
  sheetBase(bomSheet, 3);

  const connectionHeaders = ["ID", "Allocation Group", "A Equipment ID", "A Port", "A Transceiver", "A Module Group", "Z Equipment ID", "Z Port", "Z Transceiver", "Z Module Group", "Route Score", "Route (m)", "Locked Length (m)", "Shared A", "Shared Z", "Remark"];
  titleBand(connectionSheet, `${model.project.name || "P2P Project"} - Connection Inputs`, connectionHeaders.length);
  connectionSheet.getRange(`A3:P3`).values = [connectionHeaders];
  styleHeader(connectionSheet, "A3:P3");
  const connectionRows = model.rows.map((row) => [row.id, row.allocationGroup, row.a.id, row.aPort, row.aTransceiver || "", row.aModuleGroup || "", row.z.id, row.zPort, row.zTransceiver || "", row.zModuleGroup || "", row.routeScore, row.routeM ?? "", row.lockedLengthM ?? "", Boolean(row.sharedA), Boolean(row.sharedZ), row.remark]);
  if (connectionRows.length) {
    connectionSheet.getRange(`A4:P${3 + connectionRows.length}`).values = connectionRows;
    styleBody(connectionSheet, `A4:P${3 + connectionRows.length}`);
  }
  setWidths(connectionSheet, [14, 24, 20, 18, 22, 20, 20, 20, 22, 20, 12, 12, 16, 10, 10, 30]);
  sheetBase(connectionSheet, 3);

  const p2pHeaders = ["SEQ", "A Device", "A Room", "A Rack", "A RU", "A Port", "A Transceiver", "Z Device", "Z Room", "Z Rack", "Z RU", "Z Port", "Z Transceiver", "Cable Type", "Length (m)", "Remark", "A-End Label", "Z-End Label", "Allocation Group", "Transceiver Rule", "A Module Group", "Z Module Group", "Route Score", "Raw Route (m)", "QA Status"];
  titleBand(p2pSheet, `${model.project.name || "P2P Project"} - P2P`, p2pHeaders.length);
  p2pSheet.getRange(`A3:Y3`).values = [p2pHeaders];
  styleHeader(p2pSheet, "A3:G3", COLORS.teal);
  styleHeader(p2pSheet, "H3:M3", COLORS.purple);
  styleHeader(p2pSheet, "N3:Y3", COLORS.navy);
  const separator = model.options.labelSeparator || "|";
  const p2pRows = model.rows.map((row, index) => [
    index + 1, row.a.name, row.a.room, row.a.rack, row.a.ru, row.aPort, row.aTransceiver || "",
    row.z.name, row.z.room, row.z.rack, row.z.ru, row.zPort, row.zTransceiver || "",
    row.cableModel || "", row.assignedLengthM ?? "", row.remark,
    `${row.a.name}${separator}${row.aPort}`, `${row.z.name}${separator}${row.zPort}`,
    row.allocationGroup, row.transceiverRule, row.aModuleGroup || "", row.zModuleGroup || "",
    row.routeScore, row.rawRouteM ?? "", "",
  ]);
  if (p2pRows.length) {
    const end = 3 + p2pRows.length;
    p2pSheet.getRange(`A4:Y${end}`).values = p2pRows;
    for (let row = 4; row <= end; row += 1) {
      p2pSheet.getRange(`Y${row}`).formulas = [[`=IF(OR(B${row}="",F${row}="",H${row}="",L${row}="",N${row}="",O${row}=""),"ERROR","OK")`]];
    }
    styleBody(p2pSheet, `A4:Y${end}`);
    p2pSheet.getRange(`O4:O${end}`).format.numberFormat = "0";
    p2pSheet.getRange(`W4:X${end}`).format.numberFormat = "0.00";
    p2pSheet.getRange(`Y4:Y${end}`).format.horizontalAlignment = "center";
  }
  setWidths(p2pSheet, [8, 31, 12, 10, 9, 18, 22, 31, 12, 10, 9, 22, 22, 22, 11, 28, 42, 42, 24, 24, 20, 20, 12, 14, 12]);
  sheetBase(p2pSheet, 3);

  titleBand(qaSheet, `${model.project.name || "P2P Project"} - QA`, 7);
  qaSheet.getRange("A3:C3").values = [["Metric", "Value", "Release Rule"]];
  styleHeader(qaSheet, "A3:C3");
  qaSheet.getRange("A4:C7").values = [
    ["P2P Rows", model.rows.length, "Must reconcile to BOM"],
    ["BOM Planned", model.bom.reduce((sum, row) => sum + Number(row.quantity || 0), 0), "Must equal P2P Rows"],
    ["Errors", "", "Must be 0"],
    ["Warnings", "", "Review and approve"],
  ];
  qaSheet.getRange("B6").formulas = [[`=COUNTIF(A11:A${Math.max(11, 10 + model.findings.length)},"ERROR")`]];
  qaSheet.getRange("B7").formulas = [[`=COUNTIF(A11:A${Math.max(11, 10 + model.findings.length)},"WARNING")`]];
  styleBody(qaSheet, "A4:C7");
  qaSheet.getRange("A9:G9").values = [["Severity", "Code", "Message", "Connection", "Allocation Group", "Equipment", "Disposition"]];
  styleHeader(qaSheet, "A9:G9", COLORS.purple);
  const qaRows = model.findings.map((item) => [item.severity, item.code, item.message, item.connectionId || "", item.allocationGroup || "", item.equipmentId || "", item.severity === "ERROR" ? "Correct before release" : "Review"]);
  if (qaRows.length) {
    qaSheet.getRange(`A11:G${10 + qaRows.length}`).values = qaRows;
    styleBody(qaSheet, `A11:G${10 + qaRows.length}`);
  } else {
    qaSheet.getRange("A11:G11").merge();
    qaSheet.getRange("A11").values = [["No semantic findings. Visual QA is still required."]];
    qaSheet.getRange("A11:G11").format = { fill: COLORS.green, font: { bold: true }, horizontalAlignment: "center", verticalAlignment: "center" };
  }
  setWidths(qaSheet, [14, 28, 76, 18, 24, 20, 24]);
  sheetBase(qaSheet, 3);

  return workbook;
}

export async function saveWorkbook(workbook, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
}

export async function renderWorkbook(inputPath, outputDir) {
  const blob = await FileBlob.load(inputPath);
  const workbook = await SpreadsheetFile.importXlsx(blob);
  const names = ["Instructions", "Equipment List", "BOM", "Connections", "P2P", "QA"];
  await fs.mkdir(outputDir, { recursive: true });
  const rendered = [];
  for (const name of names) {
    try {
      const preview = await workbook.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
      const target = path.join(outputDir, `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
      await fs.writeFile(target, new Uint8Array(await preview.arrayBuffer()));
      rendered.push(target);
    } catch (error) {
      rendered.push({ sheet: name, error: error.message });
    }
  }
  return rendered;
}

function findHeaderMap(rows) {
  let best = null;
  const limit = Math.min(rows.length, 12);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const normalized = (rows[rowIndex] || []).map(normalizeHeader);
    const map = {};
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      const index = normalized.findIndex((header) => aliases.some((alias) => header === normalizeHeader(alias) || header.includes(normalizeHeader(alias))));
      if (index >= 0) map[key] = index;
    }
    const score = ["aDevice", "aPort", "zDevice", "zPort"].filter((key) => Number.isInteger(map[key])).length;
    if (!best || score > best.score) best = { rowIndex, map, score };
  }
  return best && best.score >= 3 ? best : null;
}

function findAliasHeader(rows, aliases, requiredKeys, minimum = requiredKeys.length) {
  let best = null;
  const limit = Math.min(rows.length, 15);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const normalized = (rows[rowIndex] || []).map(normalizeHeader);
    const map = {};
    for (const [key, candidates] of Object.entries(aliases)) {
      const index = normalized.findIndex((header) => candidates.some((candidate) => header === normalizeHeader(candidate)));
      if (index >= 0) map[key] = index;
    }
    const score = requiredKeys.filter((key) => Number.isInteger(map[key])).length;
    if (!best || score > best.score) best = { rowIndex, map, score };
  }
  return best && best.score >= minimum ? best : null;
}

function valueAt(row, index) {
  return Number.isInteger(index) ? row[index] : "";
}

function parseLength(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = normalizeText(value).match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export async function auditWorkbook(inputPath, options = {}) {
  const blob = await FileBlob.load(inputPath);
  const workbook = await SpreadsheetFile.importXlsx(blob);
  const inspect = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 12000 });
  const inspectText = typeof inspect === "string" ? inspect : inspect?.ndjson || JSON.stringify(inspect);
  const names = [];
  for (const line of inspectText.split(/\n/)) {
    try {
      const item = JSON.parse(line);
      const name = item.name || item.sheetName;
      if (name && !names.includes(name)) names.push(name);
    } catch {
      const match = line.match(/"name"\s*:\s*"([^"]+)"/);
      if (match && !names.includes(match[1])) names.push(match[1]);
    }
  }
  if (!names.length) {
    for (let index = 0; index < 100; index += 1) {
      try {
        const sheet = workbook.worksheets.getItemAt(index);
        if (!sheet) break;
        names.push(sheet.name);
      } catch {
        break;
      }
    }
  }

  const findings = [];
  const sheetReports = [];
  const endpointSeen = new Map();
  const moduleRegistry = options.moduleRegistry || {};
  const sheetValues = new Map();
  for (const name of names) {
    const sheet = workbook.worksheets.getItem(name);
    const used = sheet.getUsedRange(true);
    if (used) sheetValues.set(name, used.values || []);
  }

  const equipmentByName = new Map();
  for (const [name, values] of sheetValues) {
    const header = findAliasHeader(values, EQUIPMENT_ALIASES, ["name", "room", "rack", "ru"], 3);
    if (!header || findHeaderMap(values)) continue;
    for (let index = header.rowIndex + 1; index < values.length; index += 1) {
      const row = values[index] || [];
      const deviceName = normalizeText(valueAt(row, header.map.name));
      if (!deviceName) continue;
      equipmentByName.set(deviceName.toLowerCase(), {
        name: deviceName,
        room: normalizeText(valueAt(row, header.map.room)),
        rack: normalizeText(valueAt(row, header.map.rack)),
        ru: normalizeRu(valueAt(row, header.map.ru)),
        role: normalizeText(valueAt(row, header.map.role)),
        model: normalizeText(valueAt(row, header.map.model)),
        sheet: name,
        row: index + 1,
      });
    }
  }

  const bomExpected = new Map();
  const bomRuleByGroup = new Map();
  for (const [name, values] of sheetValues) {
    const header = findAliasHeader(values, BOM_ALIASES, ["allocationGroup", "cableModel", "lengthM", "plannedQty"], 4);
    if (!header) continue;
    for (let index = header.rowIndex + 1; index < values.length; index += 1) {
      const row = values[index] || [];
      const group = normalizeText(valueAt(row, header.map.allocationGroup));
      const model = normalizeText(valueAt(row, header.map.cableModel));
      const lengthM = parseLength(valueAt(row, header.map.lengthM));
      const quantity = parseLength(valueAt(row, header.map.plannedQty));
      if (!group || !model || lengthM === null || quantity === null) continue;
      const key = `${group}|${model}|${lengthM}`.toLowerCase();
      bomExpected.set(key, { group, model, lengthM, quantity, sheet: name, row: index + 1 });
      const rule = normalizeText(valueAt(row, header.map.transceiverRule)).toLowerCase();
      if (rule) bomRuleByGroup.set(group.toLowerCase(), rule);
    }
  }

  const bomActual = new Map();
  const groupRoutes = new Map();
  const moduleGroups = { A: new Map(), Z: new Map() };
  for (const [name, values] of sheetValues) {
    const header = findHeaderMap(values);
    if (!header) continue;
    const { map, rowIndex } = header;
    let dataCount = 0;
    for (let index = rowIndex + 1; index < values.length; index += 1) {
      const row = values[index] || [];
      const aDevice = normalizeText(valueAt(row, map.aDevice));
      const aPort = normalizeText(valueAt(row, map.aPort));
      const zDevice = normalizeText(valueAt(row, map.zDevice));
      const zPort = normalizeText(valueAt(row, map.zPort));
      if (![aDevice, aPort, zDevice, zPort].some(Boolean)) continue;
      dataCount += 1;
      const excelRow = index + 1;
      if (!aDevice || !aPort || !zDevice || !zPort) findings.push(finding("ERROR", "ENDPOINT_REQUIRED", `${name}!${excelRow} has an incomplete endpoint.`, { sheet: name, row: excelRow }));
      const cableType = normalizeText(valueAt(row, map.cableType));
      const allocationGroup = normalizeText(valueAt(row, map.allocationGroup));
      const aTransceiver = normalizeText(valueAt(row, map.aTransceiver));
      const zTransceiver = normalizeText(valueAt(row, map.zTransceiver));
      const rule = normalizeText(valueAt(row, map.transceiverRule)).toLowerCase() || bomRuleByGroup.get(allocationGroup.toLowerCase()) || "";
      const lengthValue = valueAt(row, map.lengthM);
      const lengthM = parseLength(lengthValue);
      if (!cableType) findings.push(finding("ERROR", "CABLE_TYPE_REQUIRED", `${name}!${excelRow} has no cable type.`, { sheet: name, row: excelRow }));
      if (Number.isInteger(map.lengthM) && lengthM === null) findings.push(finding("ERROR", "LENGTH_REQUIRED", `${name}!${excelRow} has no parseable cable length.`, { sheet: name, row: excelRow }));
      if (typeof lengthValue === "string" && normalizeText(lengthValue) && lengthM !== null) findings.push(finding("WARNING", "LENGTH_AS_TEXT", `${name}!${excelRow} stores length as text.`, { sheet: name, row: excelRow }));
      const suffix = parseModelLength(cableType);
      if (suffix !== null && lengthM !== null && Math.abs(suffix - lengthM) > 0.01) findings.push(finding("ERROR", "MODEL_LENGTH_MISMATCH", `${name}!${excelRow} model ${cableType} disagrees with ${lengthM} m.`, { sheet: name, row: excelRow }));
      if (isCopper("", cableType) && (aTransceiver || zTransceiver)) findings.push(finding("ERROR", "COPPER_TRANSCEIVER", `${name}!${excelRow} is passive copper but contains a transceiver.`, { sheet: name, row: excelRow }));
      if (!isCopper("", cableType) && rule === "both" && (!aTransceiver || !zTransceiver)) findings.push(finding("ERROR", "TRANSCEIVER_BOTH_REQUIRED", `${name}!${excelRow} requires both transceivers.`, { sheet: name, row: excelRow }));
      if (!isCopper("", cableType) && rule === "a-once-per-group" && !zTransceiver) findings.push(finding("ERROR", "Z_BRANCH_MODULE_REQUIRED", `${name}!${excelRow} requires a Z branch module.`, { sheet: name, row: excelRow }));
      if (!isCopper("", cableType) && rule === "z-once-per-group" && !aTransceiver) findings.push(finding("ERROR", "A_BRANCH_MODULE_REQUIRED", `${name}!${excelRow} requires an A branch module.`, { sheet: name, row: excelRow }));
      const rawRouteM = parseLength(valueAt(row, map.rawRouteM));
      if (rawRouteM !== null && lengthM !== null && rawRouteM > lengthM) findings.push(finding("ERROR", "ROUTE_EXCEEDS_CABLE", `${name}!${excelRow} route ${rawRouteM} m exceeds cable ${lengthM} m.`, { sheet: name, row: excelRow }));

      for (const [side, device, port] of [["A", aDevice, aPort], ["Z", zDevice, zPort]]) {
        if (!device || !port) continue;
        const key = `${device}|${port}`.toLowerCase();
        if (endpointSeen.has(key)) findings.push(finding("ERROR", "DUPLICATE_PORT", `${side}-end port ${device} ${port} is reused in ${name}!${excelRow}.`, { sheet: name, row: excelRow }));
        endpointSeen.set(key, `${name}!${excelRow}`);
      }

      for (const [side, device, port, group, module] of [
        ["A", aDevice, aPort, normalizeText(valueAt(row, map.aModuleGroup)), aTransceiver],
        ["Z", zDevice, zPort, normalizeText(valueAt(row, map.zModuleGroup)), zTransceiver],
      ]) {
        if (!group) continue;
        const groupKey = `${device}|${group}`.toLowerCase();
        if (!moduleGroups[side].has(groupKey)) moduleGroups[side].set(groupKey, { count: 0, rows: 0, rule, locations: [] });
        const groupState = moduleGroups[side].get(groupKey);
        groupState.rows += 1;
        if (module) groupState.count += 1;
        groupState.locations.push(`${name}!${excelRow}`);
        const registryKey = `${device}|${port}|${group}`.toLowerCase();
        if (moduleRegistry[registryKey] && moduleRegistry[registryKey] !== inputPath) findings.push(finding("WARNING", "CROSS_WORKBOOK_MODULE", `${side}-end physical module ${registryKey} is also registered to ${moduleRegistry[registryKey]}.`, { sheet: name, row: excelRow }));
        moduleRegistry[registryKey] = inputPath;
      }

      for (const [side, device, roomValue, rackValue, ruValue] of [
        ["A", aDevice, valueAt(row, map.aRoom), valueAt(row, map.aRack), valueAt(row, map.aRu)],
        ["Z", zDevice, valueAt(row, map.zRoom), valueAt(row, map.zRack), valueAt(row, map.zRu)],
      ]) {
        if (!device || !equipmentByName.size) continue;
        const equipment = equipmentByName.get(device.toLowerCase());
        if (!equipment) {
          findings.push(finding("ERROR", "UNKNOWN_EQUIPMENT", `${name}!${excelRow} ${side}-end device ${device} is absent from Equipment List.`, { sheet: name, row: excelRow }));
          continue;
        }
        const comparisons = [
          ["room", normalizeText(roomValue), equipment.room],
          ["rack", normalizeText(rackValue), equipment.rack],
          ["RU", normalizeRu(ruValue), equipment.ru],
        ];
        for (const [field, actual, expected] of comparisons) {
          if (actual && expected && actual.toLowerCase() !== expected.toLowerCase()) findings.push(finding("ERROR", "EQUIPMENT_LOCATION_MISMATCH", `${name}!${excelRow} ${side} ${field} ${actual} conflicts with Equipment List ${expected}.`, { sheet: name, row: excelRow }));
        }
      }

      if (allocationGroup && cableType && lengthM !== null) {
        const bomKey = `${allocationGroup}|${cableType}|${lengthM}`.toLowerCase();
        bomActual.set(bomKey, (bomActual.get(bomKey) || 0) + 1);
      }
      const routeScoreValue = parseLength(valueAt(row, map.routeScore));
      if (allocationGroup && routeScoreValue !== null && lengthM !== null) {
        if (!groupRoutes.has(allocationGroup)) groupRoutes.set(allocationGroup, []);
        groupRoutes.get(allocationGroup).push({ score: routeScoreValue, lengthM, location: `${name}!${excelRow}` });
      }
    }
    sheetReports.push({ sheet: name, headerRow: rowIndex + 1, dataRows: dataCount });
  }

  for (const [key, expected] of bomExpected) {
    const actual = bomActual.get(key) || 0;
    if (actual !== expected.quantity) findings.push(finding("ERROR", "BOM_BUCKET_MISMATCH", `${expected.group} ${expected.model} ${expected.lengthM} m: P2P ${actual}, BOM ${expected.quantity}.`, { sheet: expected.sheet, row: expected.row }));
  }
  for (const [key, actual] of bomActual) {
    if (!bomExpected.has(key) && bomExpected.size) findings.push(finding("ERROR", "P2P_NOT_IN_BOM", `P2P contains ${actual} cable(s) for unlisted BOM bucket ${key}.`));
  }
  for (const [side, groups] of Object.entries(moduleGroups)) {
    for (const [group, state] of groups) {
      const onceRequired = state.rule === `${side.toLowerCase()}-once-per-group` || state.rule === "both-once-per-group";
      if (onceRequired && state.count !== 1) findings.push(finding("ERROR", "MODULE_GROUP_COUNT", `${side} module group ${group} has ${state.count} module entries; expected 1.`, { location: state.locations.join(", ") }));
    }
  }
  for (const [group, routes] of groupRoutes) {
    const ordered = routes.sort((a, b) => a.score - b.score);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].lengthM < ordered[index - 1].lengthM) findings.push(finding("WARNING", "ROUTE_ORDER_INVERSION", `${group}: ${ordered[index].location} has a longer route score but a shorter cable than ${ordered[index - 1].location}.`));
    }
  }

  if (!sheetReports.length) findings.push(finding("ERROR", "NO_P2P_SHEET", "No sheet with recognizable P2P endpoint headers was found."));
  return {
    input: path.resolve(inputPath),
    auditedAt: new Date().toISOString(),
    sheets: sheetReports,
    summary: {
      errors: findings.filter((item) => item.severity === "ERROR").length,
      warnings: findings.filter((item) => item.severity === "WARNING").length,
      info: findings.filter((item) => item.severity === "INFO").length,
    },
    findings,
    moduleRegistry,
  };
}

export function auditMarkdown(report) {
  const lines = [
    "# P2P Audit Report",
    "",
    `- Input: \`${report.input}\``,
    `- Audited: ${report.auditedAt}`,
    `- Errors: ${report.summary.errors}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Informational: ${report.summary.info}`,
    "",
    "## Recognized sheets",
    "",
    "| Sheet | Header row | Data rows |",
    "|---|---:|---:|",
    ...report.sheets.map((item) => `| ${item.sheet} | ${item.headerRow} | ${item.dataRows} |`),
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("No semantic findings. Visual QA is still required.");
  for (const item of report.findings) lines.push(`- **${item.severity} ${item.code}** — ${item.message}`);
  lines.push("");
  return lines.join("\n");
}

export async function inspectWorkbook(inputPath) {
  const blob = await FileBlob.load(inputPath);
  const workbook = await SpreadsheetFile.importXlsx(blob);
  const overview = await workbook.inspect({ kind: "workbook,sheet,formula", maxChars: 20000, tableMaxRows: 8, tableMaxCols: 12, options: { maxResults: 200 } });
  return typeof overview === "string" ? overview : overview?.ndjson || JSON.stringify(overview, null, 2);
}
