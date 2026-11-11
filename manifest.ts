import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'kehikot-module-protocol'

import pkg from './package.json'

/*
 * Who this module is. The id names the folder it keeps its one marker file in
 * (`<project>/.kehikot/worktrees/`), so it never changes.
 */
export const ID = 'kehikot.worktrees'
/** The module's version: package.json's, the one place it is written. A release is tagged with it. */
export const VERSION: string = pkg.version

/**
 * Where this module would like to answer while you run it yourself; a host that installs it hands
 * it a port of its own (`$PORT`). Modules sit ten apart.
 */
export const PREFERRED_PORT = 8150

/** How a worktree is made, said wherever an agent is refused or told. */
export const HOW_TO_WORKTREE = 'git worktree add ../<repo>-worktrees/<branch> -b <branch> origin/main'

/** "How to use" (protocol 2.52.0). Each string one line of plain text. */
export const HELP = {
  summary: 'Every git worktree of your projects, what each takes on the disk and where its pull request stands, removed once its work is merged.',
  sections: [
    {
      title: 'What it shows',
      points: [
        'Three charts: the disk your worktrees take by project or repository, how much of it is reclaimable (merged and safe to remove), kept or active, and the biggest worktrees.',
        'Below them, with room, every worktree: its branch, folder, last activity, size, its pull or merge request (open, merged, closed or none), uncommitted or unpushed work, and whether an agent session works in it.',
        'The footer says how many worktrees there are, what they take and what is reclaimable, with Clean up merged beside it.',
      ],
    },
    {
      title: 'How to use it',
      points: [
        'Clean up merged worktrees automatically (in the header, on unless you turn it off) removes a worktree once its request is merged, its last commit is in the merged branch, it has no changes, nothing unpushed and no session working in it. Anything else is listed as kept, with the reason.',
        'Clean up merged in the footer does the same now. Remove on a row removes that one worktree after you confirm; git refuses one with changes.',
        'Rescan reads every repository again and measures sizes again; Prune makes git forget worktrees whose folders are gone.',
        'Sizes are measured seldom and in the background (through Queue when it is on this computer), never while you wait.',
      ],
    },
    {
      title: 'What agents are held to',
      points: [
        'On a kehikko Worktrees is on, an agent session and its subagents cannot edit files in a project’s main checkout or in an installed module’s folder: they are told to make a worktree instead.',
        'bun run register is refused: what reaches the app is what is merged.',
        'Removing worktrees is yours: agents can read the list, never remove.',
      ],
    },
  ],
}

/**
 * What this module says about itself, parsed when imported: a manifest no host would accept fails
 * here, in a test.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'Worktrees',
  icon: 'lucide:git-branch',
  version: VERSION,
  /* It keeps one marker file per project (`seen.json`); everything else is this computer's. */
  dataVersion: 1,
  summary: 'Every git worktree of your projects with the disk it takes and its pull request, cleaned up once merged, and agents kept working in worktrees.',
  tags: ['worktrees', 'git', 'agents', 'disk'],
  guidance:
    'This kehikko has Worktrees on it: work in a git worktree outside the repository, one branch per task — '
    + `${HOW_TO_WORKTREE} — and never in a project's main checkout or an installed module's folder (edits there are refused). `
    + 'Open a pull request from that branch; once it is merged Worktrees removes the worktree and its local branch by itself. '
    + 'The `worktrees` tool lists every worktree with its size, request and whether it would be removed. Never run `bun run register`.',
  agentSays: `One git worktree outside the repo per task (${HOW_TO_WORKTREE}); edits in main checkouts are refused. It is removed once its PR merges.`,
  absentSays: 'Prefer one git worktree outside the repo per task. If worktrees pile up, suggest adding Worktrees to this kehikko to clean them up after merging.',
  guards: [
    {
      id: 'main-checkout',
      tool: 'edit',
      match: {
        checkouts: ['main'],
        paths: ['~/Library/Application Support/Kehikot/installed/**', '~/.local/share/kehikot/installed/**'],
      },
      action: 'deny',
      why: `Work in a worktree, not a main checkout or an installed module: ${HOW_TO_WORKTREE}, then edit there.`,
    },
    {
      id: 'register',
      tool: 'shell',
      match: { scripts: ['register'] },
      action: 'deny',
      why: 'Never register a checkout: the app runs each module from its installed copy, level with main. Open a pull request instead.',
    },
  ],
  help: HELP,
  entry: '/app',
  modes: [{ id: 'worktrees', label: 'Worktrees', scope: 'machine', scopeSays: 'the worktrees of every project this computer has shown it, whatever is open here' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about: 'Every git worktree of your projects: size, branch, pull request, uncommitted or unpushed work, and whether it would be cleaned up. Read-only.',
  },
  extensions: { emits: [], consumes: [] },
  partless: 'A worktree is a folder on this computer, not a part of an epic: Worktrees shows them all whichever parts are picked.',
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    /*
     * Only what is called:
     * - agents:message — `messages.tell`, telling the sessions at a project's place that a worktree
     *   was removed, and `projects.mine` (protocol 2.77.0), the projects it was shown before a restart.
     * - state:keep — the kept view (protocol 2.70.0): the scroll and the header's switch.
     */
    uses: ['agents:message', 'state:keep'],
    /* It takes writes (remove, clean up, the toggle): framed on its real origin. */
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
