/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type SandboxConfig } from "@google/gemini-cli-core";
import commandExists from "command-exists";
import * as os from "node:os";
import { getPackageJson } from "../../shared/package.js";
import { type Settings } from "./settings.js";

interface SandboxCliArgs {
  sandbox?: boolean | string;
  "sandbox-image"?: string;
}

const VALID_SANDBOX_COMMANDS: ReadonlyArray<SandboxConfig["command"]> = [
  "docker",
  "podman",
  "sandbox-exec",
];

function isSandboxCommand(value: string): value is SandboxConfig["command"] {
  return (VALID_SANDBOX_COMMANDS as readonly string[]).includes(value);
}

function getSandboxCommand(sandbox?: boolean | string): SandboxConfig["command"] | "" {
  if (process.env.SANDBOX) {
    return "";
  }

  const environmentConfiguredSandbox = process.env.GEMINI_SANDBOX?.toLowerCase().trim() ?? "";
  let effectiveSandbox =
    environmentConfiguredSandbox.length > 0 ? environmentConfiguredSandbox : sandbox;
  if (effectiveSandbox === "1" || effectiveSandbox === "true") effectiveSandbox = true;
  else if (effectiveSandbox === "0" || effectiveSandbox === "false" || !effectiveSandbox)
    effectiveSandbox = false;

  if (effectiveSandbox === false) {
    return "";
  }

  if (typeof effectiveSandbox === "string" && effectiveSandbox) {
    if (!isSandboxCommand(effectiveSandbox)) {
      console.error(
        `ERROR: invalid sandbox command '${effectiveSandbox}'. Must be one of ${VALID_SANDBOX_COMMANDS.join(
          ", ",
        )}`,
      );
      process.exit(1);
    }
    if (commandExists.sync(effectiveSandbox)) {
      return effectiveSandbox;
    }
    console.error(`ERROR: missing sandbox command '${effectiveSandbox}' (from GEMINI_SANDBOX)`);
    process.exit(1);
  }

  if (os.platform() === "darwin" && commandExists.sync("sandbox-exec")) {
    return "sandbox-exec";
  } else if (commandExists.sync("docker") && effectiveSandbox === true) {
    return "docker";
  } else if (commandExists.sync("podman") && effectiveSandbox === true) {
    return "podman";
  }

  if (effectiveSandbox === true) {
    console.error(
      "ERROR: GEMINI_SANDBOX is true but failed to determine command for sandbox; " +
        "install docker or podman or specify command in GEMINI_SANDBOX",
    );
    process.exit(1);
  }

  return "";
}

/**
 * Resolves the container/seatbelt sandbox configuration from settings and CLI args.
 * @param settings - Merged user and workspace settings.
 * @param argv - Sandbox CLI flags.
 * @returns Resolved `SandboxConfig` or `undefined` when sandboxing is disabled.
 */
export async function loadSandboxConfig(
  settings: Settings,
  argv: SandboxCliArgs,
): Promise<SandboxConfig | undefined> {
  const sandboxOption = argv.sandbox ?? settings.sandbox;
  const command = getSandboxCommand(sandboxOption);

  const packageJson = await getPackageJson();
  const image =
    argv["sandbox-image"] ??
    process.env.GEMINI_SANDBOX_IMAGE ??
    packageJson?.config?.sandboxImageUri;

  return command && image ? { command, image } : undefined;
}
