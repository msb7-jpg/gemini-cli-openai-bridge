/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { getPackageJson } from "../package.js";

describe("package utils", () => {
  it("reads package.json traversing upward natively", async () => {
    const pkg = await getPackageJson();
    expect(pkg).toBeDefined();
    expect(pkg?.name).toBe("@migueldsbatista/gemini-cli-openai-bridge");
    expect(pkg?.version).toBeDefined();
  });
});
