# Agent Ops

Local control plane for nightly and weekly agent automations.

This first version is intentionally small:

- task registry in `config/tasks.json`
- run records in `data/runs/<run-id>/run.json`
- stdout and stderr capture per run
- artifacts written into each run directory
- local dashboard with `npm run serve`

The platform orchestrates tasks and records evidence. Business logic stays in the source projects or in small task scripts.

## Commands

```bash
npm run list
npm run run -- content-sync
npm run run -- lead-radar
npm run run:due
npm run review -- <run-id> approved
npm run dashboard:html
npm run launchd:generate
npm run launchd:serve
npm run tunnel:check
npm run serve
```

Dashboard:

```text
http://localhost:4179
```

Authentication:

- `ops.2aran.com` first reuses the shared `tuaran_session` owner session from `2aran.com`.
- The service must run with the same `NEXTAUTH_SECRET` as `tuaran-home-page` so it can verify that session.
- If the shared session is unavailable, the local `data/auth.json` token remains as a fallback login method.

If local port listening is blocked, render a static dashboard:

```bash
npm run dashboard:html
open data/dashboard.html
```

## First Tasks

- `content-sync`: scans `tuaran-home-page/research/**` and prepares a Syncblog review queue.
- `blogger-metrics`: summarizes existing Blogger Alliance metric exports.
- `lead-radar`: creates a nightly potential customer list.
- `employeehub-evolve`: inspects EmployeeHub and proposes safe next evolution tasks.
- `openclaw-issue-scan`: disabled by default because it needs GitHub network access.

## Safety Rules

- No task publishes content by default.
- No task commits code by default.
- Outputs go to `data/runs/<run-id>/`.
- Anything marked `pending_review` requires human review before use.

## Cloudflare Tunnel

Target hostname:

```text
ops.2aran.com
```

Deployment guide:

[cloudflare/README.md](cloudflare/README.md)
