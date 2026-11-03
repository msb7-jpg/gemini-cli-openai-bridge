# Gemini CLI OpenAI Bridge — Setup & Integration Guide

This guide walks you through building **`@miguelsb/gemini-cli-openai-bridge`** from source, configuring Google authentication, and integrating it seamlessly with **OpenCode** and **Claude Code (`claude`)**.

---

## ⚡ Quick Start: 1-Click Prompt for AI Agents

If you are using an AI coding assistant (like OpenCode, Claude Code, Cursor, Aider, or Roo Code), you can simply copy and paste this prompt to have your agent configure everything automatically:

```markdown
Please set up the Gemini CLI OpenAI Bridge by reading the instructions at:
- Setup Guide: https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/SETUP.md
- OpenCode Setup: https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-opencode.md
(or Claude Code Setup: https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-claude-code.md)

Follow these instructions to install @miguelsb/gemini-cli-openai-bridge (via npm or from source), configure my credentials, set up the provider, and verify the integration.
```

---

## 📦 1. Installation

### Method A: Install via npm (Fastest)
```bash
npm install -g @miguelsb/gemini-cli-openai-bridge
```
Or run directly without installation:
```bash
npx @miguelsb/gemini-cli-openai-bridge --port=8765
```

### Method B: Build from Source (Contributors)
```bash
git clone https://github.com/msb7-jpg/gemini-cli-openai-bridge.git
cd gemini-cli-openai-bridge
npm install
npm run build
npm link
```

Now you can run:
```bash
gemini-bridge --port=8765
```

---

## 🔑 2. Authentication

The bridge routes requests through Google Gemini APIs and requires authentication:

### Option A: Official Google Gemini CLI Login (Recommended)
If you have Google's official CLI installed:
```bash
# If not installed:
npm install -g @google/gemini-cli
# Or: bun add -g @google/gemini-cli@latest

gemini auth login
```
The bridge automatically inherits your cached OAuth credentials from `~/.gemini/settings.json`.

### Option B: API Key Environment Variable
Alternatively, export your Google Gemini API key:
```bash
export GEMINI_API_KEY="AIzaSy..."
```

---

## 🤖 3. OpenCode Integration

### Configuration
Edit or create `~/.config/opencode/opencode.json`:

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

### Start OpenCode
```bash
opencode --model gemini-bridge/gemini-3.8-flash
```

For agent prompt instructions, see [https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-opencode.md](https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-opencode.md).

---

## 🎭 4. Claude Code (`claude`) Integration

The bridge natively exposes the **Anthropic Messages API (`/v1/messages`)** and Anthropic models endpoint (`/v1/models`).

### Configuration
Add this to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8765",
    "ANTHROPIC_AUTH_TOKEN": "local",
    "ANTHROPIC_MODEL": "gemini-3.8-flash"
  }
}
```

Or export in your shell (`~/.zshrc` / `~/.bashrc`):
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8765"
export ANTHROPIC_AUTH_TOKEN="local"
export ANTHROPIC_MODEL="gemini-3.8-flash"
```

### Start Claude Code
```bash
claude
# Or specify a model dynamically:
claude --model gemini-3.8-flash
```

For agent prompt instructions, see [https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-claude-code.md](https://github.com/msb7-jpg/gemini-cli-openai-bridge/blob/main/prompts/setup-claude-code.md).

---

## ℹ️ 5. Gemini CLI Version Compatibility & Architecture Notes

### User Environment vs. Build Engine
- **Global Gemini CLI (`@google/gemini-cli@0.66.0+`)**: The bridge is 100% compatible with the latest official releases of Google's Gemini CLI. You can use any version of `@google/gemini-cli` (including `v0.66.0` or nightly builds) on your machine for `gemini auth login`. The bridge reads your OAuth credentials seamlessly.
- **Internal Core Submodule**: The build workspace embeds the stable `@google/gemini-cli-core` engine. This decoupling protects the bridge from upstream breaking changes (such as monorepo refactors and internal API signature shifts in Google's unreleased core packages), while our adapter layer handles modern protocol features (Protobuf schema sanitization, cryptographic thought signatures, Anthropic Messages translation, and Gemini 3.8 Flash model execution) with complete stability.

---

## 🚀 6. Publishing to npm (Maintainers)

To release and publish updates to npm:

1. **Verify Tests**:
   ```bash
   npm test
   ```
2. **Build and Test Tarball**:
   ```bash
   npm run pack:bridge-server
   ```
3. **Publish with Public Access**:
   ```bash
   npm run publish:bridge-server
   ```
   *(Ensure you are logged into npm via `npm login` before publishing).*
