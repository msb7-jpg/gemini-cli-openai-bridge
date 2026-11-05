# Multi-Tier Model Router Guide for OpenCode & Gemini Bridge

Optimize your Gemini quota utilization and speed up agent workflows by integrating [`opencode-model-router`](https://github.com/marco-jardim/opencode-model-router) with **`gemini-cli-openai-bridge`**.

---

## 🎯 Why This is Recommended

Google Gemini API & Google AI Studio partition daily request and token quotas into **three independent pools**:

| Quota Pool | Supported Models | Recommended Tier in Router |
| :--- | :--- | :--- |
| **Flash Lite** | `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite` | **`@fast`** (Read-only reconnaissance) |
| **Flash** | `gemini-2.5-flash`, `gemini-3.5-flash`, `gemini-3.8-flash` | **`@medium`** & Primary Orchestrator |
| **Pro** | `gemini-2.5-pro`, `gemini-3-pro-preview`, `gemini-3.1-pro-preview` | **`@heavy`** (Architecture & Deep Debugging) |

### The Problem without Model Router
Without a tier router, OpenCode sends **all** operations (orchestration, file searching, grepping, editing, and architectural questions) to a single model—usually `gemini-3.8-flash`. 
- **40–60% of agent calls** are simple read-only tasks (`grep`, `glob`, reading code files).
- These trivial reads rapidly drain the **Flash** quota pool while **Flash Lite** and **Pro** pools sit completely idle at 0% usage.

### The Solution: 1 Quota Pool per Tier
By integrating `opencode-model-router`, tasks are distributed across all three pools automatically:
- **`@fast` (`gemini-3.1-flash-lite`)**: Takes over all file searches, grepping, syntax checks, and git log inspections using the unused Flash Lite quota pool. Enforced as host read-only.
- **`@medium` (`gemini-3.8-flash`)**: Handles core code generation, editing, refactoring, and test creation using the Flash quota pool.
- **`@heavy` (`gemini-3.1-pro-preview`)**: Handles deep debugging (after ≥2 failures), architecture decisions, and security audits using the Pro quota pool.

This setup effectively **triples your usable daily capacity** without hitting single-model quota caps.

---

## 📦 Step-by-Step Setup

### Step 1: Install the Router Plugin

Install `opencode-model-router` globally:

```bash
npm install -g opencode-model-router
```

### Step 2: Enable the Plugin in OpenCode

Edit your OpenCode configuration file at `~/.config/opencode/opencode.json`:

1. Add `"opencode-model-router"` to your `"plugins"` array.
2. Ensure the required models are configured under `provider["gemini-bridge"].models`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "gemini-bridge": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Gemini Bridge",
      "options": {
        "baseURL": "http://127.0.0.1:8765/v1",
        "apiKey": "local-bridge"
      },
      "models": {
        "gemini-3.8-flash": {
          "name": "Gemini 3.8 Flash"
        },
        "gemini-3.1-flash-lite": {
          "name": "Gemini 3.1 Flash Lite"
        },
        "gemini-2.5-flash-lite": {
          "name": "Gemini 2.5 Flash Lite"
        },
        "gemini-3.1-pro-preview": {
          "name": "Gemini 3.1 Pro Preview"
        },
        "gemini-3-pro-preview": {
          "name": "Gemini 3 Pro Preview"
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro"
        }
      }
    }
  },
  "model": "gemini-bridge/gemini-3.8-flash",
  "plugins": [
    "opencode-model-router"
  ]
}
```

### Step 3: Configure the Tier Overrides

Create or edit `~/.config/opencode/opencode-model-router.overrides.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "presets": {
    "gemini-bridge": {
      "fast": {
        "model": "gemini-bridge/gemini-3.1-flash-lite",
        "costRatio": 1,
        "steps": 30
      },
      "medium": {
        "model": "gemini-bridge/gemini-3.8-flash",
        "costRatio": 3,
        "steps": 60
      },
      "heavy": {
        "model": "gemini-bridge/gemini-3.1-pro-preview",
        "costRatio": 10,
        "steps": 120
      }
    }
  },
  "activePreset": "gemini-bridge"
}
```

*(Note: Override files survive package updates, so your tier mapping will remain intact).*

### Step 4: Reload OpenCode Configuration

If OpenCode is currently running in background service mode, reload configuration:

```bash
opencode reload
# or restart the service:
opencode service restart
```

---

## 🔍 Verification

1. **Verify Active Tiers**:
   In the OpenCode chat or TUI, run:
   ```text
   /tiers
   ```
   Or inspect router status:
   ```text
   /router
   ```
   You should see:
   - `@fast` mapped to `gemini-bridge/gemini-3.1-flash-lite`
   - `@medium` mapped to `gemini-bridge/gemini-3.8-flash`
   - `@heavy` mapped to `gemini-bridge/gemini-3.1-pro-preview`

2. **Verify Registered Agents via API**:
   ```bash
   opencode api get /api/agent
   ```
   Confirm that the `fast`, `medium`, `heavy`, and `model-router-grader` subagents are registered.

---

## 🚀 How It Works in Practice

- **Normal Conversation**: Just talk to OpenCode normally. The orchestrator (`gemini-3.8-flash`) automatically delegates read-only searches to `@fast`, executes edits with `@medium`, and escalates to `@heavy` when solving difficult errors.
- **Budget Control**: You can adjust delegation aggressiveness at runtime using `/budget`:
  - `/budget normal`: Balanced routing by task complexity (Default).
  - `/budget budget`: Defaults tasks to `@fast` first; escalates only when needed.
  - `/budget quality`: Uses `@medium` and `@heavy` more liberally.
  - `/budget deep`: Heavy-first mode for deep analysis and architectural refactoring.
