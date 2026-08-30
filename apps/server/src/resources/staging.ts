/**
 * Staging: how a permitted resource physically reaches the Agent.
 *
 * The Codex runtime only has its own workspace bind-mounted, so an Agent cannot
 * reach another user's files by construction -- which means an unguarded demo
 * would prove nothing. Enforcement therefore happens at the moment a resource
 * is materialised INTO the workspace: on `permit` the file is copied to
 * `<workspace>/inbox/<name>` and the model genuinely reads it; on `deny`
 * nothing is written and the run has nothing to read.
 *
 * CRITICAL: `clearStaging` must run after every run. Without it, a resource
 * staged by a permitted run is still sitting in the workspace on the next run,
 * so the post-revocation attempt would still "work" and the revocation demo
 * would be a lie -- one that passes every unit test and fails on stage.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResourceRef } from "./store.js";

export const STAGING_DIRECTORY = "inbox";

/** Absolute path of the staging directory for a workspace. */
export function stagingRoot(workspacePath: string): string {
  return path.resolve(workspacePath, STAGING_DIRECTORY);
}

/**
 * Writes one permitted resource into the workspace and returns the path the
 * Agent will see it at. Callers must have obtained a `permit` first: this
 * function performs no authorization of its own.
 */
export async function stageResource(
  workspacePath: string,
  ref: ResourceRef,
  content: string,
): Promise<string> {
  const root = stagingRoot(workspacePath);
  const target = path.resolve(root, ref.name);
  if (!target.startsWith(root + path.sep)) {
    throw new Error("Refusing to stage outside the inbox: " + ref.uri);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
  return target;
}

/**
 * Removes everything staged for a workspace. Safe to call when nothing was
 * staged, and safe to call twice -- it is meant to live in a `finally`.
 */
export async function clearStaging(workspacePath: string): Promise<void> {
  await rm(stagingRoot(workspacePath), { recursive: true, force: true });
}
