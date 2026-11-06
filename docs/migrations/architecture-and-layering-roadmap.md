# Architecture Modernization & Clean Layering Roadmap

This planning document outlines future architectural work for `gemini-cli-openai-bridge`:
1. **Fallow Strictness Enforcement (Debt Cleanup)**
2. **Migration to Zod 4**
3. **Clean Architecture & Domain Layering (Decomposing God Files)**

---

## 1. Fallow Strictness & Debt Cleanup (HUGE TODO)

### Current State
In `.fallowrc.json`, several critical fallow rules were deliberately set to `"off"` or thresholds raised to enable immediate bootstrapping without blocking CI on legacy code:
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
- Progressively turn these rules back from `"off"` to `"warn"` and finally `"error"`.
- Eliminate duplicate SSE transform logic between `anthropic-stream-transformer.ts` and `stream-transformer.ts`.
- Prune unused exported utility types and orphaned interfaces across `bridge-server/src/types.ts`.
- Enable circular dependency detection and ensure unidirectional import flows.

---

## 2. Migration to Zod 4

### Objectives
- Upgrade from Zod 3.x to Zod 4 once released / stabilized.
- Leverage Zod 4's high-performance parsing engine (significantly lower memory allocations and faster schema validation).
- Update `fastify-type-provider-zod` or direct Fastify compiler integration for Zod 4.
- Retain the `.passthrough()` behavior so AI coding agents (OpenCode, Claude Code, Roo Code, Aider) do not get broken by non-standard metadata fields.

### Migration Steps
1. Verify `fastify-type-provider-zod` compatibility with Zod 4 (or use native Fastify schema compilers).
2. Audit schema definitions in `bridge-server/src/schemas/`:
   - `openai.ts`
   - `anthropic.ts`
   - `quota.ts`
3. Update inferred TypeScript types (`z.infer<...>`).
4. Run integration tests in `bridge-server/src/schemas/__tests__/` and `src/__tests__/server.test.ts`.

---

## 3. Clean Layering & God File Decomposition

### Problem Statement
Currently, files like `bridge-server/src/bridge/openai.ts`, `anthropic.ts`, and `gemini-client.ts` act as "god files" combining:
- Fastify route registration & HTTP handling
- Direct socket manipulation & raw SSE protocol serialization
- Business logic (model routing, prompt adaptation, fallback synthesis)
- Disk I/O (thought signature cache, file persistence)
- Remote Google API authentication & gRPC/REST transport

### Target Architecture Layers

```
bridge-server/src/
├── presentation/          # Transport & Protocol Adapters (HTTP / Fastify)
│   ├── routes/            # Route controllers only (request -> useCase -> reply)
│   │   ├── openai.routes.ts
│   │   ├── anthropic.routes.ts
│   │   ├── responses.routes.ts
│   │   └── quota.routes.ts
│   └── sse/               # Generic SSE event streaming adapters & socket flushers
│       ├── sse-streamer.ts
│       └── sse-chunk-encoders.ts
│
├── application/           # Business Use Cases & Orchestration
│   ├── use-cases/
│   │   ├── generate-chat-completion.ts
│   │   ├── stream-chat-completion.ts
│   │   ├── generate-anthropic-message.ts
│   │   └── track-quota-usage.ts
│   └── mappers/           # Format conversion (OpenAI <-> Gemini, Anthropic <-> Gemini)
│       ├── openai-gemini.mapper.ts
│       └── anthropic-gemini.mapper.ts
│
├── domain/                # Pure Business Rules, Entities & Schemas
│   ├── models/            # Domain entities (Message, ToolCall, ModelCatalog)
│   ├── schemas/           # Zod runtime schemas
│   └── ports/             # Interfaces for infrastructure (IGeminiClient, IQuotaStore, ICache)
│
└── infrastructure/        # External Systems, Disk, Network
    ├── gemini/            # Raw Gemini API communication & token conversion
    ├── cache/             # Disk-backed thought signature cache
    ├── storage/           # PID file, logs, settings
    └── quota/             # Quota trackers & remote quota sync
```

### Deconstruction Plan
1. **Extract SSE Streaming Layer**: Decouple `reply.raw` writes and abort signal listeners from route controllers into a reusable `SseStreamer`.
2. **Decompose `gemini-client.ts`**:
   - Move message converters (`convertOpenAIMessagesToGemini`, `convertOpenAIToolsToGemini`) to `application/mappers/`.
   - Separate prompt adaptation from the gRPC/REST transport client.
3. **Decompose `bridge/openai.ts` & `bridge/anthropic.ts`**:
   - Keep route files under 80 lines: pure request validation and forwarding to application services.
   - Extract model resolution and alias mapping into dedicated domain resolvers.
4. **Isolate Disk I/O**:
   - Ensure no route handlers perform direct synchronous `fs` operations.
