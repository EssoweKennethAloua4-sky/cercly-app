import type { ReactNode } from 'react'

export type IconName = 'ann' | 'cot' | 'overview' | 'loans' | 'members' | 'settings' | 'bell'

// Icones dessinees en SVG directement dans le code : aucun fichier externe.
const ICONS: Record<IconName, ReactNode> = {
  ann: (
    <>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M15 9a4 4 0 0 1 0 6" />
      <path d="M18 6a8 8 0 0 1 0 12" />
    </>
  ),
  cot: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  overview: <path d="M5 20V10M12 20V4M19 20v-7" />,
  // main ouverte qui tend une piece : un pret, pas un stockage
  loans: (
    <>
      <circle cx="15" cy="6.5" r="3.5" />
      <path d="M2 14h3l4.5-1.5c1-.3 2 .4 2 1.4 0 .7-.5 1.3-1.2 1.5L8 16" />
      <path d="M11 15.5l5.5-2c1-.4 2 .3 2 1.3 0 .6-.4 1.2-1 1.4L10 19H5H2" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14.3c2.2.6 3.5 2.3 3.5 5.7" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
}

export function Icon({ name, className = 'ico' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  )
}

// Ecran vide : une icone, une phrase, et ce que la personne peut faire ensuite.
// compact : version en ligne, pour les sous-listes (ex. « A traiter » dans Cotiser).
export function Empty({ icon, title, text, compact, children }: { icon: IconName; title: string; text?: string; compact?: boolean; children?: ReactNode }) {
  const body = (
    <>
      <strong>{title}</strong>
      {text && <p className="small">{text}</p>}
      {children}
    </>
  )
  return (
    <div className={`card empty ${compact ? 'compact' : ''}`}>
      <span className="empty-ico">
        <Icon name={icon} />
      </span>
      {compact ? <div>{body}</div> : body}
    </div>
  )
}
