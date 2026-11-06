# AGENTS.md

Guidance and standards for AI agents working in this repository.

## Architecture & Layout

- **Framework**: Fastify 5 + Zod type provider (`fastify-type-provider-zod`).
- **Streaming**: Server-Sent Events (SSE) streaming directly on `reply.raw`.
- **Test Co-location**: Tests must ALWAYS live in co-located `__tests__/` directories next to the implementation (e.g. `<feature>/__tests__/<feature>.test.ts`).

## Quality Standards

- **TSDoc / JSDoc**: Mandatory docstrings on all exported functions with `@param` and `@returns`.
- **Identifier Clarity**: No single-letter variable names. Only exceptions: `i`, `j`, `e`, `err`, `_`.
- **Complexity Limits**: Keep functions small and modular. Enforced by oxlint (`complexity: 60`, `max-lines: 800`, `max-lines-per-function: 260`, `max-depth: 6`, `max-params: 8`).
- **Schema Validation**: Zod 4 `z.looseObject()` on incoming payloads to tolerate client-specific vendor fields.
- **Strict Typing & Hygiene**: Zero loose `any` (use `unknown` or explicit interfaces) and zero dead imports/variables.

## Workflow & Commands

- **Build / Mirror**:
  - `bridge-server/` is the source of truth.
  - `npm run build` runs `port` which mirrors `bridge-server/` into `gemini-cli/packages/bridge-server/`.
  - **Always edit `bridge-server/` directly**, never edit files inside `gemini-cli/packages/bridge-server/`.
- **Hygiene & Verification Checks**:
  - `npm run lint` — Runs `oxlint` with `.oxlintrc.json` against `bridge-server/src`.
  - `npm run lint:fix` — Runs `oxlint --fix` against `bridge-server/src`.
  - `npm run format` — Runs `oxfmt` against `bridge-server/src`.
  - `npm run format:check` — Verifies code formatting with `oxfmt --check`.
  - `npm run fallow` — Checks dead code, duplication, and maintainability.
  - `npm test` — Executes unit and integration test suite via Vitest.
  - `npm run check` — Full pipeline check (`lint` + `format:check` + `fallow` + `test`).

## Future Roadmap & Technical Debt

See `docs/migrations/architecture-and-layering-roadmap.md` for details:
- **Vertical Slice Architecture**: Feature slices (`src/features/*`) backed by a protocol-agnostic Core Engine (`src/core/*`) and stateless shared utilities (`src/shared/*`).
- **Fallow Strictness**: All Fallow rules enabled with practical health and duplication thresholds in `.fallowrc.json`.
- **Zod 4**: `z.looseObject()` and 2-argument `z.record(z.string(), ...)` across all slice schemas.

