# Gemini CLI OpenAI Bridge

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Build & Test](https://img.shields.io/badge/tests-22%20passed-brightgreen)](https://github.com/msb7-jpg/gemini-cli-openai-bridge)

> **Standalone Evolution & Maintenance**  
> Built upon the open-source [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) core and inspired by the archived [`Intelligent-Internet/gemini-cli-mcp-openai-bridge`](https://github.com/Intelligent-Internet/gemini-cli-mcp-openai-bridge).

`@migueldsbatista/gemini-cli-openai-bridge` provides a high-performance **OpenAI-compatible** and **Anthropic Messages-compatible** HTTP API bridge that routes requests directly to Google Gemini models using the official authentication, session management, and execution engine of Google's Gemini CLI.

It is specifically tailored for AI coding agents and developer workflows such as **[OpenCode](https://opencode.ai)**, **Claude Code**, **VSCode Copilot Chat**, **Zed Editor**, **Aider**, **Roo Code**, **Continue**, and **Open WebUI**.

---

## ⚡ 1-Click Setup Prompt for AI Agents

If you are using an AI coding assistant (such as **OpenCode**, **Claude Code**, **VSCode Copilot**, **Zed**, **Cursor**, **Aider**, or **Roo Code**), simply copy and paste this prompt:

```markdown
Please set up the Gemini CLI OpenAI Bridge by reading the instructions at:
- Setup Guide: https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/SETUP.md
- OpenCode Setup: https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-opencode.md
- Claude Code Setup: https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-claude-code.md
- VSCode Copilot Setup: https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-vscode.md
- Zed Editor Setup: https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-zed.md

Follow these instructions to install @migueldsbatista/gemini-cli-openai-bridge globally, configure my credentials, and verify the integration.
```

Dedicated prompt files:
- 🤖 OpenCode: [prompts/setup-opencode.md](./prompts/setup-opencode.md)
- 🎭 Claude Code: [prompts/setup-claude-code.md](./prompts/setup-claude-code.md)
- 💻 VSCode Copilot: [prompts/setup-vscode.md](./prompts/setup-vscode.md)
- ⚡ Zed Editor: [prompts/setup-zed.md](./prompts/setup-zed.md)
- 📋 Comprehensive Setup Guide: [SETUP.md](./SETUP.md)

---

## 📸 Media & Demos

### 1. OpenCode Multi-Turn Autonomous Tool Calls
OpenCode running complex planning and bash tool execution with `gemini-3.8-flash`:
![OpenCode Tool Calls](media/opencode-tool-calls-example.png)

### 2. OpenCode Multimodal Vision Analysis
Gemini thinking models analyzing visual screenshot inputs directly inside OpenCode:
![OpenCode Vision](media/opencode-vision-example.png)

### 3. Claude Code Running on Gemini 3.8 Flash
Claude Code transparently operating through our Anthropic Messages API (`/v1/messages`):
![Claude Code on Gemini](media/claude-example.png)

---

## ⚡ Key Capabilities

- 🔄 **OpenAI & Anthropic Parity**: Serves standard `/v1/chat/completions` alongside full Anthropic `/v1/messages` (SSE streaming & non-streaming) with `/health` and Claude connection probes (`/api/hello`).
- 🧠 **Thought Signature Preservation**: Seamlessly extracts, caches, and preserves `thought_signature` / `thoughtSignature` tokens across multi-turn function calls, enabling Gemini reasoning models (**Gemini 2.5 Flash/Pro**, **Gemini 3.8 Flash**).
- 🛠️ **Parallel Tool Calling & Turn Parity**: Bundles OpenAI `role: "tool"` responses into Gemini's single `user` turn constraints, matching parts 1:1 and synthesizing fallback responses if any tool call is omitted.
- 🛡️ **Exhaustive Schema Sanitization**: Translates modern OpenAPI 3.1 / JSON Schema constructs (`exclusiveMinimum`, `exclusiveMaximum`, `const`, `oneOf`, `$schema`, `additionalProperties`) into strict Gemini Protobuf schemas without HTTP 400 errors.
- 🔀 **Dynamic Per-Request Model Selection**: Dynamically routes requests according to the model specified in the request payload (`gemini-3.8-flash`, `gemini-2.5-pro`, etc.) rather than forcing a static default.
- 🔑 **Frictionless Authentication**: Inherits existing Gemini CLI credentials (Google OAuth interactive login) or uses the `GEMINI_API_KEY` environment variable.

---

## 🆚 Differences from the Archived Upstream Project

The original upstream repository [`Intelligent-Internet/gemini-cli-mcp-openai-bridge`](https://github.com/Intelligent-Internet/gemini-cli-mcp-openai-bridge) was archived in July 2026. This project is a standalone continuation and refactor that addresses critical issues and modern agent requirements:

| Feature / Area | Original Archived Project | `@migueldsbatista/gemini-cli-openai-bridge` |
|---|---|---|
| **Anthropic Messages API (`/v1/messages`)** | ❌ Not supported | ✅ **Fully supported**: native integration for **Claude Code** with streaming & tools. |
| **`thought_signature` Handling** | ❌ Stripped / discarded, breaking multi-turn tool calling with thinking models | ✅ **Cached & injected** across turns via `thoughtSignatureCache`, enabling Gemini 2.5 & 3.x thinking models. |
| **JSON Schema Sanitization** | ❌ Minimal (only `$schema` & `additionalProperties`), crashing on modern Zod / Effect Schemas | ✅ **Strict whitelist & conversions** (`exclusiveMinimum`, `const` to `enum`, `oneOf` to `anyOf`, type arrays). |
| **Parallel Tool Calls Parity** | ❌ Mapped 1:1 as separate `user` turns, causing HTTP 400 part mismatch errors | ✅ **Batch grouped** into a single Gemini `user` turn with ordered 1:1 part matching and synthetic fallback. |
| **Model Routing** | ❌ Hardcoded to default `gemini-2.5-flash` regardless of request `model` | ✅ **Dynamic request Proxy**: routes dynamically to requested model (`gemini-3.8-flash`, `gemini-2.5-pro`, etc.). |
| **Supported Models** | ❌ Outdated model listing | ✅ Updated with **Gemini 3.8 Flash**, **Gemini 3 Flash/Pro Preview**, and **Gemini 2.5 Pro/Flash**. |
| **Codebase Architecture** | ⚠️ Heavy MCP proxy bloat that broke under upstream CLI updates | 🚀 **Streamlined & focused**: dedicated HTTP API bridge (OpenAI + Anthropic) with 100% passing test coverage. |

---

## 🚀 Installation & Getting Started

### Method 1: Global Install via npm (Recommended)

```bash
npm install -g @migueldsbatista/gemini-cli-openai-bridge
```

Start the bridge daemon:
```bash
gemini-bridge
```

### Method 2: Run Directly via npx (Secondary Option)

```bash
npx @migueldsbatista/gemini-cli-openai-bridge --port=8765
```

---

## 🔑 Authentication

The bridge requires authentication to access Google Gemini APIs:

1. **Option A: Gemini CLI OAuth (Interactive - Recommended)**  
   If you have already logged in via `gemini-cli` (`gemini auth login` or `.gemini/settings.json`), the bridge will automatically use your cached credentials:
   ```bash
   gemini auth login
   ```

2. **Option B: Environment Variable (CI / Headless Servers)**  
   Set your API key before starting the server in your environment variables:
   ```bash
   export GEMINI_API_KEY="AIzaSy..."
   gemini-bridge
   ```

---

## 🔌 Integrations

The bridge seamlessly connects with popular AI coding agents, editors, and developer tools via standard OpenAI `/v1/chat/completions` and Anthropic `/v1/messages` endpoints.

Detailed step-by-step setup guides and prompt templates:

- 🤖 **[OpenCode Setup](./prompts/setup-opencode.md)**: Configuration for `~/.config/opencode/opencode.json` using `@ai-sdk/openai-compatible`.
- 🎭 **[Claude Code Setup](./prompts/setup-claude-code.md)**: Configuration for Anthropic Messages API routing via environment variables.
- 💻 **[VSCode Copilot Chat Setup](./prompts/setup-vscode.md)**: Configuration for `chatLanguageModels.json` custom endpoints.
- ⚡ **[Zed Editor Setup](./prompts/setup-zed.md)**: Configuration for Zed `settings.json` under `openai_compatible`.

---

## ℹ️ Gemini CLI Version Compatibility Note

- **User CLI Environment**: The bridge is 100% compatible with the latest stable releases of Google's official Gemini CLI (`@google/gemini-cli@0.66.0+`). You can use `gemini auth login` from any modern CLI release.
- **Internal Core Submodule**: The build workspace embeds the stable `@google/gemini-cli-core` engine. This decoupling shields the bridge from upstream breaking changes (such as monorepo reorganizations and internal API changes in Google's unreleased packages), while our adapter layer handles all modern protocol features (Protobuf schema sanitization, cryptographic thought signatures, Anthropic Messages translation, and Gemini 3.8 Flash model execution).

---

## 💻 CLI Commands & Daemon Control

The bridge provides instant CLI daemon management commands with fast-path execution (< 100ms):

```bash
gemini-bridge               # Start the bridge daemon in background (with live spinner)
gemini-bridge status        # Check daemon status, uptime, PID, and active ports
gemini-bridge quota         # View real-time quota, RPM/RPD limits, and token usage
gemini-bridge restart       # Restart the background daemon
gemini-bridge stop          # Stop the running bridge daemon
gemini-bridge logs          # View recent server log output (-f to follow)
```

### 📊 Real-Time Quota & Usage Monitoring

Google Gemini does not provide a public pre-request quota remaining API. The bridge implements an in-memory **Sliding Window Quota & Usage Tracker** that:
- Monitors **Requests Per Minute (RPM)** and **Requests Per Day (RPD)**.
- Automatically calculates remaining capacity against your auth tier (e.g. 60 RPM / 1,000 RPD for Gemini Code Assist OAuth, or 15 RPM for Free API keys).
- Captures real `usageMetadata` from Gemini responses (prompt tokens, candidate tokens, and cached tokens).
- Detects proactive Google HTTP 429 quota exhaustion events (e.g. Pro Quota fallback to Flash) and extracts `Retry-After` windows.
- Exposes standard OpenAI rate limit headers (`x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`) on every response.
- Exposes `GET /v1/quota` (and `GET /v1/usage`) for agent harnesses, dashboards, or scripts.

Example CLI output:
```
══════════════════════════════════════════════════════
  Gemini Bridge Quota & Usage Monitor  (http://127.0.0.1:8765)
══════════════════════════════════════════════════════
  Status:         HEALTHY (Normal)
  Auth Type:      oauth-personal
  Uptime:         1m 5s
  Total Requests: 4

  Requests Per Minute (RPM):
    [█░░░░░░░░░░░░░░░░░░░] 3/60 reqs  (57 restantes nesta janela)
  Requests Per Day (RPD):
    [░░░░░░░░░░░░░░░░░░░░] 4/1000 reqs  (996 restantes hoje)

  Tokens Consumidos (Sessão):
    Prompt:     242,850 tokens
    Candidate:  68 tokens
    Cached:     110,591 tokens
    Total:      242,918 tokens

  Consumo por Modelo:
    • gemini-3.8-flash: 6 reqs, 242,918 tokens
══════════════════════════════════════════════════════
```

---

## 💻 CLI Options

```
Options:
  -h, --host                    Host address to listen on (default: 127.0.0.1)
  -p, --port                    Port to listen on (default: 8765, or GEMINI_BRIDGE_PORT)
  -d, --target-dir              Working directory for operations (default: current directory)
      --debug                   Enable detailed debug logging (default: false)
      --use-internal-prompt     Load internal GEMINI.md prompts (default: false)
      --tools-model             Specify a fallback model for tool execution
      --mode                    Security mode: read-only, edit, configured, yolo
      --i-know-what-i-am-doing  Bypass interactive confirmation for yolo mode
  -?, --help                    Show help
```

---

## 🧪 Testing & Development

For guidelines on setting up local development, running tests, rebuilding with `npm run port`, and publishing, please refer to [CONTRIBUTING.md](CONTRIBUTING.md).

Run the test suite:
```bash
npm test
```

---

## 📄 License & Attribution

- Licensed under [Apache-2.0](LICENSE).
- Core execution engine and authentication: [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) (Copyright Google LLC).
- Architectural foundation: inspired by the archived [`Intelligent-Internet/gemini-cli-mcp-openai-bridge`](https://github.com/Intelligent-Internet/gemini-cli-mcp-openai-bridge) (Copyright 2025 Intelligent-Internet).
