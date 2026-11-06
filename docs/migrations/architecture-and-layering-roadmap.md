# Architecture Modernization & Clean Layering Roadmap

This planning document outlines future architectural work for `gemini-cli-openai-bridge`:
1. **Current State: File Tree, Line Counts, and Responsibilities**
2. **Clean Architecture & Domain Layering (Decomposing God Files)**
3. **Fallow Strictness Enforcement (Debt Cleanup)**
4. **Migration to Zod 4**

---

## 1. Current State: File Tree, Line Counts & Responsibilities

The codebase currently comprises **37 TypeScript source files** totaling **~7,026 lines of code** under `bridge-server/src`.

Below is the complete file inventory grouped by functional domain, showing their exact line counts and current responsibilities:

### Core Server & CLI Entrypoints

| File Path | LOC | Current Responsibilities & Problems |
|---|---|---|
| `bridge-server/src/index.ts` | 107 | CLI argument dispatcher for daemon commands (`start`, `stop`, `status`, `logs`, `quota`). Fast-path script that parses args and delegates to `daemon.ts`. |
| `bridge-server/src/server.ts` | 338 | Fastify server factory (`createServer`) and standalone server process entrypoint. Loads security policies, initial config, mounts route plugins, binds signals (`SIGINT`, `SIGTERM`), and starts Fastify listener. Currently couples environment checks, PID management, and route registration. |
| `bridge-server/src/types.ts` | 136 | Central type definitions re-exported from `@google/gemini-cli-core` and bridge-specific interfaces (OpenAI message formats, tools, security policies). |

### Bridge Adapters (Protocol Translation & Streaming)

| File Path | LOC | Current Responsibilities & Problems |
|---|---|---|
| `bridge-server/src/bridge/openai.ts` | 266 | **God file**: Handles `/v1/chat/completions` and `/v1/models`. Mixes Fastify route validation, model alias resolution, Gemini client invocation, raw SSE response header setting (`reply.raw`), stream piping, client abort detection, and error mapping. |
| `bridge-server/src/bridge/anthropic.ts` | 396 | **God file**: Handles `/v1/messages`, token counting, and `/v1/models`. Translates Anthropic messages and tool formats to OpenAI/Gemini structures, handles SSE events, manages client abort, and responds to model catalog requests. |
| `bridge-server/src/bridge/responses-api.ts` | 282 | Handles OpenAI Codex `/v1/responses` endpoint. Translates instructions, messages, and tools into OpenAI chat completions format, manages SSE streaming via `reply.raw`. |
| `bridge-server/src/bridge/stream-transformer.ts` | 191 | SSE stream transformer that translates Gemini chunk streams into OpenAI-compatible `chat.completion.chunk` Server-Sent Events. |
| `bridge-server/src/bridge/anthropic-stream-transformer.ts` | 211 | SSE stream transformer that translates Gemini chunk streams into Anthropic-compatible SSE events (`message_start`, `content_block_start`, `content_block_delta`, `message_stop`). Duplicates formatting logic with `stream-transformer.ts`. |
| `bridge-server/src/bridge/anthropic-types.ts` | 65 | Type definitions for Anthropic API requests, messages, content blocks, tool use, and usage blocks. |
| `bridge-server/src/bridge/index.ts` | 11 | Export barrel for route plugins (`registerOpenAIRoutes`, `registerAnthropicRoutes`, `registerResponsesApiRoutes`). |

### Gemini Core Client

| File Path | LOC | Current Responsibilities & Problems |
|---|---|---|
| `bridge-server/src/gemini-client.ts` | 747 | **Largest God file (748 LOC)**: Manages gRPC/REST communication with Gemini via `gemini-cli-core`. Responsible for message normalization, tool schema sanitization, thought signature stripping and injection, system prompt synthesis, tool call fallback synthesis, and stream dispatch. Combines network transport, protocol translation, disk cache interaction, and error transformations. |

### Configuration & Settings

| File Path | LOC | Current Responsibilities & Problems |
|---|---|---|
| `bridge-server/src/config/config.ts` | 190 | Instantiates and initializes `Config` object from `gemini-cli-core`. Binds tool registries, prompt managers, auth providers, and telemetry settings. |
| `bridge-server/src/config/settings.ts` | 228 | Disk I/O for reading and writing user and project `.gemini/settings.json` configuration files with schema defaults. |
| `bridge-server/src/config/extension.ts` | 107 | Scans workspace directories for Gemini CLI extensions and tool configurations. |
| `bridge-server/src/config/sandboxConfig.ts` | 99 | Defines security sandboxing restrictions (allowed directories, blocked commands) based on security modes (`read-only`, `edit`, `yolo`). |

### Services & Quota Management

| File Path | LOC | Current Responsibilities & Problems |
|---|---|---|
| `bridge-server/src/services/quota-tracker.ts` | 327 | In-memory token counter and request tracker. Aggregates per-model request counts, input/output/cached tokens, tracks daily usage windows, and computes local quota snapshots. |
| `bridge-server/src/services/remote-quota-client.ts` | 258 | Fetches remote model rate limits and quota buckets from upstream Google services using OAuth tokens. Parses quota reset deadlines and tiers. |

### Schemas (Zod Validation)

| File Path | LOC | Current Responsibilities & Problems |
|---|---|---|
| `bridge-server/src/schemas/openai.ts` | 110 | Zod schema definitions for OpenAI Chat Completions requests, tools, message parts, and parameters with `.passthrough()`. |
| `bridge-server/src/schemas/anthropic.ts` | 119 | Zod schema definitions for Anthropic Messages requests, multimodal parts, thinking blocks, and tool definitions with `.passthrough()`. |
| `bridge-server/src/schemas/quota.ts` | 92 | Zod schema definitions for quota snapshots, token usage metrics, model cards, and `/v1/models` catalog responses. |
| `bridge-server/src/schemas/index.ts` | 9 | Export barrel for all Zod schemas and inferred TypeScript types. |

### Utilities & Daemon

| File Path | LOC | Current Responsibilities & Problems |
|---|---|---|
| `bridge-server/src/utils/daemon.ts` | 659 | **God file**: Daemon lifecycle manager. Handles background process spawning via `child_process.fork`, PID file management, startup health check polling (45s), process cleanup (`SIGTERM`/`SIGKILL`), terminal log tailing, and ANSI terminal rendering for the `quota` dashboard. Mixes process control, file I/O, network health polling, and rich CLI terminal UI. |
| `bridge-server/src/utils/thought-signature-cache.ts` | 232 | In-memory LRU cache with atomic disk persistence for Gemini thought signatures to preserve reasoning context across turns. |
| `bridge-server/src/utils/model-resolver.ts` | 195 | Maps incoming model strings (Anthropic, OpenAI, custom aliases) to actual Gemini model identifiers. Manages model fallback defaults. |
| `bridge-server/src/utils/error-mapper.ts` | 63 | Maps Gemini/Google API errors into standard OpenAI error structures (HTTP status, error codes, messages). |
| `bridge-server/src/utils/package.ts` | 49 | Iterative parent directory traversal utility to locate and parse `package.json` without external dependencies. |
| `bridge-server/src/utils/logger.ts` | 33 | Colored console logger wrapper (`[BRIDGE-SERVER]`) supporting debug, info, warn, and error levels. |
| `bridge-server/src/utils/version.ts` | 12 | Resolves the bridge version from `package.json`. |

### Test Suites (Co-located in `__tests__/`)

| File Path | LOC | Target Tested |
|---|---|---|
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

## 2. Clean Layering & God File Decomposition

### Problem Statement
Currently, files like `gemini-client.ts` (747 LOC), `daemon.ts` (659 LOC), `anthropic.ts` (396 LOC), `server.ts` (338 LOC), and `openai.ts` (266 LOC) violate Single Responsibility Principle:
- **Presentation mixed with Business**: Fastify route definitions directly manipulate raw sockets (`reply.raw`) and perform payload transformations.
- **Transport mixed with Domain**: `gemini-client.ts` couples gRPC/REST network calls with message schema transformation and thought cache disk persistence.
- **Process Management mixed with UI**: `daemon.ts` mixes child process spawning and signal handling with ANSI console dashboard rendering.

### Target Architecture Layers

```
bridge-server/src/
├── presentation/          # Transport & Protocol Adapters (HTTP / Fastify / CLI)
│   ├── routes/            # Route controllers only (< 80 LOC each: validate -> call use-case -> reply)
│   │   ├── openai.routes.ts
│   │   ├── anthropic.routes.ts
│   │   ├── responses.routes.ts
│   │   └── quota.routes.ts
│   ├── sse/               # SSE streaming engine (socket writes, chunk encoders, abort listeners)
│   │   ├── sse-streamer.ts
│   │   ├── openai-chunk-encoder.ts
│   │   └── anthropic-chunk-encoder.ts
│   └── cli/               # CLI views (ANSI dashboard rendering decoupled from process management)
│       └── quota-dashboard-view.ts
│
├── application/           # Business Use Cases & Orchestration
│   ├── use-cases/
│   │   ├── create-chat-completion.ts
│   │   ├── stream-chat-completion.ts
│   │   ├── create-anthropic-message.ts
│   │   ├── stream-anthropic-message.ts
│   │   └── query-quota-metrics.ts
│   └── mappers/           # Protocol format translation
│       ├── openai-to-gemini.mapper.ts
│       ├── anthropic-to-gemini.mapper.ts
│       └── gemini-to-openai.mapper.ts
│
├── domain/                # Pure Business Rules, Entities & Validation
│   ├── models/            # Core entities (Message, ToolCall, ModelCatalog, QuotaSnapshot)
│   ├── schemas/           # Zod runtime schemas (OpenAI, Anthropic, Quota)
│   ├── services/          # Pure domain services (ModelResolver, TokenAccumulator)
│   └── ports/             # Interfaces for external dependencies (IGeminiClient, IQuotaStore, ICache)
│
└── infrastructure/        # External Systems, Disk, Network
    ├── gemini/            # Raw Gemini API / gemini-cli-core client wrapper
    ├── cache/             # Disk-backed thought signature cache
    ├── daemon/            # Pure process lifecycle (spawning, PID tracking, signal handling)
    ├── storage/           # Settings files and package.json reader
    └── quota/             # Remote Google OAuth quota client
```

### Deconstruction Steps
1. **Extract SSE Streaming Engine**: Move `reply.raw` writes, headers, flush calls, and abort listeners out of `openai.ts`, `anthropic.ts`, and `responses-api.ts` into a unified `presentation/sse/sse-streamer.ts`.
2. **Decompose `gemini-client.ts`**:
   - Extract message translation (`convertOpenAIMessagesToGemini`, `convertOpenAIToolsToGemini`) into `application/mappers/`.
   - Extract schema sanitization into `domain/services/schema-sanitizer.ts`.
   - Keep `gemini-client.ts` purely as the network client adapter implementing an `IGeminiClient` port.
3. **Decompose `daemon.ts`**:
   - Separate process management (`startDaemon`, `stopDaemon`, `checkBridgeHealth`) from the terminal UI (`renderQuotaDashboard`).
4. **De-duplicate Stream Transformers**:
   - Merge common SSE formatting logic between `stream-transformer.ts` and `anthropic-stream-transformer.ts`.

---

## 3. Fallow Strictness Enforcement (Huge TODO)

### Current State
In `.fallowrc.json`, several critical fallow checks are temporarily set to `"off"` or have raised thresholds to enable immediate bootstrapping without blocking CI on legacy code:
- `"unused-exports": "off"`
- `"unused-types": "off"`
- `"unused-dev-dependencies": "off"`
- `"unused-class-members": "off"`
- `"duplicate-exports": "off"`
- `"circular-dependencies": "off"`
- `"duplicates.enabled": false`
- `"complexity-cyclomatic": "off"`
- `"complexity-cognitive": "off"`
- `"complexity-crap": "off"`
- `"complexity-file-lines": "off"`

### Target Plan
- **Phase A**: Turn on `"circular-dependencies": "error"` and `"unused-class-members": "error"`.
- **Phase B**: Turn on `"unused-exports": "error"` and `"unused-types": "error"`, pruning orphaned types in `types.ts`.
- **Phase C**: Enable `"duplicates": { "enabled": true }`, eliminating the 8 duplicate clone groups identified by fallow in SSE transformers.
- **Phase D**: Enable complexity rules (`complexity-cyclomatic: "error"`, `complexity-cognitive: "error"`) once god files are decomposed into clean layers.

---

## 4. Migration to Zod 4

### Objectives
- Upgrade from Zod 3.x to Zod 4 once stable.
- Benefit from Zod 4's high-performance parsing engine (significantly reduced allocations and faster validation on high-frequency streaming completions).
- Retain `.passthrough()` behavior on all request schemas to preserve client metadata from coding agents (OpenCode, Claude Code, Roo Code, Aider).
- Update Fastify type provider integration accordingly.
