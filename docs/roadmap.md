# Gemini CLI OpenAI Bridge — Product & Architectural Roadmap

This document outlines the strategic roadmap and future architecture for `@migueldsbatista/gemini-cli-openai-bridge`. Following the successful migration to Fastify 5, Zod 4, and Vertical Slice Architecture (v0.5.x), this roadmap focuses on user experience, token efficiency, intelligent model routing, and protocol completeness.

---

## 🎯 Vision

To make `gemini-cli-openai-bridge` the fastest, most reliable, and most token-efficient local gateway to Google Gemini models for **any** AI harness—including **OpenCode**, **Claude Code**, **OpenAI Codex**, **Cursor**, **Aider**, **Zed**, **Roo Code**, and **Continue**—with zero vendor lock-in.

---

## 🌟 Milestone 1: Intelligent `adaptive-gemini` Routing Engine

### The Problem
Coding harnesses like OpenCode have built-in multi-model delegation routers (routing `@fast` searches to Flash Lite and `@heavy` planning to Pro). However, most other harnesses (Claude Code, OpenAI Codex, Aider, Roo Code, Continue) lack tier delegation: they send all requests to a single configured model. This results in users burning expensive daily Pro or Flash quotas on routine tasks (e.g. running a bash `ls` command, checking a git diff, or reading a tiny file).

### Architectural Design: Virtual Model vs. Dedicated Endpoint
We will introduce `adaptive-gemini` as a **virtual model** supported transparently across **all** endpoints:
1. **OpenAI Chat Completions**: `POST /v1/chat/completions` with `"model": "adaptive-gemini"`
2. **Anthropic Messages API**: `POST /v1/messages` with `"model": "adaptive-gemini"`
3. **OpenAI Responses API**: `POST /v1/responses` with `"model": "adaptive-gemini"`

> **Why a virtual model?**  
> If we only added a dedicated endpoint, existing client applications (like Claude Code or Codex) would require client code changes. By exposing `adaptive-gemini` as a standard model identifier in `GET /v1/models`, any client can simply configure `"model": "adaptive-gemini"` in its settings and immediately get autonomous multi-tier model routing with zero client-side modifications.

### Routing Pipeline & Heuristics
When `adaptive-gemini` is requested, the bridge runs an ultra-fast classification pipeline (< 5ms) before forwarding to Gemini:

```
                          ┌────────────────────────┐
                          │   Incoming Request     │
                          │(model: adaptive-gemini)│
                          └───────────┬────────────┘
                                      │
                         [ Heuristic Classification ]
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
   [ Fast Tier ]               [ Medium Tier ]              [ Heavy Tier ]
  - Read-only tools           - Multi-turn edits           - Architectural plans
  - Short context / search    - Complex code generation    - Repeated failed turns
  - Simple bash/git commands  - Unit tests & refactoring   - Long context synthesis
         │                            │                            │
         ▼                            ▼                            ▼
gemini-3.1-flash-lite        gemini-3.8-flash           gemini-3.1-pro-preview
         │                            │                            │
         └────────────────────────────┼────────────────────────────┘
                                      │
                         [ Dynamic Quota Fallback ]
                      (If Pro 429 -> fallback to Flash)
                                      │
                                      ▼
                        [ Execute via Gemini Engine ]
                        + Return Header:
                          x-bridge-routed-model: <model>
```

- **Tier 1 (Fast - `gemini-3.1-flash-lite`)**: Simple read-only operations, terminal status checks, short single-turn queries, file existence checks.
- **Tier 2 (Standard - `gemini-3.8-flash`)**: Code generation, multi-file refactoring, standard tool calling loops, unit test writing.
- **Tier 3 (Heavy - `gemini-3.1-pro-preview`)**: Multi-step architecture design, security audits, root cause analysis, or prompts where the previous turn failed.
- **Quota-Aware Auto-Downgrade**: If the selected tier is rate-limited (HTTP 429), the engine automatically down-tiers to Flash or Flash Lite and continues without crashing the client session.
- **Transparency**: Every response appends `x-bridge-routed-model: <actual-gemini-model-used>` for logging and dashboard visibility.

---

## 🛠️ Milestone 2: Onboarding & Configuration UX

### 1. `gemini-bridge doctor`
An interactive diagnostic command to troubleshoot setup in seconds:
- Verifies Node.js runtime and environment.
- Validates OAuth credentials in `~/.gemini/oauth_creds.json` and prints expiration timestamp.
- Validates fallback `GEMINI_API_KEY` if provided.
- Tests network latency and SSL reachability to Google APIs (`cloudcode-pa.googleapis.com`, `generativelanguage.googleapis.com`).
- Checks port availability (`8765`, `3000`) and running daemon PID.
- Probes active client configuration files (`~/.claude/settings.json`, `~/.config/opencode/config.json`).

### 2. Client Setup Wizards (`gemini-bridge setup <client>`)
Interactive CLI setup command to configure client tools in one keypress:
```bash
gemini-bridge setup opencode
gemini-bridge setup claude-code
gemini-bridge setup codex
gemini-bridge setup continue
```
Inspects client configuration paths and automatically merges the bridge endpoint, model configurations, and dummy auth tokens safely without overwriting user settings.

### 3. Persistent Configuration File (`~/.gemini-bridge.json`)
Support user configuration for defaults without requiring environment variables:
```json
{
  "port": 8765,
  "host": "127.0.0.1",
  "defaultModel": "adaptive-gemini",
  "modelAliases": {
    "gpt-4o": "gemini-2.5-pro",
    "gpt-4o-mini": "gemini-2.5-flash",
    "claude-3-5-sonnet-20241022": "gemini-3.8-flash"
  },
  "quotaFallback": true
}
```

---

## 📊 Milestone 3: Runtime Observability & Embedded Web Dashboard

### Local Web Dashboard (`/dashboard` or `gemini-bridge dashboard`)
A lightweight, zero-dependency embedded web interface served directly from the Fastify server:
- **Live Request Stream**: Real-time inspection of active and recent requests, latencies, and token counts.
- **Thought Signature & Reasoning Viewer**: Dedicated panel inspecting Gemini thinking processes and internal reasoning streams.
- **Tool Call Debugger**: Visual timeline of tool calls, inputs, outputs, and JSON schema sanitization transformations.
- **Quota & Token Gauges**: Real-time visual meters for daily quota, sliding-window RPM/RPD, and model token usage.

---

## 🛡️ Milestone 4: Reliability & Session Continuity

### 1. Human-Readable Error Translation
Intercept low-level Google API and gRPC errors and map them into clear, actionable guidance:
- `RESOURCE_EXHAUSTED` -> `"Daily quota limit reached for gemini-2.5-pro. Resets at midnight UTC. The bridge can automatically fall back to Flash."`
- `UNAUTHENTICATED` / Expired OAuth -> `"Google OAuth token expired. Please run 'gemini auth login' or provide GEMINI_API_KEY."`
- `PERMISSION_DENIED` -> Clear instructions on Google Cloud project permissions.

### 2. Proactive Background Token Refresh Loop
In long-running agent sessions (OpenCode or Claude Code running for multiple hours), OAuth access tokens can expire mid-prompt. The daemon will maintain a background timer to proactively refresh tokens 5–10 minutes before expiration.

### 3. Jittered Exponential Retry
Configurable auto-retry for transient HTTP 500/503 network dropouts before returning errors to the AI harness.

---

## 🔌 Milestone 5: Extended Protocol & Multimodal Parity

### 1. Embeddings Endpoint (`POST /v1/embeddings`)
Provide OpenAI-compatible `/v1/embeddings` routing to Gemini's `text-embedding-004`. Enables IDE extensions (Continue, Cursor, Open WebUI) to run RAG indexing directly through the bridge without requiring an external embedding service.

### 2. Anthropic Document / PDF Translation
Translate Anthropic Messages API `type: "document"` base64 PDF blocks into Gemini inline document parts (`application/pdf`) for native multi-page document reasoning.

### 3. Thinking Budget Controls
Support explicit reasoning budget flags (e.g. Anthropic `thinking: { budget_tokens: N }` and OpenAI `reasoning_effort`) mapped to Gemini's `thinking_config`.

---

## 🖥️ Milestone 6: OS Integration & Daemon Management

### Native System Service Generator (`gemini-bridge service install`)
Allow users to register the bridge as a background service that automatically launches on boot:
- **macOS**: `launchd` plist integration.
- **Linux**: `systemd --user` unit generation and enablement.
- **Windows**: Windows Service / Startup registration.

---

## 📅 Phased Release Plan

| Phase | Target | Core Deliverables |
|---|---|---|
| **Phase 1: Diagnostics & Aliasing** | v0.6.0 | `gemini-bridge doctor`, model aliasing table, human-readable error translation, clean env-based project ID resolution. |
| **Phase 2: Adaptive Model Routing** | v0.7.0 | `adaptive-gemini` virtual model across `/v1/chat/completions`, `/v1/messages`, and `/v1/responses`, tier classification, quota-aware fallback. |
| **Phase 3: Client Wizards & Refresh** | v0.8.0 | `gemini-bridge setup <client>`, proactive background OAuth token renewal, `POST /v1/embeddings`. |
| **Phase 4: Observability & Services** | v0.9.0 | Embedded Web Dashboard (`/dashboard`), Anthropic PDF support, `gemini-bridge service install`. |
