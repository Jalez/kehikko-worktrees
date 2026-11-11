# Worktrees — notes for agents

A Kehikot module. The guide is the protocol's
[Building a module](https://github.com/Jalez/kehikko-protocol/blob/main/docs/building-a-module.md).

## Where things are

| | |
|---|---|
| `manifest.ts` | Who it is, its guards (edit guard on main checkouts and installed modules; `bun run register`), `agentSays`. |
| `worktrees/rule.ts` | THE RULE (reclaimable, kept and why, active) and every sentence. Pure. |
| `worktrees/git.ts` | Reading git, `gh`/`glab`, `lsof`, `du` output. Never changes a repository. |
| `worktrees/scan.ts` | The scan, sizes (throttled, through Queue's CLI when present), removals, the automatic cleanup. |
| `worktrees/machine.ts` | The only writer: the machine folder (settings, sizes, projects, removal log) and one marker per project. |
| `doors.ts` | `/healthz`, `/mcp` (read-only `worktrees`), the page's `/api/*` (writes carry the ticket). |
| `src/` | The page: `header.ts` (both rows), `glance.ts` (chart data), `view/charts.tsx`, `view/list.tsx`. |

## The rules

- **Removal only through `git worktree remove`**, never `--force`, never `rm`; never a main checkout;
  the automatic cleanup re-reads and re-decides each worktree just before removing it.
- **Heavy work off the hot path.** `du` runs in batches, seldom, never on a page's read.
- **Agents never remove.** No MCP tool and no `agents: true` item removes anything.
- **Header sets up, footer reads out** (`kehikot.rows.json`, `bun run check:rows`).
- **Charts are shadcn's**, from `kehikot-module-protocol/client/ui/chart`; tooltips through its `useTip`.
- Storage: `test/storage-boundary.test.ts`.

## Working on it

```
bun test && bun run typecheck && bun run check:rows
```
