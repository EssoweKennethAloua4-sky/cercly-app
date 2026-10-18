import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { GroupModules, ModuleName, MyGroup } from '../types'
import { errMsg, money } from '../lib/format'
import { getTheme, setTheme, type Theme } from '../lib/theme'
import { LangSwitch } from '../components/LangSwitch'
import { useInstall } from '../lib/install'
import { MIXX_BY_YAS, parseFeeTable, type FeeTier } from '../lib/fees'
import '../suivi.css'

const MODULES: ModuleName[] = ['annonces', 'cotisations', 'rappels', 'prets']
const THEMES: Theme[] = ['light', 'dark', 'auto']

const TXT = {
  fr: {
    account: 'Mon compte',
    app: 'Application',
    appPrompt: "Installez Cercly sur cet appareil : une icône sur l'écran d'accueil, en plein écran, comme une vraie application.",
    appInstall: "Installer l'application",
    appIos: "Pour installer Cercly sur votre iPhone : dans Safari, touchez le bouton Partager (carré avec une flèche), puis « Sur l'écran d'accueil ».",
    appManual: "Pour installer Cercly : ouvrez le menu de votre navigateur, puis « Installer l'application » ou « Ajouter à l'écran d'accueil ».",
    groupSection: 'Groupe {name}',
    language: 'Langue',
    newGroupHint: 'Créez un autre groupe dont vous serez président.',
    appearance: 'Apparence',
    themes: { light: 'Clair', dark: 'Sombre', auto: 'Automatique' } as Record<Theme, string>,
    themeHint: 'Le choix est enregistré sur cet appareil. Par défaut : clair.',
    title: 'Cotisation mensuelle',
    intro: "Active le suivi mois par mois dans l'onglet Suivi. Laissez le montant vide pour le désactiver.",
    expected: 'Montant attendu par mois',
    initial: 'Apport initial (facultatif)',
    start: 'Premier mois du suivi',
    chooseMonth: 'Choisir un mois',
    save: 'Enregistrer',
    edit: 'Modifier',
    cancel: 'Annuler',
    badValue: 'Montant invalide.',
    needStart: 'Choisissez le premier mois du suivi.',
    perMonth: '{amount} par mois',
    withInitial: 'apport initial {amount}',
    since: 'depuis {month}',
  },
  en: {
    account: 'My account',
    app: 'App',
    appPrompt: 'Install Cercly on this device: an icon on your home screen, full screen, like a real app.',
    appInstall: 'Install the app',
    appIos: 'To install Cercly on your iPhone: in Safari, tap the Share button (square with an arrow), then "Add to Home Screen".',
    appManual: 'To install Cercly: open your browser menu, then "Install app" or "Add to Home screen".',
    groupSection: 'Group {name}',
    language: 'Language',
    newGroupHint: 'Create another group where you will be president.',
    appearance: 'Appearance',
    themes: { light: 'Light', dark: 'Dark', auto: 'Automatic' } as Record<Theme, string>,
    themeHint: 'Your choice is saved on this device. Default: light.',
    title: 'Monthly contribution',
    intro: 'Turns on month-by-month tracking in the Overview tab. Leave the amount empty to turn it off.',
    expected: 'Amount expected per month',
    initial: 'Initial contribution (optional)',
    start: 'First month of tracking',
    chooseMonth: 'Choose a month',
    save: 'Save',
    edit: 'Edit',
    cancel: 'Cancel',
    badValue: 'Invalid amount.',
    needStart: 'Choose the first month of tracking.',
    perMonth: '{amount} per month',
    withInitial: 'initial contribution {amount}',
    since: 'since {month}',
  },
}

function fill(s: string, v: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '')
}

const FEE_TXT = {
  fr: {
    title: "Frais d'envoi",
    intro: "Si les membres envoient leur cotisation par Mobile Money, ils ajoutent les frais de retrait (ex. 2 600 = 2 500 + 100). L'app retire ces frais pour ne compter que la cotisation.",
    toggle: "Déduire les frais d'envoi",
    upTo: "jusqu'à {max}",
    above: 'au-delà',
    mixx: 'Tarif Mixx by Yas',
    edit: 'Modifier le barème',
    add: 'Ajouter une tranche',
    max: 'Envoi jusqu’à',
    fee: 'Frais',
    remove: 'Retirer',
    save: 'Enregistrer le barème',
    cancel: 'Annuler',
    bad: 'Chaque tranche doit avoir un montant maximum et des frais (0 ou plus).',
  },
  en: {
    title: 'Transfer fees',
    intro: 'If members send their contribution by mobile money, they add the withdrawal fee (e.g. 2,600 = 2,500 + 100). The app removes these fees so only the contribution counts.',
    toggle: 'Deduct transfer fees',
    upTo: 'up to {max}',
    above: 'above',
    mixx: 'Mixx by Yas rates',
    edit: 'Edit the fee table',
    add: 'Add a tier',
    max: 'Sent up to',
    fee: 'Fee',
    remove: 'Remove',
    save: 'Save the fee table',
    cancel: 'Cancel',
    bad: 'Each tier needs a maximum amount and a fee (0 or more).',
  },
}

// Bareme des frais d'envoi du groupe (president) : active/desactive, tarif Mixx by Yas en un clic, ou tranches a la main.
function FeeSettings({ group, onSaved, onError }: { group: MyGroup; onSaved: () => Promise<void>; onError: (m: string) => void }) {
  const { locale } = useI18n()
  const ft = FEE_TXT[locale]
  const cur = group.group.currency
  const table = parseFeeTable(group.group.fee_table)
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<Array<{ max: string; fee: string }>>([])

  async function save(next: FeeTier[] | null) {
    const { error } = await supabase.from('groups').update({ fee_table: next }).eq('id', group.group_id)
    if (error) return onError(errMsg(error))
    setEditing(false)
    await onSaved()
  }

  function startEdit() {
    setRows((table ?? MIXX_BY_YAS).map((t) => ({ max: String(t.max), fee: String(t.fee) })))
    setEditing(true)
  }

  function saveRows() {
    const next = rows.map((r) => ({ max: toNumber(r.max), fee: toNumber(r.fee || '0') }))
    if (next.length === 0 || next.some((t) => !(t.max > 0) || !Number.isFinite(t.fee) || t.fee < 0)) return onError(ft.bad)
    void save(next.sort((a, b) => a.max - b.max))
  }

  return (
    <section className="card">
      <h3>{ft.title}</h3>
      <p className="small">{ft.intro}</p>
      <label className="check switch">
        {ft.toggle}
        <input type="checkbox" role="switch" checked={table !== null} onChange={(e) => void save(e.target.checked ? MIXX_BY_YAS : null)} />
      </label>
      {table && !editing && (
        <>
          <ul className="fee-list">
            {table.map((t) => (
              <li key={t.max}>
                <span>{ft.upTo.replace('{max}', money(t.max, cur, locale))}</span>
                <strong>{money(t.fee, cur, locale)}</strong>
              </li>
            ))}
          </ul>
          <div className="set-actions">
            <button type="button" className="btn small" onClick={startEdit}>
              {ft.edit}
            </button>
            <button type="button" className="btn small" onClick={() => void save(MIXX_BY_YAS)}>
              {ft.mixx}
            </button>
          </div>
        </>
      )}
      {table && editing && (
        <div className="stack">
          {rows.map((r, i) => (
            <div key={i} className="fee-row">
              <label className="field">
                <span>
                  {ft.max} ({cur})
                </span>
                <input inputMode="decimal" value={r.max} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} />
              </label>
              <label className="field">
                <span>
                  {ft.fee} ({cur})
                </span>
                <input inputMode="decimal" value={r.fee} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)))} />
              </label>
              <button type="button" className="btn small danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                {ft.remove}
              </button>
            </div>
          ))}
          <div className="set-actions">
            <button type="button" className="btn small" onClick={() => setRows([...rows, { max: '', fee: '' }])}>
              {ft.add}
            </button>
            <button type="button" className="btn primary" onClick={saveRows}>
              {ft.save}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              {ft.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// Mois proposes pour le debut du suivi : 2 ans en arriere, 1 an en avant (plus la valeur deja enregistree).
// Une liste plutot qu'un <input type="month">, qui s'affiche « ---------- ---- » quand il est vide.
function monthOptions(current: string, loc: string): Array<[string, string]> {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' })
  const out: Array<[string, string]> = []
  for (let i = -24; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = fmt.format(d)
    out.push([v, label.charAt(0).toUpperCase() + label.slice(1)])
  }
  if (current && !out.some(([v]) => v === current)) {
    const [y, m] = current.split('-').map(Number)
    const label = fmt.format(new Date(y ?? 2000, (m ?? 1) - 1, 1))
    out.unshift([current, label.charAt(0).toUpperCase() + label.slice(1)])
  }
  return out
}

function toNumber(s: string): number {
  return Number(s.trim().replace(/\s/g, '').replace(',', '.'))
}

interface Props {
  group: MyGroup
  userId: string
  modules: GroupModules
  reloadModules: () => Promise<void>
  reloadGroups: () => Promise<void>
  onNewGroup: () => void
}

export function Settings({ group, userId, modules, reloadModules, reloadGroups, onNewGroup }: Props) {
  const { t, locale } = useI18n()
  const tx = TXT[locale]
  const gid = group.group_id
  const g = group.group
  const isP = group.is_president
  const configured = Boolean(Number(g.expected_amount ?? 0) > 0 && g.start_month)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  const [theme, setThemeState] = useState<Theme>(getTheme())
  const install = useInstall()
  const [editing, setEditing] = useState(!configured)
  const [expected, setExpected] = useState(g.expected_amount ? String(Number(g.expected_amount)) : '')
  const [initial, setInitial] = useState(g.initial_amount ? String(Number(g.initial_amount)) : '')
  const [start, setStart] = useState(g.start_month ? g.start_month.slice(0, 7) : '')

  async function setModule(m: ModuleName, enabled: boolean) {
    setMsg('')
    setOk(false)
    const { error } = await supabase.from('group_modules').update({ enabled }).eq('group_id', gid).eq('module', m)
    if (error) setMsg(errMsg(error))
    else setOk(true)
    await reloadModules()
  }

  async function setField(field: 'loan_decision_mode' | 'visibility' | 'period', value: string) {
    setMsg('')
    setOk(false)
    const { error } = await supabase.from('groups').update({ [field]: value }).eq('id', gid)
    if (error) setMsg(errMsg(error))
    else setOk(true)
    await reloadGroups()
  }

  async function saveSchedule(e: FormEvent) {
    e.preventDefault()
    setMsg('')
    setOk(false)
    const exp = expected.trim() === '' ? null : toNumber(expected)
    const ini = initial.trim() === '' ? 0 : toNumber(initial)
    if ((exp !== null && (!Number.isFinite(exp) || exp <= 0)) || !Number.isFinite(ini) || ini < 0) {
      setMsg(tx.badValue)
      return
    }
    if (exp !== null && !start) {
      setMsg(tx.needStart)
      return
    }
    const { error } = await supabase
      .from('groups')
      .update({ expected_amount: exp, initial_amount: ini, start_month: start ? `${start}-01` : null })
      .eq('id', gid)
    if (error) {
      setMsg(errMsg(error))
      return
    }
    setOk(true)
    await reloadGroups()
    setEditing(exp === null)
  }

  function cancelEdit() {
    setExpected(g.expected_amount ? String(Number(g.expected_amount)) : '')
    setInitial(g.initial_amount ? String(Number(g.initial_amount)) : '')
    setStart(g.start_month ? g.start_month.slice(0, 7) : '')
    setMsg('')
    setEditing(false)
  }

  function chooseTheme(v: Theme) {
    setTheme(v)
    setThemeState(v)
  }

  const loc = locale === 'en' ? 'en' : 'fr'
  const startLabel = g.start_month
    ? (() => {
        const [y, m] = g.start_month.split('-').map(Number)
        return new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(new Date(y ?? 2000, (m ?? 1) - 1, 1))
      })()
    : ''
  const summary = [
    fill(tx.perMonth, { amount: money(Number(g.expected_amount ?? 0), g.currency, locale) }),
    Number(g.initial_amount ?? 0) > 0 ? fill(tx.withInitial, { amount: money(Number(g.initial_amount), g.currency, locale) }) : '',
    fill(tx.since, { month: startLabel }),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="stack">
      <h2>{t('setTitle')}</h2>
      {msg && <p className="msg">{msg}</p>}
      {ok && <p className="ok-text">{t('setSaved')}</p>}

      <h3 className="set-heading">{tx.account}</h3>

      <section className="card">
        <h3>{tx.appearance}</h3>
        <div className="choices" role="radiogroup" aria-label={tx.appearance}>
          {THEMES.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={theme === v} className={`choice ${theme === v ? 'on' : ''}`} onClick={() => chooseTheme(v)}>
              {tx.themes[v]}
            </button>
          ))}
        </div>
        <p className="small">{tx.themeHint}</p>
      </section>

      {install.state !== 'installed' && (
        <section className="card">
          <h3>{tx.app}</h3>
          {install.state === 'prompt' ? (
            <>
              <p className="small">{tx.appPrompt}</p>
              <button type="button" className="btn primary set-signout" onClick={() => void install.install()}>
                {tx.appInstall}
              </button>
            </>
          ) : (
            <p className="small">{install.state === 'ios' ? tx.appIos : tx.appManual}</p>
          )}
        </section>
      )}

      <section className="card">
        <div className="row between">
          <h3>{tx.language}</h3>
          <LangSwitch onChange={(l) => void supabase.from('profiles').update({ locale: l }).eq('id', userId)} />
        </div>
        <div className="row between wrap">
          <p className="small">{tx.newGroupHint}</p>
          <button type="button" className="btn small" onClick={onNewGroup}>
            {t('newGroup')}
          </button>
        </div>
        <button type="button" className="btn danger set-signout" onClick={() => void supabase.auth.signOut()}>
          {t('signOut')}
        </button>
      </section>

      {isP && (
        <>
          <h3 className="set-heading">{fill(tx.groupSection, { name: g.name })}</h3>

          <section className="card">
            <h3>{t('setModules')}</h3>
            {MODULES.map((m) => (
              <label key={m} className="check switch">
                {t(`mod_${m}`)}
                <input type="checkbox" role="switch" checked={modules[m]} onChange={(e) => void setModule(m, e.target.checked)} />
              </label>
            ))}
          </section>

          {configured && !editing ? (
            <section className="card">
              <div className="row between">
                <div>
                  <h3>{tx.title}</h3>
                  <p className="small set-summary-text">{summary}</p>
                </div>
                <button type="button" className="btn small" onClick={() => setEditing(true)}>
                  {tx.edit}
                </button>
              </div>
            </section>
          ) : (
            <form className="card" onSubmit={saveSchedule}>
              <h3>{tx.title}</h3>
              <p className="small">{tx.intro}</p>
              <div className="set-grid">
                <label className="field">
                  <span>
                    {tx.expected} ({g.currency})
                  </span>
                  <input inputMode="decimal" value={expected} onChange={(e) => setExpected(e.target.value)} />
                </label>
                <label className="field">
                  <span>
                    {tx.initial} ({g.currency})
                  </span>
                  <input inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} />
                </label>
                <label className="field">
                  <span>{tx.start}</span>
                  <select value={start} onChange={(e) => setStart(e.target.value)}>
                    <option value="">{tx.chooseMonth}</option>
                    {monthOptions(start, loc).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="set-actions">
                <button className="btn primary">{tx.save}</button>
                {configured && (
                  <button type="button" className="btn" onClick={cancelEdit}>
                    {tx.cancel}
                  </button>
                )}
              </div>
            </form>
          )}

          <FeeSettings
            group={group}
            onSaved={reloadGroups}
            onError={(m) => {
              setOk(false)
              setMsg(m)
            }}
          />

          <section className="card">
            <h3>{t('setHow')}</h3>
            <label className="field">
              <span>{t('setLoanMode')}</span>
              <select value={g.loan_decision_mode} onChange={(e) => void setField('loan_decision_mode', e.target.value)}>
                <option value="vote_tous">{t('mode_vote_tous')}</option>
                <option value="responsables">{t('mode_responsables')}</option>
              </select>
            </label>
            <label className="field">
              <span>{t('setVisibility')}</span>
              <select value={g.visibility} onChange={(e) => void setField('visibility', e.target.value)}>
                <option value="tous">{t('vis_tous')}</option>
                <option value="soi">{t('vis_soi')}</option>
              </select>
            </label>
            <label className="field">
              <span>{t('setPeriod')}</span>
              <select value={g.period} onChange={(e) => void setField('period', e.target.value)}>
                {['jour', 'semaine', 'mois', 'annee'].map((p) => (
                  <option key={p} value={p}>
                    {t(`per_${p}`)}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </>
      )}
    </div>
  )
}
