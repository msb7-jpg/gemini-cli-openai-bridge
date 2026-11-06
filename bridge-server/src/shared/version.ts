/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPackageJson } from "./package.js";

/**
 * Resolves the bridge CLI version from environment or `package.json`.
 * @returns The resolved semantic version string.
 */
export async function getCliVersion(): Promise<string> {
  const pkgJson = await getPackageJson();
  return process.env.CLI_VERSION || pkgJson?.version || "unknown";
}
