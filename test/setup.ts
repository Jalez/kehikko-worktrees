import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* A document for the tests that render one; the pure tests do not care. */
GlobalRegistrator.register()

/* No test reaches this computer's real Worktrees folder. */
process.env.KEHIKOT_WORKTREES_DIR = mkdtempSync(join(tmpdir(), 'worktrees-machine-'))
