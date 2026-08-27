#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditMarkdown,
  auditWorkbook,
  buildModel,
  createWorkbook,
  inspectWorkbook,
  renderWorkbook,
  saveWorkbook,
} from "./lib/p2p-core.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(scriptDir, "..");

function usage() {
  return `P2P Cabling Engineering CLI

Usage:
  node scripts/p2p.mjs template --output <file.xlsx>
  node scripts/p2p.mjs build --config <project.json> --output <file.xlsx>
  node scripts/p2p.mjs audit --input <file.xlsx> [--report audit.json] [--markdown audit.md] [--module-registry registry.json] [--strict]
  node scripts/p2p.mjs render --input <file.xlsx> --output-dir <directory>
  node scripts/p2p.mjs inspect --input <file.xlsx>

Modes:
  template  Builds a fictional mini workbook suitable for reuse as a starter.
  build     Validates JSON, allocates BOM lengths, and creates an Excel workbook.
  audit     Reads an existing workbook without modifying it and writes QA reports.
  render    Renders the six standard workbook sheets to PNG for visual QA.
  inspect   Prints a bounded workbook/formula inspection for diagnostics.
`;
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      result._.push(item);
      continue;
    }
    const key = item.slice(2);
    if (key === "strict") {
      result.strict = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function build(configPath, outputPath) {
  const config = await readJson(configPath);
  const model = buildModel(config);
  const workbook = await createWorkbook(model);
  await saveWorkbook(workbook, outputPath);
  return {
    output: path.resolve(outputPath),
    connections: model.rows.length,
    bomQuantity: model.bom.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    errors: model.findings.filter((item) => item.severity === "ERROR").length,
    warnings: model.findings.filter((item) => item.severity === "WARNING").length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || ["help", "-h"].includes(command)) {
    process.stdout.write(usage());
    return;
  }

  if (command === "template") {
    if (!args.output) throw new Error("template requires --output");
    const samplePath = path.join(skillDir, "examples", "sample-project.json");
    const summary = await build(samplePath, args.output);
    process.stdout.write(`${JSON.stringify({ command, ...summary }, null, 2)}\n`);
    return;
  }

  if (command === "build") {
    if (!args.config || !args.output) throw new Error("build requires --config and --output");
    const summary = await build(args.config, args.output);
    process.stdout.write(`${JSON.stringify({ command, ...summary }, null, 2)}\n`);
    return;
  }

  if (command === "audit") {
    if (!args.input) throw new Error("audit requires --input");
    const moduleRegistry = args["module-registry"] ? await readJson(args["module-registry"]) : {};
    const report = await auditWorkbook(args.input, { moduleRegistry });
    if (args.report) {
      await fs.mkdir(path.dirname(args.report), { recursive: true });
      await fs.writeFile(args.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    if (args.markdown) {
      await fs.mkdir(path.dirname(args.markdown), { recursive: true });
      await fs.writeFile(args.markdown, auditMarkdown(report), "utf8");
    }
    process.stdout.write(`${JSON.stringify({ command, input: report.input, ...report.summary, sheets: report.sheets }, null, 2)}\n`);
    if (args.strict && report.summary.errors > 0) process.exitCode = 2;
    return;
  }

  if (command === "render") {
    if (!args.input || !args["output-dir"]) throw new Error("render requires --input and --output-dir");
    const rendered = await renderWorkbook(args.input, args["output-dir"]);
    process.stdout.write(`${JSON.stringify({ command, rendered }, null, 2)}\n`);
    return;
  }

  if (command === "inspect") {
    if (!args.input) throw new Error("inspect requires --input");
    process.stdout.write(`${await inspectWorkbook(args.input)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
