import { useEffect } from 'react'
import { useHost, type Host as ProtocolHost } from 'kehikot-module-protocol/client/react'
import type { HostEvents } from 'kehikot-module-protocol/client'
import { hideTip } from 'kehikot-module-protocol/client/ui/chart'

import { ID } from '../../manifest.ts'

/**
 * What the screen needs from the host: the protocol's `useHost`. A plain object, so a screen renders
 * in a test without a host. The project, epic and kehikko are read only to tell the server which
 * project this page shows (it then scans it) and where its sessions are.
 *
 * The kept view keeps the scroll and the Group switch per container; never the automatic cleanup,
 * which is this computer's setting, kept by the server.
 */
export type Host = Pick<ProtocolHost, 'where' | 'projectPath' | 'theme' | 'header'> &
  Partial<Pick<ProtocolHost, 'kept' | 'remember' | 'footer' | 'drawsFooter' | 'ready' | 'epic' | 'kehikko' | 'visible'>>

export type Live = Host & Pick<ProtocolHost, 'kept' | 'remember' | 'read'>

export function useKehikot(events: HostEvents = {}): Live {
  const host = useHost(ID, events, { keepView: { except: ['auto', 'scan', 'prune'] } })
  /* Off screen: no chart tooltip is left standing for when it comes back. */
  useEffect(() => {
    if (host.visible === false) hideTip()
  }, [host.visible])
  return host
}
