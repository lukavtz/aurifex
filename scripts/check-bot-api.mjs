#!/usr/bin/env node
// Pins the Bot API surface Aurifex types against and watches the official docs
// for drift. Network failures are never a pass: they exit 1 with
// "network_unavailable" so a scheduled run cannot silently go green.
//
// Modes:
//   --check    fail when the live version or the 10.4 method/type set changed
//   --update   rewrite the pinned contract from the live 10.4 changelog block
//   --version  print the newest documented Bot API version
//
// Test flags: --changelog-file, --api-file, --contract-file, --base-url.

import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_BASE_URL = "https://core.telegram.org/bots";
const CONTRACT_PATH = new URL("../src/core/targets/bot-api-contract.json", import.meta.url);

const VERSION_RE = /\*\*Bot API (\d+)\.(\d+)\*\*/;
const METHOD_LINK_RE = /\[([A-Za-z][A-Za-z0-9]*)\]\(\/bots\/api\/methods\/[a-z0-9_]+\.md\)/g;
const TYPE_LINK_RE = /\[([A-Za-z][A-Za-z0-9]*)\]\(\/bots\/api\/types\/[a-z0-9_]+\.md\)/g;
const DATE_RE = /^#### (.+)$/gm;

class DriftError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DriftError";
    this.code = code;
  }
}

function usage() {
  return `usage: node scripts/check-bot-api.mjs --check|--update|--version [options]

  --changelog-file <path>  read the changelog locally instead of fetching
  --api-file <path>        read api.md locally instead of fetching
  --contract-file <path>   compare against a different contract
  --base-url <url>         docs base URL (default ${DEFAULT_BASE_URL})
  --json                   machine-readable result on stdout`;
}

function parseArgs(argv) {
  const args = { mode: undefined, json: false, baseUrl: DEFAULT_BASE_URL };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--check":
      case "--update":
      case "--version": {
        if (args.mode !== undefined) throw new DriftError("usage", "exactly one mode is allowed");
        args.mode = arg.slice(2);
        break;
      }
      case "--json":
        args.json = true;
        break;
      case "--changelog-file":
      case "--api-file":
      case "--contract-file":
      case "--base-url": {
        const value = argv[index + 1];
        if (value === undefined) throw new DriftError("usage", `${arg} requires a value`);
        index += 1;
        args[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
        break;
      }
      default:
        throw new DriftError("usage", `unknown argument: ${arg}`);
    }
  }
  if (args.mode === undefined)
    throw new DriftError("usage", "one of --check, --update, --version is required");
  return args;
}

async function loadSource({ label, file, baseUrl, path }) {
  if (file !== undefined) {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      throw new DriftError("file_unavailable", `${label}: ${error.message}`);
    }
  }
  const url = `${baseUrl}${path}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new DriftError("network_unavailable", `${label}: ${url}: ${error.message}`);
  }
  if (!response.ok) {
    throw new DriftError("network_unavailable", `${label}: ${url}: HTTP ${response.status}`);
  }
  try {
    return await response.text();
  } catch (error) {
    throw new DriftError("network_unavailable", `${label}: ${url}: ${error.message}`);
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].toSorted();
}

function collectLinks(text, regex) {
  return uniqueSorted([...text.matchAll(regex)].map((match) => match[1]));
}

function parseVersion(changelog) {
  const match = VERSION_RE.exec(changelog);
  if (match === null) throw new DriftError("parse_failed", "changelog: no **Bot API X.Y** heading");
  return { major: Number(match[1]), minor: Number(match[2]), raw: `${match[1]}.${match[2]}` };
}

function versionBlock(changelog, match) {
  const start = match.index;
  const rest = changelog.slice(start + match[0].length);
  const end = rest.search(/\n#### |\n\*\*Bot API /);
  return changelog.slice(start, end === -1 ? undefined : start + match[0].length + end);
}

function releaseDate(changelog, versionIndex) {
  const heading = [...changelog.slice(0, versionIndex).matchAll(DATE_RE)].at(-1)?.[1]?.trim();
  if (heading === undefined) return undefined;
  const parsed = Date.parse(`${heading} UTC`);
  return Number.isNaN(parsed) ? heading : new Date(parsed).toISOString().slice(0, 10);
}

function liveSurface(changelog, apiIndex) {
  const version = parseVersion(changelog);
  const match = VERSION_RE.exec(changelog);
  const block = versionBlock(changelog, match);
  const methods = collectLinks(block, METHOD_LINK_RE);
  const types = collectLinks(block, TYPE_LINK_RE);
  const indexMethods = collectLinks(apiIndex, METHOD_LINK_RE);
  if (indexMethods.length === 0) {
    throw new DriftError(
      "parse_failed",
      "api.md: no method links; the docs response is not usable",
    );
  }
  return { version, date: releaseDate(changelog, match.index), methods, types, indexMethods };
}

function validateContract(value, source) {
  const fail = (message) => {
    throw new DriftError("contract_invalid", `${source}: ${message}`);
  };
  if (typeof value !== "object" || value === null) fail("not a JSON object");
  if (typeof value.botApiVersion !== "string" || !/^\d+\.\d+$/.test(value.botApiVersion)) {
    fail("botApiVersion must look like 10.4");
  }
  for (const field of ["methods", "types"]) {
    if (!Array.isArray(value[field]) || value[field].some((item) => typeof item !== "string")) {
      fail(`${field} must be an array of strings`);
    }
  }
  return value;
}

async function readContract(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new DriftError("contract_missing", `${path}: ${error.message}`);
  }
  try {
    return validateContract(JSON.parse(raw), path);
  } catch (error) {
    if (error instanceof DriftError) throw error;
    throw new DriftError("contract_invalid", `${path}: ${error.message}`);
  }
}

function setDiff(left, right) {
  const rightSet = new Set(right);
  const leftSet = new Set(left);
  return {
    missing: left.filter((item) => !rightSet.has(item)),
    added: right.filter((item) => !leftSet.has(item)),
  };
}

function compareVersion(a, b) {
  return a.major - b.major || a.minor - b.minor;
}

function compare(live, contract) {
  const diffs = [];
  const pinned = validateContract(
    {
      botApiVersion: contract.botApiVersion,
      methods: contract.methods,
      types: contract.types,
    },
    "contract",
  );
  const [pinnedMajor, pinnedMinor] = pinned.botApiVersion.split(".").map(Number);
  const versionDelta = compareVersion(live.version, { major: pinnedMajor, minor: pinnedMinor });
  if (versionDelta > 0) {
    diffs.push(`live Bot API ${live.version.raw} is newer than pinned ${pinned.botApiVersion}`);
  } else if (versionDelta < 0) {
    diffs.push(
      `pinned contract ${pinned.botApiVersion} is newer than live Bot API ${live.version.raw}`,
    );
  }
  const methods = setDiff(pinned.methods, live.methods);
  for (const name of methods.missing)
    diffs.push(`method removed from ${live.version.raw}: ${name}`);
  for (const name of methods.added) diffs.push(`method added to ${live.version.raw}: ${name}`);
  const types = setDiff(pinned.types, live.types);
  for (const name of types.missing) diffs.push(`type removed from ${live.version.raw}: ${name}`);
  for (const name of types.added) diffs.push(`type added to ${live.version.raw}: ${name}`);
  return diffs;
}

function contractFrom(live) {
  return {
    botApiVersion: live.version.raw,
    date: live.date,
    source: `${DEFAULT_BASE_URL}/api-changelog.md`,
    methods: live.methods,
    types: live.types,
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.code}: ${error.message}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const baseUrl = args.baseUrl.replace(/\/$/, "");
  try {
    const changelog = await loadSource({
      label: "changelog",
      file: args.changelogFile,
      baseUrl,
      path: "/api-changelog.md",
    });
    const apiIndex = await loadSource({
      label: "api.md",
      file: args.apiFile,
      baseUrl,
      path: "/api.md",
    });
    const live = liveSurface(changelog, apiIndex);

    if (args.mode === "version") {
      console.log(live.version.raw);
      return;
    }

    const contractPath = args.contractFile ?? CONTRACT_PATH;
    if (args.mode === "update") {
      const contract = contractFrom(live);
      await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
      console.log(
        `bot-api contract updated: ${contract.botApiVersion} (${contract.methods.length} methods, ${contract.types.length} types) -> ${contractPath}`,
      );
      return;
    }

    const contract = await readContract(contractPath);
    const diffs = compare(live, contract);
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: diffs.length === 0,
            version: live.version.raw,
            pinnedVersion: contract.botApiVersion,
            methods: live.methods.length,
            types: live.types.length,
            apiIndexMethods: live.indexMethods.length,
            diffs,
          },
          null,
          2,
        ),
      );
    } else if (diffs.length === 0) {
      console.log(
        `bot-api ok: ${live.version.raw} (${live.methods.length} methods, ${live.types.length} types, api index ${live.indexMethods.length} methods)`,
      );
    } else {
      console.error(`bot-api drift: ${live.version.raw} vs pinned ${contract.botApiVersion}`);
      for (const diff of diffs) console.error(`  - ${diff}`);
      console.error("review the changelog, then run: node scripts/check-bot-api.mjs --update");
    }
    if (diffs.length > 0) process.exitCode = 1;
  } catch (error) {
    const code = error instanceof DriftError ? error.code : "internal_error";
    console.error(`${code}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
