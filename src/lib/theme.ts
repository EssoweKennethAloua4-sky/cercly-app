export type Theme = 'light' | 'dark' | 'auto'

const KEY = 'cercly.theme'

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'auto' ? v : 'light'
  } catch {
    return 'light'
  }
}

function resolve(t: Theme): 'light' | 'dark' {
  if (t === 'auto') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return t
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', resolve(t))
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // stockage indisponible (navigation privee) : le choix vaut pour cette session seulement
  }
  applyTheme(t)
}

// Applique le theme des l'ouverture de l'application (clair par defaut).
applyTheme(getTheme())
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getTheme() === 'auto') applyTheme('auto')
})
