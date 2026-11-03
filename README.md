# Gemini CLI OpenAI Bridge

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Build & Test](https://img.shields.io/badge/tests-22%20passed-brightgreen)](https://github.com/msb7-jpg/gemini-cli-openai-bridge)

> **Standalone Evolution & Maintenance**  
> Built upon the open-source [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) core and inspired by the archived [`Intelligent-Internet/gemini-cli-mcp-openai-bridge`](https://github.com/Intelligent-Internet/gemini-cli-mcp-openai-bridge).

`@miguelsb/gemini-cli-openai-bridge` provides a high-performance **OpenAI-compatible (`/v1/chat/completions`)** and **Anthropic Messages-compatible (`/v1/messages`)** HTTP API bridge that routes requests directly to Google Gemini models using the official authentication, session management, and execution engine of Google's Gemini CLI.

It is specifically tailored for AI coding agents and developer workflows such as **[OpenCode](https://opencode.ai)**, **Claude Code (`claude`)**, **Aider**, **Roo Code**, **Continue**, and **Open WebUI**.

---

## ⚡ 1-Click Setup Prompt for AI Agents

If you are using an AI coding assistant (such as **OpenCode**, **Claude Code**, **Cursor**, **Aider**, or **Roo Code**), simply copy and paste this prompt:

```markdown
Read @SETUP.md and @prompts/setup-opencode.md (or @prompts/setup-claude-code.md).
Please build the Gemini CLI OpenAI Bridge from source, ensure Google credentials are configured,
set up the provider configuration in my settings, and verify that the bridge is running.
```

Dedicated prompt files:
- 🤖 OpenCode: [`prompts/setup-opencode.md`](prompts/setup-opencode.md)
- 🎭 Claude Code: [`prompts/setup-claude-code.md`](prompts/setup-claude-code.md)
- 📋 Comprehensive Setup Guide: [`SETUP.md`](SETUP.md)

---

## 📸 Media & Demos

### 1. OpenCode Multi-Turn Autonomous Tool Calls
OpenCode running complex planning and bash tool execution with `gemini-3.8-flash`:
![OpenCode Tool Calls](media/opencode-tool-calls-example.png)

### 2. OpenCode Multimodal Vision Analysis
Gemini thinking models analyzing visual screenshot inputs directly inside OpenCode:
![OpenCode Vision](media/opencode-vision-example.png)

### 3. Claude Code Running on Gemini 3.8 Flash
Claude Code (`claude`) transparently operating through our Anthropic Messages API (`/v1/messages`):
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

| Feature / Area | Original Archived Project | `@miguelsb/gemini-cli-openai-bridge` |
|---|---|---|
| **Anthropic Messages API (`/v1/messages`)** | ❌ Not supported | ✅ **Fully supported**: native integration for **Claude Code** (`claude`) with streaming & tools. |
| **`thought_signature` Handling** | ❌ Stripped / discarded, breaking multi-turn tool calling with thinking models | ✅ **Cached & injected** across turns via `thoughtSignatureCache`, enabling Gemini 2.5 & 3.x thinking models. |
| **JSON Schema Sanitization** | ❌ Minimal (only `$schema` & `additionalProperties`), crashing on modern Zod / Effect Schemas | ✅ **Strict whitelist & conversions** (`exclusiveMinimum`, `const` to `enum`, `oneOf` to `anyOf`, type arrays). |
| **Parallel Tool Calls Parity** | ❌ Mapped 1:1 as separate `user` turns, causing HTTP 400 part mismatch errors | ✅ **Batch grouped** into a single Gemini `user` turn with ordered 1:1 part matching and synthetic fallback. |
| **Model Routing** | ❌ Hardcoded to default `gemini-2.5-flash` regardless of request `model` | ✅ **Dynamic request Proxy**: routes dynamically to requested model (`gemini-3.8-flash`, `gemini-2.5-pro`, etc.). |
| **Supported Models** | ❌ Outdated model listing | ✅ Updated with **Gemini 3.8 Flash**, **Gemini 3 Flash/Pro Preview**, and **Gemini 2.5 Pro/Flash**. |
| **Codebase Architecture** | ⚠️ Heavy MCP proxy bloat that broke under upstream CLI updates | 🚀 **Streamlined & focused**: dedicated HTTP API bridge (OpenAI + Anthropic) with 100% passing test coverage. |

---

## 🚀 Installation & Getting Started (Build from Source)

### 1. Clone & Build
```bash
git clone https://github.com/msb7-jpg/gemini-cli-openai-bridge.git
cd gemini-cli-openai-bridge
npm install
npm run build
```

### 2. Make CLI Globally Available
Run `npm link` to register `gemini-bridge` and `gemini-cli-bridge` globally on your system:
```bash
npm link
```

### 3. Start the Bridge Server
```bash
gemini-bridge --port=8765
```
Or start directly with npm:
```bash
npm start -- --port=8765
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
   Set your API key before starting the server:
   ```bash
   export GEMINI_API_KEY="AIzaSy..."
   gemini-bridge
   ```

---

## 🤖 Integration with OpenCode

Configure the bridge in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "gemini-bridge": {
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "http://127.0.0.1:8765/v1",
      "apiKey": "local-bridge",
      "models": {
        "gemini-3.8-flash": {
          "name": "Gemini 3.8 Flash",
          "tools": true
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro",
          "tools": true
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash",
          "tools": true
        }
      }
    }
  }
}
```

Start OpenCode pointing to your model:
```bash
opencode --model gemini-bridge/gemini-3.8-flash
```

For agent prompt instructions, see [`prompts/setup-opencode.md`](prompts/setup-opencode.md).

---

## 🎭 Integration with Claude Code (`claude`)

The bridge natively exposes the **Anthropic Messages API (`/v1/messages`)** with streaming, function calling / tool execution, and model discovery (`/v1/models`).

### Persistent Setup (All Sessions)

Add the following to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8765",
    "ANTHROPIC_AUTH_TOKEN": "local",
    "ANTHROPIC_MODEL": "gemini-3.8-flash"
  }
}
```

Or export them in your shell configuration (`~/.zshrc` or `~/.bashrc`):

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8765"
export ANTHROPIC_AUTH_TOKEN="local"
export ANTHROPIC_MODEL="gemini-3.8-flash"
```

### Run Claude Code

```bash
claude
```

Or specify a specific model dynamically:
```bash
claude --model gemini-3.8-flash
claude --model gemini-2.5-pro
claude --model gemini-2.5-flash
```

The bridge translates Claude's tools (`Bash`, `FileRead`, `FileEdit`, etc.) directly to Gemini tool calls and maps results back seamlessly.

For agent prompt instructions, see [`prompts/setup-claude-code.md`](prompts/setup-claude-code.md).

---

## ℹ️ Gemini CLI Version Compatibility Note

- **User CLI Environment**: The bridge is 100% compatible with the latest stable releases of Google's official Gemini CLI (`@google/gemini-cli@0.66.0+`). You can use `gemini auth login` from any modern CLI release.
- **Internal Core Submodule**: The build workspace embeds the stable `@google/gemini-cli-core` engine. This decoupling shields the bridge from upstream breaking changes (such as monorepo reorganizations and internal API changes in Google's unreleased packages), while our adapter layer handles all modern protocol features (Protobuf schema sanitization, cryptographic thought signatures, Anthropic Messages translation, and Gemini 3.8 Flash model execution).

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

Run the test suite:
```bash
npm test
```

Rebuild after modifying files in `bridge-server/`:
```bash
npm run port
npm run build
```

---

## 📄 License & Attribution

- Licensed under [Apache-2.0](LICENSE).
- Core execution engine and authentication: [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) (Copyright Google LLC).
- Architectural foundation: inspired by the archived [`Intelligent-Internet/gemini-cli-mcp-openai-bridge`](https://github.com/Intelligent-Internet/gemini-cli-mcp-openai-bridge) (Copyright 2025 Intelligent-Internet).
