/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PackageJson = {
  name?: string;
  version?: string;
  description?: string;
  [key: string]: unknown;
  config?: {
    sandboxImageUri?: string;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let packageJson: PackageJson | undefined;

/**
 * Traverses upward from the current module directory to locate and parse `package.json`.
 * @returns The parsed `PackageJson` object if found, or `undefined`.
 */
export async function getPackageJson(): Promise<PackageJson | undefined> {
  if (packageJson) {
    return packageJson;
  }

  let currentDir = __dirname;
  while (true) {
    const candidate = path.join(currentDir, "package.json");
    try {
      const content = await fs.readFile(candidate, "utf-8");
      packageJson = JSON.parse(content) as PackageJson;
      return packageJson;
    } catch {
      // Not found or error reading/parsing, try parent directory
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return undefined;
}
