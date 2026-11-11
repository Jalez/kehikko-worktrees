# Worktrees

A [Kehikot](https://github.com/Jalez/kehikko) module: every git worktree of your projects, what each
takes on the disk and where its pull request stands, removed by itself once its work is merged — and,
while it is on a kehikko, agent sessions kept working in worktrees.

## What it shows

Three shadcn charts (Recharts, through `kehikot-module-protocol/client/ui/chart`):

- **By project** (or by repository): the disk worktrees take, stacked reclaimable, kept and active.
- **Reclaimable**: a doughnut of reclaimable (merged and safe), kept and active.
- **Biggest**: the largest worktrees.

A short container shows the three tiles as words and one thin bar; a tall one adds the list of every
worktree. The footer says `N worktrees · X GB · Y GB reclaimable`, with **Clean up merged** beside it.

## The cleanup

A worktree is removed (by itself when **Clean up merged worktrees automatically** is on, the default,
or on **Clean up merged**) only when its pull or merge request is merged, its HEAD is contained in the
merged target (`git merge-base --is-ancestor`), it has no uncommitted or untracked changes (ignored
files do not count), no unpushed commits, is not locked, and no process — an agent session above all —
has its working directory inside it. Then `git worktree remove` (never `--force`, never `rm`) and
`git branch -D` for its local branch. A main checkout is never touched; a remote branch is never
deleted. Every removal is logged in `~/Library/Application Support/Kehikot/worktrees/removed.jsonl`.

## Guards

On a kehikko it is placed on, it declares (protocol 2.78.0):

- an **edit guard** refusing file edits in a repository's main checkout and under Kehikot's installed
  modules, with how to make a worktree;
- a **shell guard** refusing `bun run register`.

## Working on it

```
bun install
bun test && bun run typecheck
bun run check:rows
./run.sh            # on PREFERRED_PORT (8150), or $PORT
```
