import { domainFailure, domainSuccess, sha256Hex, type DomainResult } from "../results.ts";
import {
  PathPolicyError,
  readOptionalFile,
  type PathPolicy,
} from "../security/path-policy.ts";
import { BOT_SPEC_VERSION, type BotStack } from "../spec/bot-spec.ts";
import { BOT_API_VERSION, resolveStack } from "../targets/catalog.ts";
import { detectProjectStack, joinProjectPath, normalizeProjectRoot } from "./deploy.ts";
import {
  MANIFEST_PATH,
  readManifest,
  writeManifest,
  type AurifexManifest,
} from "./manifest.ts";

export interface UpgradeResult {
  readonly currentBotApi: string;
  readonly targetBotApi: "10.4";
  readonly actions: readonly string[];
}

export interface UpgradeApplyResult extends UpgradeResult {
  readonly specVersion: string;
  readonly changed: readonly string[];
}

export interface UpgradeOptions {
  readonly apply?: boolean;
  readonly now?: () => Date;
}

function botApiActions(stack: BotStack): string[] {
  const target = resolveStack(stack).target;
  const rawCall =
    stack === "grammy" ? "bot.api.raw.<method>(payload)" : "await bot(<TelegramMethod subclass instance>)";
  const sendWidget =
    stack === "grammy" ? "bot.api.raw.sendWidget(payload)" : "await bot(SendWidget(...))";
  const answerWidgetQuery =
    stack === "grammy"
      ? "bot.api.raw.answerWidgetQuery(payload)"
      : "await bot(AnswerWidgetQuery(...))";
  const answerCallbackQuery =
    stack === "grammy"
      ? "bot.api.raw.answerCallbackQuery(payload)"
      : "await bot(AnswerWidgetQuery(...))";

  return [
    `Keep ${target.framework} ${target.frameworkVersion}; call ${rawCall} for Bot API ${BOT_API_VERSION} methods that the framework types do not include yet.`,
    `sendWidget: call ${sendWidget} and keep the widget payload typed locally; do not patch framework internals.`,
    `answerWidgetQuery: call ${answerWidgetQuery} and answer every widget query exactly once.`,
    `Ephemeral callback replies: pass the ephemeral flag through ${answerCallbackQuery}; do not rely on the typed answerCallbackQuery shortcut.`,
    `Rich-message quotes: send the quote fields through ${rawCall}; strip unknown fields before logging.`,
    `TON wallet cards: send the wallet-card payload through ${rawCall}; validate amounts as integer nanoTON before sending.`,
    `Add one regression test per raw method and re-check after each framework upgrade; switch back to typed helpers when the framework declares Bot API ${BOT_API_VERSION}.`,
  ];
}

export async function upgradePlan(
  projectRoot: string,
  policy: PathPolicy,
): Promise<DomainResult<UpgradeResult>> {
  const root = normalizeProjectRoot(projectRoot);
  try {
    if (root !== "") policy.resolve(root);
    const stack = await detectProjectStack(policy, root);
    if (stack === null) {
      return domainFailure({
        code: "project_unreadable",
        detail: "project has no grammY package.json or aiogram pyproject.toml",
        retryable: false,
        details: { path: "projectRoot" },
      });
    }

    return domainSuccess<UpgradeResult>({
      currentBotApi: resolveStack(stack).target.testedBotApi,
      targetBotApi: BOT_API_VERSION,
      actions: botApiActions(stack),
    });
  } catch (error) {
    if (error instanceof PathPolicyError) {
      return domainFailure({ code: error.code, detail: error.message, retryable: false });
    }
    return domainFailure({
      code: "internal_error",
      detail: error instanceof Error ? error.message : "unexpected upgrade planning failure",
      retryable: false,
    });
  }
}

async function mismatchedFiles(
  policy: PathPolicy,
  root: string,
  manifest: AurifexManifest,
): Promise<string[]> {
  const mismatches: string[] = [];
  for (const [path, expected] of Object.entries(manifest.files)) {
    const full = joinProjectPath(root, path);
    let content: string | null;
    try {
      content = await readOptionalFile(policy, full);
    } catch {
      content = null;
    }
    if (content === null || sha256Hex(content) !== expected) mismatches.push(full);
  }
  return mismatches;
}

/**
 * Safe project migration: verify generated files against the manifest, then bump
 * the manifest's spec version. The original BotSpec is not stored, so generated
 * files are never rewritten and the real migration steps are reported as actions.
 */
export async function upgradeProject(
  projectRoot: string,
  policy: PathPolicy,
  options: UpgradeOptions = {},
): Promise<DomainResult<UpgradeApplyResult>> {
  const root = normalizeProjectRoot(projectRoot);
  const apply = options.apply === true;
  const now = options.now ?? (() => new Date());
  try {
    if (root !== "") policy.resolve(root);

    let manifest: AurifexManifest | null;
    try {
      manifest = await readManifest(policy, root);
    } catch (error) {
      return domainFailure({
        code: "project_unreadable",
        detail: error instanceof Error ? error.message : "invalid manifest",
        retryable: false,
        details: { path: joinProjectPath(root, MANIFEST_PATH) },
      });
    }
    if (manifest === null) {
      return domainFailure({
        code: "project_unreadable",
        detail: "run aurifex upgrade --apply first",
        retryable: false,
        details: { path: joinProjectPath(root, MANIFEST_PATH) },
      });
    }

    const target = resolveStack(manifest.stack).target;
    if (manifest.specVersion === BOT_SPEC_VERSION) {
      return domainSuccess<UpgradeApplyResult>({
        currentBotApi: target.testedBotApi,
        targetBotApi: BOT_API_VERSION,
        specVersion: manifest.specVersion,
        actions: [],
        changed: [],
      });
    }

    const mismatches = await mismatchedFiles(policy, root, manifest);
    if (mismatches.length > 0) {
      return domainFailure({
        code: "project_unreadable",
        detail: "generated files do not match the manifest; refusing to migrate",
        retryable: false,
        details: { paths: mismatches },
      });
    }

    const projectName = root === "" ? "." : root;
    const actions = [
      `Manifest records ${manifest.specVersion}; the original BotSpec is not stored, so generated files are left unchanged.`,
      `Review ${BOT_SPEC_VERSION} requirements, then re-apply features with aurifex add ${projectName} --feature <feature> --name <name>.`,
      `Scaffold a fresh project with aurifex new when the spec changed structurally.`,
    ];
    const changed = apply
      ? [
          (
            await writeManifest(policy, root, {
              ...manifest,
              specVersion: BOT_SPEC_VERSION,
              generatedAt: now().toISOString(),
            })
          ).path,
        ]
      : [];

    return domainSuccess<UpgradeApplyResult>({
      currentBotApi: target.testedBotApi,
      targetBotApi: BOT_API_VERSION,
      specVersion: BOT_SPEC_VERSION,
      actions,
      changed,
    });
  } catch (error) {
    if (error instanceof PathPolicyError) {
      return domainFailure({ code: error.code, detail: error.message, retryable: false });
    }
    return domainFailure({
      code: "internal_error",
      detail: error instanceof Error ? error.message : "unexpected upgrade failure",
      retryable: false,
    });
  }
}