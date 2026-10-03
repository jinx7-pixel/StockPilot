# GitHub Actions — placeholder

CI/CD pipelines for StockPilot will live here as
`workflows/<workflow-name>.yml`.

**This directory is intentionally empty at the foundation stage.** No
deployment workflow has been written yet, because a real workflow must run
against real build and test scripts, real secrets, and a real deployment
target — none of which exist yet.

Planned workflows, to be added one at a time:

| Workflow file | Trigger | Job | Not implemented because |
| --- | --- | --- | --- |
| `ci.yml` | push / pull request | install → lint → typecheck → build (frontend + backend) | reserved; no product code to test yet |
| `docker.yml` | tag / release | build & push `frontend` / `backend` images | no Dockerfiles yet |
| `deploy.yml` | release or manual | deploy to target environment | no target environment chosen yet |

Each workflow will:

- use pinned action versions and least-privilege `permissions:` blocks,
- pull runtime configuration from repository **secrets** (never hard-coded),
- read `.env.example` files as the contract for required variables, and
- be verified locally before it is added here.

`.github/workflows/` is committed; GitHub only runs workflows pushed to the
default branch.
