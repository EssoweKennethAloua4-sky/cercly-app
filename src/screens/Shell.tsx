import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { GroupModules, Locale, Membership, ModuleName, MyGroup } from '../types'
import { Logo } from '../components/Logo'
import { LangSwitch } from '../components/LangSwitch'
import { NotificationsPanel } from '../components/Notifications'
import { Announcements } from './Announcements'
import { Contributions } from './Contributions'
import { Overview } from './Overview'
import { Members } from './Members'
import { CreateGroup } from './CreateGroup'
import { Loans } from './Loans'
import { Settings } from './Settings'

type Tab = 'ann' | 'cot' | 'overview' | 'loans' | 'members' | 'settings'

const NO_MODULES: GroupModules = { annonces: true, cotisations: true, rappels: false, prets: false }

// Icones dessinees en SVG directement dans le code : aucun fichier externe.
const ICONS: Record<Tab, ReactNode> = {
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
  loans: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
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
}

function Icon({ tab }: { tab: Tab }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[tab]}
    </svg>
  )
}

export function Shell({ userId, groups, reload }: { userId: string; groups: MyGroup[]; reload: () => Promise<void> }) {
  const { t, setLocale } = useI18n()
  const [activeId, setActiveId] = useState(() => localStorage.getItem('cercly.group') ?? '')
  const active = groups.find((g) => g.group_id === activeId) ?? groups[0]
  const gid = active.group_id
  const [tab, setTab] = useState<Tab>('ann')
  const [members, setMembers] = useState<Membership[]>([])
  const [creating, setCreating] = useState(false)
  const [bell, setBell] = useState(false)
  const [unread, setUnread] = useState(0)
  const [modules, setModules] = useState<GroupModules>(NO_MODULES)

  const loadMembers = useCallback(async () => {
    const { data } = await supabase
      .from('memberships')
      .select('group_id,user_id,display_name,is_president,can_validate,can_publish,status')
      .eq('group_id', gid)
      .eq('status', 'active')
      .order('display_name')
    setMembers((data ?? []) as Membership[])
  }, [gid])

  const loadModules = useCallback(async () => {
    const { data } = await supabase.from('group_modules').select('module,enabled').eq('group_id', gid)
    const next: GroupModules = { annonces: false, cotisations: false, rappels: false, prets: false }
    for (const r of (data ?? []) as Array<{ module: ModuleName; enabled: boolean }>) next[r.module] = r.enabled
    setModules(next)
  }, [gid])

  const loadUnread = useCallback(async () => {
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', gid)
      .is('read_at', null)
    setUnread(count ?? 0)
  }, [gid])

  useEffect(() => {
    void loadMembers()
    void loadModules()
  }, [loadMembers, loadModules])

  useEffect(() => {
    void loadUnread()
    const timer = window.setInterval(() => void loadUnread(), 30000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadUnread()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadUnread])

  useEffect(() => {
    void supabase
      .from('profiles')
      .select('locale')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data && (data.locale === 'fr' || data.locale === 'en')) setLocale(data.locale as Locale)
      })
  }, [userId, setLocale])

  function selectGroup(id: string) {
    setActiveId(id)
    localStorage.setItem('cercly.group', id)
    setTab('ann')
    setCreating(false)
    setBell(false)
  }

  const go = (k: Tab) => {
    setTab(k)
    setCreating(false)
    setBell(false)
  }

  const role = active.is_president ? 'role_president' : active.can_validate ? 'role_validator' : active.can_publish ? 'role_publisher' : 'role_member'

  const nav: Array<[Tab, string]> = [
    ['ann', 'nav_ann'],
    ['cot', 'nav_cot'],
    ['overview', 'nav_overview'],
  ]
  if (modules.prets) nav.push(['loans', 'nav_loans'])
  nav.push(['members', 'nav_members'])
  nav.push(['settings', 'nav_settings'])
  const current: Tab = nav.some((n) => n[0] === tab) ? tab : 'ann'

  let content
  if (creating)
    content = (
      <CreateGroup
        onCancel={() => setCreating(false)}
        onDone={(id) => {
          void reload().then(() => selectGroup(id))
        }}
      />
    )
  else if (current === 'ann') content = <Announcements group={active} members={members} userId={userId} />
  else if (current === 'cot') content = <Contributions group={active} members={members} userId={userId} />
  else if (current === 'overview') content = <Overview group={active} loansEnabled={modules.prets} onGo={(k) => go(k)} />
  else if (current === 'loans') content = <Loans group={active} members={members} userId={userId} />
  else if (current === 'settings')
    content = <Settings group={active} modules={modules} reloadModules={loadModules} reloadGroups={reload} />
  else content = <Members group={active} members={members} userId={userId} reloadMembers={loadMembers} reloadGroups={reload} />

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <Logo /> <span>{t('appName')}</span>
        </div>
        <nav aria-label="Navigation">
          {nav.map(([k, label]) => (
            <button key={k} className={`nav ${current === k && !creating ? 'on' : ''}`} aria-current={current === k && !creating ? 'page' : undefined} onClick={() => go(k)}>
              <Icon tab={k} />
              <span>{t(label)}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="top">
          <div className="top-left">
            <select aria-label={t('group')} value={gid} onChange={(e) => selectGroup(e.target.value)}>
              {groups.map((g) => (
                <option key={g.group_id} value={g.group_id}>
                  {g.group.name}
                </option>
              ))}
            </select>
            <button className="btn small" onClick={() => setCreating(true)}>
              {t('newGroup')}
            </button>
            <span className="tag">{t(role)}</span>
          </div>
          <div className="top-right">
            <button className="btn small" aria-label={t('notifTitle')} onClick={() => setBell((b) => !b)}>
              {t('notifTitle')}
              {unread > 0 && <b className="count">{unread}</b>}
            </button>
            <LangSwitch onChange={(l) => void supabase.from('profiles').update({ locale: l }).eq('id', userId)} />
            <button className="link" onClick={() => void supabase.auth.signOut()}>
              {t('signOut')}
            </button>
          </div>
          {bell && <NotificationsPanel groupId={gid} currency={active.group.currency} onRead={() => void loadUnread()} />}
        </header>
        <main className="content">{content}</main>
      </div>

      <nav className="bn" aria-label="Navigation">
        {nav.map(([k, label]) => (
          <button key={k} className={current === k && !creating ? 'on' : ''} aria-label={t(label)} aria-current={current === k && !creating ? 'page' : undefined} onClick={() => go(k)}>
            <Icon tab={k} />
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
