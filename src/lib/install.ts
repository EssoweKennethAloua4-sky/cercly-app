import { useEffect, useState } from 'react'

// Evenement Chrome/Android/Edge qui permet d'afficher la fenetre « Installer l'application ».
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Le navigateur envoie l'evenement une seule fois, souvent avant l'ouverture des Reglages :
// on le garde des le chargement de l'app (ce module est importe dans main.tsx).
let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((f) => f())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as InstallPromptEvent
  notify()
})
window.addEventListener('appinstalled', () => {
  deferred = null
  notify()
})

function standalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export type InstallState = 'installed' | 'prompt' | 'ios' | 'manual'

export function useInstall(): { state: InstallState; install: () => Promise<void> } {
  const [, setTick] = useState(0)
  useEffect(() => {
    const f = () => setTick((x) => x + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const state: InstallState = standalone() ? 'installed' : deferred ? 'prompt' : ios ? 'ios' : 'manual'

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    deferred = null
    notify()
  }

  return { state, install }
}
