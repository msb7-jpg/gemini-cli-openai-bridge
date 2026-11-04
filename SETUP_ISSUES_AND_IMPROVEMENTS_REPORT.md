# Gemini CLI OpenAI Bridge — Setup Issues & Improvement Report

**Date:** 2026-11-03  
**Tested On:** Linux x86_64, Node.js v26.13.0, npm 11.20.0, OpenCode v2.2.5  
**Package:** `@migueldsbatista/gemini-cli-openai-bridge` (v0.1.15)

---

## 🎯 Executive Summary

During the end-to-end configuration and verification of the Gemini CLI OpenAI Bridge with OpenCode, several practical friction points were encountered across:
1. **Source build overhead** vs. global npm installation.
2. **Interactive CLI prompts** during global npm linking in managed Node environments.
3. **Google Gemini CLI auth configuration mismatch** (`selectedAuthType` vs `security.auth.selectedType`).
4. **OpenCode schema incompatibility** (`baseURL` / `apiKey` missing the nested `options` block).
5. **OpenCode schema deprecation** (`provider` vs `providers`).

This document details each problem, the root cause, how it was resolved during this session, and actionable code/documentation improvements to make future setups seamless.

---

## ⚠️ Issues Encountered & Solutions

### Issue 1: Git Submodule Clone Weight & Build Duration
- **Symptom:**
  Building from source requires initializing the nested `gemini-cli` submodule (`git submodule update --init --recursive`). This clones a heavy Google repository (>147,000 objects, >104MB download), followed by running multiple workspace install and build steps. For automated setups and AI agents, this can lead to timeout cancellations.
- **Resolution:**
  Switched to the standalone pre-packaged npm installation:
  ```bash
  npm install -g @migueldsbatista/gemini-cli-openai-bridge
  ```
  The npm package already includes bundled dependencies and compiled output in `dist/`.
- **Recommended Improvements:**
  - In `README.md` and `SETUP.md`, emphasize **Method A (npm install)** as the default primary installation method for users and coding agents.
  - If building from source is required, consider shallow submodule cloning in scripts:
    ```bash
    git submodule update --init --recursive --depth 1
    ```

---

### Issue 2: Interactive PATH Link Confirmation in npm Install
- **Symptom:**
  Running `npm install -g @migueldsbatista/gemini-cli-openai-bridge` halted waiting on an interactive prompt:
  ```text
  'gemini-bridge, gemini-cli-bridge' is not available on your PATH.
  Create a link in ~/.vite-plus/bin/ to make it available? [Y/n]
  ```
  In automated agent environments or scripts without a TTY, this prompt blocks or fails unless input is explicitly piped.
- **Resolution:**
  Responded with `Y` via standard input to complete linking into `/home/miguelsb/.local/share/vite-plus/bin/`.
- **Recommended Improvements:**
  - In setup documentation and agent prompts (`prompts/setup-opencode.md` and `prompts/setup-claude-code.md`), advise agents/scripts to use `yes | npm install -g ...` or supply flags if supported by the package manager environment.
  - Document fallback path resolution: if `gemini-bridge` is not immediately found in `PATH`, check `$(npm root -g)/../bin/` or `~/.local/share/vite-plus/bin/`.

---

### Issue 3: OAuth Authentication Not Detected Due to Config Key Differences
- **Symptom:**
  When starting `gemini-bridge --port=8765`, the server terminated with:
  ```text
  [BRIDGE-SERVER] [ERROR] Authentication missing: Please complete the authentication setup in gemini-cli first, or set the GEMINI_API_KEY environment variable.
  ```
  Even though the user was already authenticated with official Google Gemini CLI, and `~/.gemini/oauth_creds.json` was present on disk.
- **Root Cause:**
  In `bridge-server/src/index.ts` (and `dist/index.js` line 107):
  ```typescript
  let selectedAuthType = settings.merged.selectedAuthType;
  ```
  In newer Gemini CLI releases (v0.66+), the settings schema in `~/.gemini/settings.json` nests auth selection under `security.auth`:
  ```json
  {
    "security": {
      "auth": {
        "selectedType": "oauth-personal"
      }
    }
  }
  ```
  Since `selectedAuthType` was undefined at the root of `settings.json`, and `GEMINI_API_KEY` was not exported, the check threw a fatal error.
- **Resolution:**
  Manually added `"selectedAuthType": "oauth-personal"` at the root of `~/.gemini/settings.json`. The bridge immediately picked up the cached OAuth credentials and authenticated successfully.
- **Recommended Code Fix in `bridge-server/src/index.ts`:**
  Update the auth detection logic to inspect both legacy and modern paths, as well as disk credential presence:
  ```typescript
  let selectedAuthType = 
    settings.merged.selectedAuthType ||
    (settings.merged as any).security?.auth?.selectedType;

  // Auto-detect cached OAuth credentials if setting key is missing
  if (!selectedAuthType && !process.env.GEMINI_API_KEY) {
    const oauthPath = path.join(USER_SETTINGS_DIR, 'oauth_creds.json');
    if (fs.existsSync(oauthPath)) {
      selectedAuthType = AuthType.LOGIN_WITH_GOOGLE; // 'oauth-personal'
    }
  }
  ```
  This makes OAuth detection completely zero-configuration and resilient across Gemini CLI versions.

---

### Issue 4: OpenCode Provider Configuration Schema Error (`Route.model requires an endpoint baseURL`)
- **Symptom:**
  Running `opencode run -m gemini-bridge/gemini-3.8-flash "..."` resulted in:
  ```text
  Error: Cannot initialize gemini-bridge/gemini-3.8-flash: Route.model(openai-compatible-chat) requires an endpoint baseURL — configure it on the route first
  ```
- **Root Cause:**
  `SETUP.md` and `prompts/setup-opencode.md` instructed configuring `~/.config/opencode/opencode.json` as:
  ```json
  {
    "provider": {
      "gemini-bridge": {
        "npm": "@ai-sdk/openai-compatible",
        "baseURL": "http://127.0.0.1:8765/v1",
        "apiKey": "local-bridge",
        "models": { ... }
      }
    }
  }
  ```
  However, in OpenCode's schema (`https://opencode.ai/config.json`), `ProviderConfig` expects `baseURL` and `apiKey` inside an **`options`** object:
  ```json
  {
    "provider": {
      "gemini-bridge": {
        "npm": "@ai-sdk/openai-compatible",
        "options": {
          "baseURL": "http://127.0.0.1:8765/v1",
          "apiKey": "local-bridge"
        },
        "models": { ... }
      }
    }
  }
  ```
- **Resolution:**
  Updated `~/.config/opencode/opencode.json` so `baseURL` and `apiKey` are nested within `"options"`.
  After restarting OpenCode (`opencode service restart`), model execution succeeded immediately.
- **Recommended Documentation Fix in `SETUP.md` and `prompts/setup-opencode.md`:**
  Update the sample configuration block to:
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
            "name": "Gemini 3.8 Flash",
            "tool_call": true,
            "limit": {
              "context": 1048576,
              "output": 65536
            }
          },
          "gemini-2.5-pro": {
            "name": "Gemini 2.5 Pro",
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
          }
        }
      }
    }
  }
  ```

---

### Issue 5: OpenCode `provider` Key Deprecation
- **Symptom:**
  In the official OpenCode schema (`https://opencode.ai/config.json`), the top-level property `"provider"` is flagged with `"deprecated": true`. The recommended standard is `"providers"` with `@opencode/ai/providers/openai-compatible`.
- **Recommended Documentation Addition:**
  Provide both format examples in `SETUP.md` for backward and forward compatibility with OpenCode:

  **Modern OpenCode (`providers` format):**
  ```json
  {
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
            "name": "Gemini 3.8 Flash",
            "capabilities": {
              "tools": true
            }
          }
        }
      }
    }
  }
  ```

---

## 📋 Checklist for Future Releases

- [ ] **Code**: Update `bridge-server/src/index.ts` to check `settings.merged.security?.auth?.selectedType` and presence of `oauth_creds.json`.
- [ ] **Docs**: Fix OpenCode JSON snippet in `SETUP.md`, `README.md`, and `prompts/setup-opencode.md` to wrap `baseURL` and `apiKey` inside `"options"`.
- [ ] **Docs**: Add note regarding `opencode service restart` or `opencode reload` after editing configuration.
- [ ] **Build**: Add `--depth 1` to `git submodule update` in `package.json` scripts to minimize clone size for source builds.
