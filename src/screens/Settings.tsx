import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { GroupModules, ModuleName, MyGroup } from '../types'
import { errMsg, money } from '../lib/format'
import '../suivi.css'

const MODULES: ModuleName[] = ['annonces', 'cotisations', 'rappels', 'prets']

const TXT = {
  fr: {
    title: 'Cotisation mensuelle',
    intro: "Active le suivi mois par mois dans l'onglet Suivi. Laissez le montant vide pour le désactiver.",
    expected: 'Montant attendu par mois',
    initial: 'Apport initial (facultatif)',
    start: 'Premier mois du suivi',
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
    title: 'Monthly contribution',
    intro: 'Turns on month-by-month tracking in the Overview tab. Leave the amount empty to turn it off.',
    expected: 'Amount expected per month',
    initial: 'Initial contribution (optional)',
    start: 'First month of tracking',
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

function toNumber(s: string): number {
  return Number(s.trim().replace(/\s/g, '').replace(',', '.'))
}

export function Settings({ group, modules, reloadModules, reloadGroups }: { group: MyGroup; modules: GroupModules; reloadModules: () => Promise<void>; reloadGroups: () => Promise<void> }) {
  const { t, locale } = useI18n()
  const tx = TXT[locale]
  const gid = group.group_id
  const g = group.group
  const configured = Boolean(Number(g.expected_amount ?? 0) > 0 && g.start_month)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
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

  const loc = locale === 'en' ? 'en' : 'fr'
  const startLabel = g.start_month
    ? (() => {
        const [y, m] = g.start_month.split('-').map(Number)
        const s = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(new Date(y ?? 2000, (m ?? 1) - 1, 1))
        return s
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

      <section className="card">
        <h3>{t('setModules')}</h3>
        {MODULES.map((m) => (
          <label key={m} className="check">
            <input type="checkbox" checked={modules[m]} onChange={(e) => void setModule(m, e.target.checked)} />
            {t(`mod_${m}`)}
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
              <input type="month" value={start} onChange={(e) => setStart(e.target.value)} />
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

      <section className="card">
        <label className="field">
          <span>{t('setLoanMode')}</span>
          <select value={g.loan_decision_mode} onChange={(e) => void setField('loan_decision_mode', e.target.value)}>
            <option value="vote_tous">{t('mode_vote_tous')}</option>
            <option value="responsables">{t('mode_responsables')}</option>
          </select>
        </label>
      </section>

      <section className="card">
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
    </div>
  )
}
