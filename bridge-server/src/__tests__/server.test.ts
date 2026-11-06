import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { type FastifyInstance } from "fastify";
import { type Config } from "@google/gemini-cli-core";
import { createServer } from "../server.js";

describe("Fastify Server Integration Tests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const mockConfig = {
      getModel: () => "gemini-2.5-flash",
      getContentGeneratorConfig: async () => ({ authType: "LOGIN_WITH_GOOGLE" }),
    };

    app = await createServer(mockConfig as unknown as Config, false, "1.0.0-test");
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns 200 with status ok and version", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toEqual({
      status: "ok",
      version: "1.0.0-test",
    });
  });

  it("ALL /api/hello returns 200 OK", async () => {
    const resGet = await app.inject({
      method: "GET",
      url: "/api/hello",
    });
    expect(resGet.statusCode).toBe(200);
    expect(resGet.payload).toBe("OK");

    const resPost = await app.inject({
      method: "POST",
      url: "/api/hello",
    });
    expect(resPost.statusCode).toBe(200);
    expect(resPost.payload).toBe("OK");
  });

  it("GET /v1/quota and aliases return 200 with quota snapshot", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/quota",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("requests");
    expect(body).toHaveProperty("tokens");
  });

  it("GET /v1/models returns 200 with model list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("POST /v1/chat/completions rejects invalid schema with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        invalid_field: "invalid",
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body).toBeDefined();
  });

  it("POST /v1/messages rejects invalid schema with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        invalid: 123,
      },
    });

    expect(res.statusCode).toBe(400);
  });
});
