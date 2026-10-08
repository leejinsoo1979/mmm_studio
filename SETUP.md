# Pascal Editor — Setup

## Prerequisites

- [Bun](https://bun.sh/) 1.3+ (or Node.js 18+)

## Quick Start

```bash
bun install
bun dev
```

The editor will be running at **http://localhost:3000**.

## Environment Variables (optional)

Copy `.env.example` to `.env` if you need:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | No | Enables address search in the editor |
| `PORT` | No | Dev server port (default: 3000) |

The editor works fully without any environment variables.

## Monorepo Structure

```
├── apps/
│   └── editor/          # Next.js editor application
├── packages/
│   ├── core/            # @pascal-app/core — Scene schema, state, systems
│   ├── viewer/          # @pascal-app/viewer — 3D rendering
│   └── ui/              # Shared UI components
└── tooling/             # Build & release tooling
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun dev` | Start the development server |
| `bun build` | Build all packages |
| `bun check` | Lint and format check (Biome) |
| `bun check:fix` | Auto-fix lint and format issues |
| `bun check-types` | TypeScript type checking |

## When the Dev Server Dies

The editor's `dev` script runs `next dev` under `apps/editor/scripts/dev-supervisor.ts`. When the
server process dies (out of memory, killed by the OS, a native crash), `next dev` itself neither
restarts nor reports it; the supervisor prints a `[개발 서버 감시]` line and starts it again with
backoff. After five deaths in ten minutes it stops and prints what to try. Only a refused
connection, after the port had been open, counts as death; slow answers during long compiles do
not. A process that already listens on the port is left alone and waited out. Stop with Ctrl+C:
`bun kill` alone is now undone by a restart.

Next restarts its dev server once the JS heap passes 80% of its limit, but only checks when an
HTTP request completes, which open scene event streams never do. `apps/editor/instrumentation.ts`
checks on a timer in the dev server and asks for the same restart (`[힙 감시]`). It never runs in
`next start` or the desktop app's standalone server.

| Variable | Default | Description |
|----------|---------|-------------|
| `EDITOR_DEV_HEAP_RESTART_RATIO` | `0.8` | Heap fraction that triggers the clean restart; a low value such as `0.05` makes it fire for testing |
| `DEV_SUPERVISOR_REFUSED_MS` | `30000` | How long the port may refuse connections while `next dev` still runs |
| `DEV_SUPERVISOR_MAX_RESTARTS` | `5` | Restarts allowed within `DEV_SUPERVISOR_WINDOW_MS` (default `600000`) |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on submitting PRs and reporting issues.
