# Agent Instructions — `pascalorg/editor`

Public, open-source home of `@pascal-app/{core,viewer,editor,mcp}` and the standalone editor app. Consumed both as npm packages and (in `pascalorg/private-editor`) as a git submodule.

## Repo Shape

| Path | Purpose |
|---|---|
| `packages/core` | Scene graph, node schemas, stores, event bus, core systems — pure logic, no Three.js |
| `packages/viewer` | Standalone 3D canvas: renderers, viewer systems, presentation state |
| `packages/editor` | Editor UI components reused by the standalone app and embedders |
| `packages/mcp` | MCP server and scene storage adapters |
| `packages/nodes` | Node kind definitions (one folder per kind: wall, door, roof, …) registered with `nodeRegistry` |
| `packages/plugin-trees` | First-party plugin (procedural trees/flowers/grass) — the worked example for the plugin contract |
| `packages/ui` | Shared UI components |
| `apps/editor` | Standalone editor app — composes `viewer` + `editor` + tools |
| `apps/ifc-converter`, `packages/ifc-converter` | IFC → Pascal scene conversion app and library |

## Commands

Bun 1.3+ is the package manager; Turborepo orchestrates builds. Run everything from the repo root.

```bash
bun install
bun dev                # build core/viewer in watch mode + Next.js editor on http://localhost:3002
bun build              # turbo run build (all packages)
turbo build --filter=@pascal-app/core   # build one package

bun check              # Biome lint + format check
bun check:fix          # auto-fix lint + format
bun check-types        # TypeScript type checking (turbo run check-types)

bun test                                       # run all tests (Bun test runner)
bun test packages/editor/src/lib/measurements.test.ts   # run a single test file
bun test -t "name pattern"                     # filter by test name
```

`bun dev` must run from the root so the package watchers rebuild `packages/*` on edit — running `next dev` inside `apps/editor` alone won't pick up package changes. Tests live next to source as `*.test.ts` and need no running server. Before submitting: `bun check` and `bun check-types` must pass.

## Where to look

- **Architecture rules** — `wiki/architecture/` (read on demand; index in `wiki/architecture/README.md`).
- **Skills (ready workflows)** — `.agents/skills/<name>/SKILL.md`. Same content is reachable as `.claude/skills/`, `.cursor/skills/`, `.codex/skills/` (symlinks to `.agents/skills/`).
- **Repo orientation for humans** — `README.md`, `SETUP.md`, `CONTRIBUTING.md`.

`CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` are symlinks to this file. Codex reads this file directly.

## Layer Boundaries (read once, internalise)

- **`packages/core`** owns domain data and pure logic. It must not import Three.js, `packages/viewer`, `apps/editor`, rendering/UI concepts, tools, modes, phases, or view-specific concepts such as floorplan or paint preview.
- **`packages/viewer`** owns the standalone 3D canvas, renderers, viewer systems, and genuine presentation state. It must not know about `useEditor`, editor tools, phases, modes, paint mode, floorplan state, or editor-only presentation vocabulary.
- **`apps/editor`** owns the editing experience: tools, `useEditor`, panels, floorplan helpers, paint mode, keyboard shortcuts, command palette, action menus, cursor badges, and editor-only overlays. Editor features are injected into `<Viewer>` via props and children.

Details, examples, and rationale live in `wiki/architecture/layers.md`, `wiki/architecture/viewer-isolation.md`, `wiki/architecture/systems.md`, `wiki/architecture/renderers.md`, `wiki/architecture/tools.md`.

## When making architecture-sensitive changes

Read the relevant page in `wiki/architecture/` **before** writing code. The page list lives in `wiki/architecture/README.md`. As a minimum:

- Adding a node type / kind → `node-definitions.md` (the registry `geometry` / `renderer` / `system` composition model), `node-schemas.md`, `renderers.md`, `systems.md`
- Adding a tool → `tools.md`, `spatial-queries.md`, `events.md`
- Adding / changing a placement or move interaction → `tools.md` ("2D ↔ 3D behavioral parity": applicable behaviors must exist in both views; port the change to the sibling 2D/3D file in the same PR)
- Adding a system → `systems.md`, `scene-registry.md`
- Anything in `packages/viewer` → `viewer-isolation.md`, `layers.md`
- Anything touching selection → `selection-managers.md`, `scene-registry.md`, `events.md`

## When reviewing a PR

Invoke the `review-architecture` skill (`.agents/skills/review-architecture/SKILL.md`). It loads the required architecture pages, fetches the diff, classifies each new file by layer, and reports findings grouped by severity.

## Operating rules

- Read the full file before editing. Plan all changes, then make one complete edit.
- When the user corrects you, stop and re-read their message.
- After two consecutive tool failures, stop and change approach.
- Don't introduce backwards-compatibility shims, dead code, or speculative abstractions.
- Don't write new comments unless they explain a non-obvious *why*.
