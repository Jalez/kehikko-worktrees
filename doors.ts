import { spawn } from 'node:child_process'

import { askHost, establishBuild, mintTicket, refuseTicket, watchKnownProjects, type Reply } from 'kehikot-module-protocol/serve'

import { ID, MANIFEST, VERSION } from './manifest.ts'
import { agoSaid, bytesSaid, changeSaid, readoutSaid, totalsOf, type State } from './worktrees/rule.ts'
import { Scanner } from './worktrees/scan.ts'

/**
 * Every door but the page, as one function: `answer` takes a request and returns a status and a body,
 * or `null` for "not ours". `doors()` on Vite and `run()` built mount the same function.
 *
 * The page's writes (`/api/here`, `/api/scan`, `/api/clean`, `/api/remove`, `/api/prune`,
 * `/api/open`, `/api/auto`) carry the page's ticket. `/mcp` is read-only: an agent can list the
 * worktrees, never remove one.
 */

export const TICKET = mintTicket()
export const BUILD = establishBuild({ version: VERSION, dir: import.meta.dirname })

/** Which paths are this module's doors rather than Vite's files. */
export const ours = (path: string): boolean => path === '/healthz' || path === '/mcp' || path.startsWith('/api/')

/** The one scanner of this process, made on first use. The tests put their own. */
export const SERVER: { scanner: Scanner | null; open: (path: string) => void } = {
  scanner: null,
  open: (path) => {
    const program = process.platform === 'darwin' ? 'open' : 'xdg-open'
    try {
      spawn(program, [path], { stdio: 'ignore', detached: true }).unref()
    } catch {
      /* nothing to open with */
    }
  },
}

export function scanner(): Scanner {
  if (SERVER.scanner) return SERVER.scanner
  const made = new Scanner({
    moduleId: ID,
    tell: async (project, place, text) => {
      await askHost('messages.tell', { to: { place }, body: text, kind: 'note' }, { module: ID, project })
    },
  })
  SERVER.scanner = made
  made.start()
  /* The projects it was shown before a restart, as the host remembers them (protocol 2.76.0). */
  watchKnownProjects({ module: ID, know: (path) => made.know(path) }).start()
  return made
}

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })

/* ------------------------------------------------------------------ *
 * The MCP door, for agents: one read-only tool.
 * ------------------------------------------------------------------ */

export function tools() {
  return [
    {
      name: 'worktrees',
      description:
        'Every git worktree of the projects Worktrees knows on this computer: its repository, branch, folder, size on the disk, pull or merge request (open, merged, closed or none), uncommitted or unpushed work, '
        + 'whether a running agent session works in it, and whether it is reclaimable (would be removed by the cleanup), kept (and why) or active. '
        + 'Use it before making a worktree, to find one for a branch, or when asked what takes the disk. Read-only: removing is the person’s.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Only this project folder (absolute). Default: every project.' },
          group: { type: 'string', enum: ['reclaimable', 'kept', 'active'], description: 'Only worktrees in this group.' },
        },
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
  ]
}

/** The answer to `worktrees`, as lines. Pure. */
export function worktreesSaid(state: State, args: Record<string, unknown>, now: number): string {
  let rows = state.rows
  if (typeof args.project === 'string' && args.project) rows = rows.filter((row) => row.project === args.project || row.repo.startsWith(`${args.project}/`) || row.repo === args.project)
  if (typeof args.group === 'string') rows = rows.filter((row) => row.group === args.group)
  const totals = totalsOf(state.rows)
  const lines = [
    state.at === null ? 'Worktrees has not finished its first scan yet.' : `${readoutSaid(totals)}. Last scanned ${agoSaid(state.at, now)}. Automatic cleanup is ${state.auto ? 'on' : 'off'}.`,
  ]
  if (!state.projects.length) lines.push('No project is known yet: open Worktrees on a kehikko in a project.')
  for (const row of rows.slice(0, 200)) {
    const work = [row.dirty ? `${row.dirty} changed` : '', row.untracked ? `${row.untracked} untracked` : '', row.unpushed ? `${row.unpushed} unpushed` : ''].filter(Boolean).join(', ')
    const busy = row.busy ? (row.busy.agent ? `, an agent session (${row.busy.command}) works in it` : `, ${row.busy.command} works in it`) : ''
    const group = row.group === 'kept' ? `kept: ${row.kept}` : row.group
    lines.push(`- ${row.branch ?? '(detached)'} — ${row.path} — ${bytesSaid(row.bytes)} — ${changeSaid(row.change)}${work ? ` — ${work}` : ''}${busy} — ${group}; last activity ${agoSaid(row.changedAt, now)}`)
  }
  if (rows.length > 200) lines.push(`… and ${rows.length - 200} more.`)
  for (const note of state.notes) lines.push(`Note: ${note}`)
  return lines.join('\n')
}

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

function mcp(rpc: Rpc): Reply {
  const reply = (result: unknown) => ok({ jsonrpc: '2.0', id: rpc.id ?? null, result })
  const text = (said: string, isError = false) => reply({ content: [{ type: 'text', text: said }], ...(isError ? { isError } : {}) })
  if (rpc.method === 'initialize') {
    return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: ID, version: VERSION }, instructions: MANIFEST.mcp?.about ?? '' })
  }
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) return { status: 202, body: null }
  if (rpc.method === 'tools/list') return reply({ tools: tools() })
  if (rpc.method === 'tools/call') {
    const name = String(rpc.params?.name ?? '')
    if (name !== 'worktrees') return text(`There is no tool "${name.slice(0, 60)}" here. This door has worktrees.`, true)
    const args = rpc.params?.arguments
    return text(worktreesSaid(scanner().state(), args && typeof args === 'object' ? args : {}, Date.now()))
  }
  return { status: 404, body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } } }
}

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const KEY = /^[A-Za-z0-9_-]{1,64}$/

export async function answer(method: string, path: string, _query: URLSearchParams, body: Record<string, unknown> | null, ticket: string | null): Promise<Reply | null> {
  if (path === '/healthz') return ok({ ok: true, id: ID, version: VERSION })

  if (path === '/mcp') {
    if (method !== 'POST') return bad('The MCP door takes POST.', 405)
    if (!body || typeof body.method !== 'string') return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    return mcp(body as Rpc)
  }

  if (path === '/api/state') {
    if (method !== 'GET') return bad('The state is read with GET.', 405)
    return ok(scanner().state())
  }

  if (!path.startsWith('/api/')) return null
  if (method !== 'POST') return bad('Not here.', 404)
  const refused = refuseTicket(ticket, TICKET)
  if (refused) return refused
  const s = scanner()

  if (path === '/api/here') {
    const project = body?.project
    if (typeof project !== 'string' || !project.startsWith('/') || project.length > 4096) return bad('A project is its absolute folder.')
    const epic = typeof body?.epic === 'string' && SLUG.test(body.epic) ? body.epic : undefined
    const kehikko = typeof body?.kehikko === 'string' && KEY.test(body.kehikko) ? body.kehikko : undefined
    s.know(project, { ...(epic ? { epic } : {}), ...(kehikko ? { kehikko } : {}) })
    return ok({ ok: true })
  }
  if (path === '/api/scan') {
    void s.scan({ force: true }).catch(() => null)
    return ok({ ok: true })
  }
  if (path === '/api/clean') return ok({ ok: true, ...(await s.cleanMerged('person')) })
  if (path === '/api/remove') {
    const target = body?.path
    if (typeof target !== 'string' || !target.startsWith('/')) return bad('A removal names the worktree’s folder.')
    const done = await s.remove(target, 'person')
    return done.ok ? ok({ ok: true, removal: done.removal }) : ok({ ok: false, error: done.why })
  }
  if (path === '/api/prune') return ok({ ok: true, ...(await s.prune()) })
  if (path === '/api/open') {
    const target = body?.path
    if (typeof target !== 'string' || !s.listed(target)) return bad('Only a worktree the last scan found can be opened.')
    SERVER.open(target)
    return ok({ ok: true })
  }
  if (path === '/api/auto') {
    if (typeof body?.on !== 'boolean') return bad('The automatic cleanup is on or off.')
    s.setAuto(body.on)
    return ok({ ok: true })
  }
  return bad('Not here.', 404)
}

export { MANIFEST }
