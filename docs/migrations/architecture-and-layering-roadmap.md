# Architecture Modernization & Vertical Slice Roadmap

This planning document outlines the architectural evolution for `gemini-cli-openai-bridge`:

1. **Current State: File Tree, Line Counts, and Responsibilities**
2. **Vertical Slice Architecture & Core Engine (Decomposing God Files)**
3. **Fallow Strictness Enforcement & Automated Debt Cleanup**
4. **Migration to Zod 4 (`looseObject`, Native JSON Schema & Fastify Integration)**

---

## 1. Current State: File Tree, Line Counts & Responsibilities

The codebase initially comprised **37 TypeScript source files** totaling **~7,026 lines of code** under `bridge-server/src`.

### Core Server & CLI Entrypoints

| File Path | LOC | Current Responsibilities & Architectural Bottlenecks |
| --- | --- | --- |
| `bridge-server/src/index.ts` | 107 | CLI argument dispatcher for daemon commands (`start`, `stop`, `status`, `logs`, `quota`). Fast-path script that parses args and delegates to `daemon.ts`. |
| `bridge-server/src/server.ts` | 338 | Fastify server factory (`createServer`) and standalone server process entrypoint. Loads security policies, initial config, mounts route plugins, binds signals (`SIGINT`, `SIGTERM`), and starts Fastify listener. **Bottleneck**: Couples environment checks, PID management, and route registration. |
| `bridge-server/src/types.ts` | 136 | Central type definitions re-exported from `@google/gemini-cli-core` and bridge-specific interfaces (OpenAI message formats, tools, security policies). **Bottleneck**: Dumping ground for cross-protocol types. |

### Bridge Adapters (Protocol Translation & Streaming)

| File Path | LOC | Current Responsibilities & Architectural Bottlenecks |
| --- | --- | --- |
| `bridge-server/src/bridge/openai.ts` | 266 | **God file**: Handles `/v1/chat/completions` and `/v1/models`. Mixes Fastify route validation, model alias resolution, Gemini client invocation, raw SSE response header setting (`reply.raw`), stream piping, client abort detection, and error mapping. |
| `bridge-server/src/bridge/anthropic.ts` | 396 | **God file**: Handles `/v1/messages`, token counting, and `/v1/models`. Translates Anthropic messages and tool formats to OpenAI/Gemini structures, handles SSE events, manages client abort, and responds to model catalog requests. |
| `bridge-server/src/bridge/responses-api.ts` | 282 | Handles OpenAI Codex `/v1/responses` endpoint. Translates instructions, messages, and tools into OpenAI chat completions format, manages SSE streaming via `reply.raw`. |
| `bridge-server/src/bridge/stream-transformer.ts` | 191 | SSE stream transformer that translates Gemini chunk streams into OpenAI-compatible `chat.completion.chunk` Server-Sent Events. |
| `bridge-server/src/bridge/anthropic-stream-transformer.ts` | 211 | SSE stream transformer that translates Gemini chunk streams into Anthropic-compatible SSE events (`message_start`, `content_block_start`, `content_block_delta`, `message_stop`). **Bottleneck**: Duplicates SSE framing and lifecycle logic with `stream-transformer.ts`. |
| `bridge-server/src/bridge/anthropic-types.ts` | 65 | Type definitions for Anthropic API requests, messages, content blocks, tool use, and usage blocks. |
| `bridge-server/src/bridge/index.ts` | 11 | Export barrel for route plugins (`registerOpenAIRoutes`, `registerAnthropicRoutes`, `registerResponsesApiRoutes`). |

### Gemini Core Client

| File Path | LOC | Current Responsibilities & Architectural Bottlenecks |
| --- | --- | --- |
| `bridge-server/src/gemini-client.ts` | 747 | **Largest God file (747 LOC)**: Manages gRPC/REST communication with Gemini via `gemini-cli-core`. Responsible for message normalization, tool schema sanitization, thought signature stripping and injection, system prompt synthesis, tool call fallback synthesis, and stream dispatch. **Bottleneck**: Combines network transport, protocol translation, disk cache interaction, and error transformations. |

### Configuration & Settings

| File Path | LOC | Current Responsibilities & Architectural Bottlenecks |
| --- | --- | --- |
| `bridge-server/src/config/config.ts` | 190 | Instantiates and initializes `Config` object from `gemini-cli-core`. Binds tool registries, prompt managers, auth providers, and telemetry settings. |
| `bridge-server/src/config/settings.ts` | 228 | Disk I/O for reading and writing user and project `.gemini/settings.json` configuration files with schema defaults. |
| `bridge-server/src/config/extension.ts` | 107 | Scans workspace directories for Gemini CLI extensions and tool configurations. |
| `bridge-server/src/config/sandboxConfig.ts` | 99 | Defines security sandboxing restrictions (allowed directories, blocked commands) based on security modes (`read-only`, `edit`, `yolo`). |

### Services & Quota Management

| File Path | LOC | Current Responsibilities & Architectural Bottlenecks |
| --- | --- | --- |
| `bridge-server/src/services/quota-tracker.ts` | 327 | In-memory token counter and request tracker. Aggregates per-model request counts, input/output/cached tokens, tracks daily usage windows, and computes local quota snapshots. |
| `bridge-server/src/services/remote-quota-client.ts` | 258 | Fetches remote model rate limits and quota buckets from upstream Google services using OAuth tokens. Parses quota reset deadlines and tiers. |

### Schemas (Zod Validation)

| File Path | LOC | Current Responsibilities & Architectural Bottlenecks |
| --- | --- | --- |
| `bridge-server/src/schemas/openai.ts` | 110 | Zod schema definitions for OpenAI Chat Completions requests, tools, message parts, and parameters with `.passthrough()`. |
| `bridge-server/src/schemas/anthropic.ts` | 119 | Zod schema definitions for Anthropic Messages requests, multimodal parts, thinking blocks, and tool definitions with `.passthrough()`. |
| `bridge-server/src/schemas/quota.ts` | 92 | Zod schema definitions for quota snapshots, token usage metrics, model cards, and `/v1/models` catalog responses. |
| `bridge-server/src/schemas/index.ts` | 9 | Export barrel for all Zod schemas and inferred TypeScript types. |

### Utilities & Daemon

| File Path | LOC | Current Responsibilities & Architectural Bottlenecks |
| --- | --- | --- |
| `bridge-server/src/utils/daemon.ts` | 659 | **God file**: Daemon lifecycle manager. Handles background process spawning via `child_process.spawn`, PID file management, startup health check polling (45s), process cleanup (`SIGTERM`/`SIGKILL`), terminal log tailing, and ANSI terminal rendering for the `quota` dashboard. **Bottleneck**: Mixes process control, file I/O, network health polling, and rich CLI terminal UI. |
| `bridge-server/src/utils/thought-signature-cache.ts` | 232 | In-memory LRU cache with atomic disk persistence for Gemini thought signatures to preserve reasoning context across turns. |
| `bridge-server/src/utils/model-resolver.ts` | 195 | Maps incoming model strings (Anthropic, OpenAI, custom aliases) to actual Gemini model identifiers. Manages model fallback defaults. |
| `bridge-server/src/utils/error-mapper.ts` | 63 | Maps Gemini/Google API errors into standard OpenAI error structures (HTTP status, error codes, messages). |
| `bridge-server/src/utils/package.ts` | 49 | Iterative parent directory traversal utility to locate and parse `package.json` without external dependencies. |
| `bridge-server/src/utils/logger.ts` | 33 | Colored console logger wrapper (`[BRIDGE-SERVER]`) supporting debug, info, warn, and error levels. |
| `bridge-server/src/utils/version.ts` | 12 | Resolves the bridge version from `package.json`. |

### Test Suites (Co-located in `__tests__/`)

| File Path | LOC | Target Tested |
| --- | --- | --- |
| `bridge-server/src/__tests__/server.test.ts` | 94 | `server.ts` (Fastify integration, probes, health, quota, schema validation 400s) |
| `bridge-server/src/__tests__/gemini-client.test.ts` | 361 | `gemini-client.ts` (Message conversion, tool translation, fallback synthesis) |
| `bridge-server/src/schemas/__tests__/schemas.test.ts` | 363 | `schemas/*.ts` (Zod validation for OpenAI, Anthropic, Quota payloads) |
| `bridge-server/src/bridge/__tests__/anthropic.test.ts` | 151 | `bridge/anthropic.ts` (Model resolver, message conversion, tool mapping) |
| `bridge-server/src/services/__tests__/quota-tracker.test.ts` | 80 | `services/quota-tracker.ts` (Quota tracking and token accumulation) |
| `bridge-server/src/utils/__tests__/daemon.test.ts` | 143 | `utils/daemon.ts` (PID read/write, process check, healthcheck, uptime format) |
| `bridge-server/src/utils/__tests__/thought-signature-cache.test.ts` | 233 | `utils/thought-signature-cache.ts` (LRU eviction, disk persistence, corruption handling) |
| `bridge-server/src/utils/__tests__/model-resolver.test.ts` | 52 | `utils/model-resolver.ts` (Model routing and alias matching) |
| `bridge-server/src/utils/__tests__/package.test.ts` | 17 | `utils/package.ts` (Recursive directory package finding) |

---

## 2. Vertical Slice Architecture & Core Engine (Decomposing God Files)

### Why Vertical Slices Over Horizontal Layers?

`gemini-cli-openai-bridge` is fundamentally a **multi-protocol translation proxy and CLI daemon**—not an enterprise CRUD app with complex domain entities.

* **Horizontal Layering Flaw**: Splitting into `presentation/`, `application/`, `domain/`, and `infrastructure/` forces developers to jump across 4 directories to trace how an Anthropic `/v1/messages` request becomes a Gemini stream, creating boilerplate interfaces (`IChatUseCase`, `IGeminiPort`) that add indirection without value.
* **Vertical Slice Solution (Feature-Driven + Core Engine)**: Group code by **Protocol / Feature Slice** (`features/openai-chat`, `features/anthropic-messages`, `features/openai-responses`, `features/models-and-quota`, `features/daemon-cli`). Each slice encapsulates its own Fastify route, Zod schema, request/response mapper, and SSE chunk encoder. They all communicate with a unified, protocol-agnostic **Gemini Core Engine** (`core/gemini/`) via a single **Canonical Intermediate Representation (IR)**, eliminating the anti-pattern where `anthropic.ts` or `responses-api.ts` translates to OpenAI format first just to be re-translated into Gemini format.

### Target Directory Tree (Vertical Slice + Core Engine)

```text
bridge-server/src/
├── index.ts                              # CLI fast-path dispatcher
├── server.ts                             # Pure Fastify factory & plugin registration (< 120 LOC)
│
├── features/                             # VERTICAL SLICES (Self-contained protocol adapters)
│   ├── openai-chat/                      # Slice: /v1/chat/completions
│   │   ├── openai.routes.ts              # Fastify route binding & lifecycle orchestration
│   │   ├── openai.schema.ts              # Zod 4 schemas (looseObject)
│   │   ├── openai.mapper.ts              # OpenAI <-> Canonical Gemini IR translation
│   │   ├── openai.sse-encoder.ts         # Stateful encoder for OpenAI chunks
│   │   └── __tests__/
│   │
│   ├── anthropic-messages/               # Slice: /v1/messages & /v1/messages/count_tokens
│   │   ├── anthropic.routes.ts           # Fastify route binding
│   │   ├── anthropic.schema.ts           # Zod 4 schemas + content blocks
│   │   ├── anthropic.mapper.ts           # Direct Anthropic <-> Canonical Gemini IR (no OpenAI middleman)
│   │   ├── anthropic.sse-encoder.ts      # Stateful encoder (message_start -> content_block_delta -> stop)
│   │   └── __tests__/
│   │
│   ├── openai-responses/                 # Slice: /v1/responses (Codex / Responses API)
│   │   ├── responses.routes.ts
│   │   ├── responses.schema.ts
│   │   ├── responses.mapper.ts
│   │   ├── responses.sse-encoder.ts
│   │   └── __tests__/
│   │
│   ├── models-and-quota/                 # Slice: /v1/models, /quota, token tracking
│   │   ├── quota.routes.ts
│   │   ├── quota.schema.ts
│   │   ├── quota-tracker.service.ts      # Local in-memory token accumulator
│   │   ├── remote-quota.client.ts        # Upstream Google OAuth quota fetcher
│   │   ├── model-resolver.ts             # Alias & fallback routing
│   │   └── __tests__/
│   │
│   └── daemon-cli/                       # Slice: Background daemon & CLI UI
│       ├── process-manager.ts            # Spawning, PID lifecycle, SIGTERM/SIGKILL cleanup
│       ├── health-poller.ts              # 45s startup probe polling & spinner
│       ├── log-tailer.ts                 # Stream follower for daemon logs
│       ├── quota-dashboard.view.ts       # Pure ANSI terminal rendering
│       ├── server-bootstrap.ts           # CLI yargs parser & foreground server bootstrapper
│       └── __tests__/
│
├── core/                                 # SHARED KERNEL & GEMINI ENGINE (Protocol-Agnostic)
│   ├── gemini/                           # Decomposed from 747-LOC gemini-client.ts
│   │   ├── gemini-transport.ts           # Pure @google/gemini-cli-core gRPC/REST invocation (< 200 LOC)
│   │   ├── canonical-ir.types.ts         # Unified internal turn/message/tool-call representation
│   │   ├── message-normalizer.ts         # Turn merging, tool ordering & system instruction builder
│   │   ├── schema-sanitizer.ts           # Strips unsupported JSON Schema keywords for Gemini API
│   │   ├── thought-signature.manager.ts  # Thought stripping, injection & LRU disk cache
│   │   ├── tool-fallback.synthesizer.ts  # Synthesizes structured tool calls/responses for parity
│   │   └── __tests__/
│   │
│   ├── sse/                              # Unified Streaming Engine
│   │   └── sse-pipeline.ts               # Handles reply.raw headers, keep-alive, & client disconnect
│   │
│   ├── config/                           # gemini-cli-core Config, sandboxConfig, settings, extensions
│   └── errors/
│       └── error-mapper.ts               # Maps Google/Gemini/Zod errors to protocol-specific HTTP payloads
│
└── shared/                               # Low-level stateless utilities (logger, package, version)
```

---

## 3. Fallow Strictness Enforcement & Automated Debt Cleanup

| Phase | Target Rules in `.fallowrc.json` | Execution Strategy & Fallow CLI Commands |
| --- | --- | --- |
| **Phase A: Graph Hygiene & Dead Members** | `"circular-dependencies": "error"`<br>`"unused-class-members": "error"`<br>`"duplicate-exports": "error"` | Run `npx fallow check --format json --quiet`. Moving to Vertical Slices breaks circular imports because slices only import downward from `core/` and `shared/`. |
| **Phase B: Automated Export & Type Pruning** | `"unused-exports": "error"`<br>`"unused-types": "error"`<br>`"unused-dev-dependencies": "error"` | Eliminate barrel files (`bridge/index.ts`, `schemas/index.ts`) and break apart `src/types.ts` into slice-local types. |
| **Phase C: Clone Eradication (SSE & Mappers)** | `"duplicates": { "enabled": true, "mode": "semantic" }` | Unify SSE streaming via `core/sse/sse-pipeline.ts` and configure sensible duplication thresholds. |
| **Phase D: Complexity & CRAP Score Locks** | `"complexity-cyclomatic": "error"`<br>`"complexity-cognitive": "error"`<br>`"complexity-crap": "error"`<br>`"complexity-file-lines": "error"` | Enforced with practical health thresholds once `gemini-client.ts` and `daemon.ts` are decomposed. |

---

## 4. Migration to Zod 4

1. **Replace `.passthrough()` and `.strict()` with `z.looseObject()` / `z.strictObject()`**:
   Ensure top-level and nested schemas that accept coding-agent vendor extensions are declared with `z.looseObject()`.
2. **Fix `z.record()` Arity Changes**:
   Update all single-argument `z.record(valueSchema)` calls to `z.record(z.string(), valueSchema)`.
3. **Upgrade `fastify-type-provider-zod`**:
   Upgrade to `zod@^4.0.0` and `fastify-type-provider-zod@^5.0.0` for native Zod 4 integration.
