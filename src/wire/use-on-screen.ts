import { useEffect, useState } from 'react'

/**
 * Whether this page is in front of the person: the host has it on screen (`kehikot.visible`,
 * protocol 2.45.0; a host before it says nothing, which is shown) and the window it is in is not
 * hidden or minimised (`document.hidden`).
 *
 * Worktrees' page reads its own server's scan while it is on screen, and nothing while it is not.
 */
export function onScreen(visible: boolean | undefined, hidden: boolean): boolean {
  return visible !== false && !hidden
}

const documentHidden = (): boolean => typeof document !== 'undefined' && document.hidden

export function useOnScreen(visible: boolean | undefined): boolean {
  const [hidden, setHidden] = useState(documentHidden)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const changed = () => setHidden(documentHidden())
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  return onScreen(visible, hidden)
}
