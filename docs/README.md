# Documentation — StockPilot

Architecture notes, decisions and how-to guides live here.

## Foundation-stage documents

| Document | Contents |
| --- | --- |
| [`architecture.md`](./architecture.md) | Layering, request lifecycle, module boundaries, scaling path |
| [`getting-started.md`](./getting-started.md) | Prerequisites and step-by-step local run |
| [`../database/README.md`](../database/README.md) | Migration workflow, env vars, rollback, troubleshooting |
| [`../database/migrations/README.md`](../database/migrations/README.md) | Migration file conventions and rules |
| [`../README.md`](../README.md) | Project overview and roadmap |
| [`../.github/workflows/README.md`](../.github/workflows/README.md) | What CI checks, and what is deliberately excluded |

## Conventions

- Markdown, one topic per file, `kebab-case` filenames.
- Diagrams in Mermaid so they render on GitHub without extra tooling.
- Record significant technical decisions as short ADRs under `docs/adr/`
  (`0001-<slug>.md`) once the first one is needed.
- Docs describe **what is true today**. Planned work belongs in the roadmap
  section of the root README, clearly marked as not yet built.
