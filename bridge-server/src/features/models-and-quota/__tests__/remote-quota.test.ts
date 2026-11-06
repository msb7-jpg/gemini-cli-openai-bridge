/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { RemoteQuotaClient } from "../remote-quota.client.js";

describe("RemoteQuotaClient resolveProjectId", () => {
  const client = new RemoteQuotaClient();

  it("resolves project ID from GOOGLE_CLOUD_PROJECT", () => {
    const result = client.resolveProjectId({
      GOOGLE_CLOUD_PROJECT: "my-gcp-project",
    });
    expect(result).toBe("my-gcp-project");
  });

  it("resolves project ID from GOOGLE_CLOUD_PROJECT_ID", () => {
    const result = client.resolveProjectId({
      GOOGLE_CLOUD_PROJECT_ID: "alt-gcp-project",
    });
    expect(result).toBe("alt-gcp-project");
  });

  it("resolves project ID from GEMINI_PROJECT_ID", () => {
    const result = client.resolveProjectId({
      GEMINI_PROJECT_ID: "gemini-scoped-project",
    });
    expect(result).toBe("gemini-scoped-project");
  });

  it("resolves project ID from DEFAULT_GOOGLE_CLOUD_PROJECT", () => {
    const result = client.resolveProjectId({
      DEFAULT_GOOGLE_CLOUD_PROJECT: "default-custom-project",
    });
    expect(result).toBe("default-custom-project");
  });

  it("returns undefined without hardcoded shell or corporate defaults", () => {
    const result = client.resolveProjectId({});
    expect(result).toBeUndefined();
  });
});
