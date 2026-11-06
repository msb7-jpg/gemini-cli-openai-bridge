# OpenCode Setup Prompt for AI Agents

> **Instructions for the AI Agent:**  
> When the user asks you to set up the Gemini CLI OpenAI Bridge with OpenCode, follow the exact steps below autonomously.

---

### Goal
Build and configure `@migueldsbatista/gemini-cli-openai-bridge` from source and configure OpenCode (`~/.config/opencode/opencode.json`) so the user can run OpenCode powered by Google Gemini models (including `gemini-3.8-flash` and `gemini-2.5-pro`).

---

### Step 1: Verify Prerequisites
1. Ensure **Node.js >= 18** and **npm** are installed:
   ```bash
   node -v
   npm -v
   ```
2. Verify Gemini authentication exists:
   - Check if `GEMINI_API_KEY` is exported:
     ```bash
     echo $GEMINI_API_KEY
     ```
   - OR check if the user is logged into the official Google Gemini CLI:
     ```bash
     gemini --version
     # If not logged in, run: gemini auth login
     ```

---

### Step 2: Install or Build the Bridge
First, attempt installing globally from npm:
```bash
npm install -g @migueldsbatista/gemini-cli-openai-bridge
```

If that fails or you are building from local source:
```bash
# Clone if not already present
git clone https://github.com/msb7-jpg/gemini-cli-openai-bridge.git
cd gemini-cli-openai-bridge

# Build and link globally
npm install
npm run build
npm link
```

---

### Step 3: Configure OpenCode (`~/.config/opencode/opencode.json`)
Read the user's existing `~/.config/opencode/opencode.json` (or create it if missing).

You can configure OpenCode using either the modern `providers` format (recommended for forward compatibility) or the classic `provider` format with `options`.

#### Modern Format (`providers` — Recommended):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "gemini-bridge": {
      "name": "Gemini CLI Bridge",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://127.0.0.1:8765/v1"
      },
      "headers": {
        "Authorization": "Bearer local-bridge"
      },
      "models": {
        "gemini-3.8-flash": {
          "name": "Gemini 3.8 Flash (Thinking)",
          "capabilities": {
            "tools": true
          }
        },
        "gemini-3.5-flash": {
          "name": "Gemini 3.5 Flash",
          "capabilities": {
            "tools": true
          }
        },
        "gemini-3.1-flash-lite": {
          "name": "Gemini 3.1 Flash Lite",
          "capabilities": {
            "tools": true
          }
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro (Deep Reasoning)",
          "capabilities": {
            "tools": true
          }
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash",
          "capabilities": {
            "tools": true
          }
        },
        "gemini-2.5-flash-lite": {
          "name": "Gemini 2.5 Flash Lite",
          "capabilities": {
            "tools": true
          }
        },
        "gemini-3-flash-preview": {
          "name": "Gemini 3 Flash Preview",
          "capabilities": {
            "tools": true
          }
        },
        "gemini-3-pro-preview": {
          "name": "Gemini 3 Pro Preview",
          "capabilities": {
            "tools": true
          }
        }
      }
    }
  }
}
```

#### Classic Format (`provider` — with `options`):
Ensure `baseURL` and `apiKey` are wrapped inside the nested `"options"` block:

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
          "name": "Gemini 3.8 Flash (Thinking)",
          "tool_call": true,
          "limit": {
            "context": 1048576,
            "output": 65536
          }
        },
        "gemini-3.5-flash": {
          "name": "Gemini 3.5 Flash",
          "tool_call": true,
          "limit": {
            "context": 1048576,
            "output": 65536
          }
        },
        "gemini-3.1-flash-lite": {
          "name": "Gemini 3.1 Flash Lite",
          "tool_call": true,
          "limit": {
            "context": 1048576,
            "output": 65536
          }
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro (Deep Reasoning)",
          "tool_call": true,
          "limit": {
            "context": 1048576,
            "output": 65536
          }
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash",
          "tool_call": true,
          "limit": {
            "context": 1048576,
            "output": 65536
          }
        },
        "gemini-2.5-flash-lite": {
          "name": "Gemini 2.5 Flash Lite",
          "tool_call": true,
          "limit": {
            "context": 1048576,
            "output": 65536
          }
        },
        "gemini-3-flash-preview": {
          "name": "Gemini 3 Flash Preview",
          "tool_call": true,
          "limit": {
            "context": 1048576,
            "output": 65536
          }
        },
        "gemini-3-pro-preview": {
          "name": "Gemini 3 Pro Preview",
          "tool_call": true,
          "limit": {
            "context": 1048576,
            "output": 65536
          }
        }
      }
    }
  }
}
```

> **Note on Applying Config Changes:**  
> After creating or modifying `opencode.json`, restart or reload OpenCode for changes to take effect:
> ```bash
> opencode service restart 2>/dev/null || opencode reload 2>/dev/null || true
> ```

---

### Step 4: Manage the Bridge Daemon
Start the bridge in background (detached mode):
```bash
gemini-bridge          # Starts in background automatically
gemini-bridge status   # Verify PID, port and health
gemini-bridge logs     # Check live logs
```

---

### Step 5: Verify the Integration
1. Test the health endpoint:
   ```bash
   curl http://127.0.0.1:8765/health
   ```
2. Test completions with OpenCode:
   ```bash
   opencode --model gemini-bridge/gemini-3.8-flash "Say hello and confirm you are connected!"
   ```

---

### Step 6 (Optional but Recommended): Configure Multi-Tier Model Router
To prevent exhausting your Google Gemini Flash quota on routine file searches (`grep`/`glob`), install and configure [`opencode-model-router`](https://github.com/marco-jardim/opencode-model-router) so OpenCode routes `@fast` tasks to Flash Lite (`gemini-3.1-flash-lite`), `@medium` to Flash (`gemini-3.8-flash`), and `@heavy` to Pro (`gemini-3.1-pro-preview`):

Refer to the complete guide at: [OpenCode Model Router Guide](../opencode-model-router-guide.md).
