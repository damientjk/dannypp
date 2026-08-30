/**
 * Outbound secret redaction.
 *
 * The inbound credential path is already safe: `container-codex-runner.ts`
 * passes `--env ARK_API_KEY` by NAME so the value never reaches argv or `ps`,
 * and `codex-runner.ts` puts it in the child env. The gap is outbound -- there
 * is nothing stopping the model from echoing the key into its own output, which
 * we then persist to `launchpad.json` and render in the browser.
 *
 * `workspace.ts` writes "Never print environment variables or credentials" into
 * AGENTS.md, but that is a polite request to an LLM, not a control. This is the
 * control.
 *
 * Deliverable 9 forbids a secret in source, history, logs, traces, screenshots
 * OR demo output. Run output is demo output.
 */

export const REDACTION_PLACEHOLDER = "***REDACTED***";

/**
 * Below this length a "secret" is too short to redact safely -- blanking a
 * 3-character value would corrupt ordinary prose and, worse, an empty or
 * unset key would match everywhere and destroy every message.
 */
const MIN_REDACTABLE_LENGTH = 8;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns the secrets worth redacting, longest first so overlaps resolve safely. */
export function redactableSecrets(candidates: readonly (string | undefined)[]): string[] {
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && value.length >= MIN_REDACTABLE_LENGTH) unique.add(value);
  }
  return [...unique].sort((left, right) => right.length - left.length);
}

/** Replaces every occurrence of every secret. Safe on any input, including null. */
export function redact<T extends string | null | undefined>(
  text: T,
  secrets: readonly (string | undefined)[],
): T {
  if (typeof text !== "string" || text.length === 0) return text;
  let output: string = text;
  for (const secret of redactableSecrets(secrets)) {
    output = output.replace(
      new RegExp(escapeRegExp(secret), "g"),
      REDACTION_PLACEHOLDER,
    );
  }
  return output as T;
}

/**
 * The secrets this process holds. Kept as a function of the config so there is
 * one list to extend when a new credential is introduced.
 */
export function processSecrets(config: {
  arkApiKey?: string;
  authToken?: string;
}): string[] {
  return redactableSecrets([config.arkApiKey, config.authToken]);
}
