# Contributing to Gemini CLI OpenAI Bridge

Thank you for your interest in contributing to `@migueldsbatista/gemini-cli-openai-bridge`!

## Overview & Architecture

This repository wraps the official [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) as a git submodule located at `gemini-cli/`.

The bridge itself is maintained in the `bridge-server/` directory in the repository root. During the build process, `bridge-server/` is ported into `gemini-cli/packages/bridge-server` and compiled as a workspace package within the Gemini CLI monorepo. This allows the bridge to integrate directly with Gemini CLI's internal authentication, session management, and execution engine while maintaining a modular structure.

When developing or submitting pull requests:
- Edit bridge source files inside `bridge-server/` (do **not** edit directly inside `gemini-cli/packages/bridge-server/`, as changes there will be overwritten by `npm run port`).
- If you update the `gemini-cli` submodule, ensure that the submodule reference commit and compatibility are verified.

---

## 🧪 Testing & Development

### Setting Up the Environment

Ensure git submodules are initialized and dependencies installed:

```bash
git clone --recurse-submodules https://github.com/msb7-jpg/gemini-cli-openai-bridge.git
cd gemini-cli-openai-bridge
npm run install
```

If you already cloned without submodules:
```bash
git submodule update --init --recursive
npm run install
```

### Development Cycle & Rebuilding

After modifying files in `bridge-server/`, synchronize the package into the `gemini-cli` monorepo and rebuild:

```bash
npm run port
npm run build
```

Alternatively, `npm run build` runs `prepare` (which executes `install`, `port`, and `compile`).

To link the local build globally for testing with AI agents:
```bash
npm run link
```

### Running Tests

Run the test suite using Vitest within the Gemini CLI workspace:

```bash
npm test
```

### Packaging & Distribution

Create a distribution tarball for testing:
```bash
npm run pack:bridge-server
```

Publish to npm registry (maintainers):
```bash
npm run publish:bridge-server
```

---

## Contribution Guidelines

1. **Fork and Branch**: Create a feature branch from `main`.
2. **Make Changes**: Implement your changes in `bridge-server/` or root configuration files.
3. **Verify**: Run `npm run port`, `npm run build`, and `npm test` to ensure tests pass and build succeeds cleanly.
4. **Pull Request**: Open a PR with a clear description of the problem solved and changes made.
