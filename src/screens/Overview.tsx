import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { MemberTotal, MyGroup } from '../types'
import { errMsg, money } from '../lib/format'
import { cellOf, cover, monthIndex, parsePlan } from '../lib/schedule'
import { Details } from './Details'
import '../suivi.css'

const fr = {
  upToDate: 'À jour',
  lateTotal: 'Retard cumulé',
  monthly: 'Cotisations mois par mois',
  countHead: 'Payés',
  legend: { paid: 'payé', late: 'en retard', pending: 'à valider', due: 'ce mois-ci', future: 'à venir' },
  setupHint: "Pour activer le suivi mois par mois, indiquez le montant attendu chaque mois dans l'onglet Réglages.",
  prevYear: 'Année précédente',
  nextYear: 'Année suivante',
  openDetails: 'Voir le détail de {name}',
}

type Dict = typeof fr

const en: Dict = {
  upToDate: 'Up to date',
  lateTotal: 'Total overdue',
  monthly: 'Contributions month by month',
  countHead: 'Paid',
  legend: { paid: 'paid', late: 'overdue', pending: 'to review', due: 'this month', future: 'upcoming' },
  setupHint: 'To turn on month-by-month tracking, set the amount expected each month in the Settings tab.',
  prevYear: 'Previous year',
  nextYear: 'Next year',
  openDetails: 'See details for {name}',
}

const TXT = { fr, en }
const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

export function Overview({ group }: { group: MyGroup }) {
  const { t, locale } = useI18n()
  const tx = TXT[locale]
  const loc = locale === 'en' ? 'en' : 'fr'
  const g = group.group
  const cur = g.currency
  const plan = useMemo(() => parsePlan(g), [g])
  const now = new Date()
  const [validated, setValidated] = useState(0)
  const [pending, setPending] = useState(0)
  const [rows, setRows] = useState<MemberTotal[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [year, setYear] = useState(now.getFullYear())
  const [tick, setTick] = useState(0)
  const detailsRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    const a = await supabase.rpc('group_total', { p_group: group.group_id })
    const b = await supabase.rpc('group_totals', { p_group: group.group_id })
    if (a.error || b.error) {
      setMsg(errMsg(a.error ?? b.error))
      return
    }
    setMsg('')
    const first = (a.data as Array<{ validated: number; pending: number }>)[0]
    setValidated(Number(first?.validated ?? 0))
    setPending(Number(first?.pending ?? 0))
    setRows((b.data as MemberTotal[]).map((r) => ({ ...r, validated: Number(r.validated), pending: Number(r.pending) })))
    const n = await supabase.from('memberships').select('user_id,display_name').eq('group_id', group.group_id)
    if (!n.error) {
      const list = (n.data ?? []) as Array<{ user_id: string; display_name: string }>
      setNames(Object.fromEntries(list.map((m) => [m.user_id, m.display_name])))
    }
    setTick((x) => x + 1)
  }, [group.group_id])

  // Rechargement : a l'ouverture, au retour sur l'onglet ou la fenetre, puis toutes les 20 secondes.
  useEffect(() => {
    void load()
    const onFocus = () => void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    const id = window.setInterval(() => void load(), 20000)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(id)
    }
  }, [load])

  const max = Math.max(1, ...rows.map((r) => r.validated))
  const fmt = (cents: number) => money(cents / 100, cur, locale)
  const letter = (m: number) => new Intl.DateTimeFormat(loc, { month: 'narrow' }).format(new Date(2000, m, 1)).toUpperCase()

  const curIdx = plan ? monthIndex(plan, now.getFullYear(), now.getMonth()) : 0
  let upToDate = 0
  let lateTotal = 0
  if (plan) {
    const due = curIdx >= 0 ? plan.initial + plan.expected * curIdx : 0
    for (const r of rows) {
      const late = Math.max(0, due - Math.round(r.validated * 100))
      if (late === 0) upToDate += 1
      lateTotal += late
    }
  }

  function openDetails(id: string) {
    setSelected(id)
    window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  return (
    <div className="stack">
      <h2>{t('ovTitle')}</h2>
      {msg && <p className="msg">{msg}</p>}
      <div className="grid2">
        <div className="card">
          <small>{t('ovValidated')}</small>
          <div className="big ok-text">{money(validated, cur, locale)}</div>
        </div>
        <div className="card">
          <small>{t('ovPending')}</small>
          <div className="big warn-text">{money(pending, cur, locale)}</div>
        </div>
      </div>

      {plan && (
        <div className="grid2">
          <div className="card">
            <small>{tx.upToDate}</small>
            <div className="big ok-text">
              {upToDate}/{rows.length}
            </div>
          </div>
          <div className="card">
            <small>{tx.lateTotal}</small>
            <div className="big warn-text">{fmt(lateTotal)}</div>
          </div>
        </div>
      )}

      {plan ? (
        <>
          <div className="card">
            <div className="row between">
              <h3>{tx.monthly}</h3>
              <div className="ov-year">
                <button type="button" className="btn small" aria-label={tx.prevYear} onClick={() => setYear(year - 1)}>
                  ‹
                </button>
                <strong>{year}</strong>
                <button type="button" className="btn small" aria-label={tx.nextYear} onClick={() => setYear(year + 1)}>
                  ›
                </button>
              </div>
            </div>
            <div className="ov-head" aria-hidden="true">
              <span className="ov-name" />
              <span className="ov-sq">
                {MONTHS.map((m) => (
                  <i key={m}>{letter(m)}</i>
                ))}
              </span>
              <span className="ov-count">{tx.countHead}</span>
            </div>
            {rows.map((r) => {
              const cov = cover(plan, r.validated, r.pending)
              return (
                <button
                  key={r.user_id}
                  type="button"
                  className="ov-row"
                  aria-label={tx.openDetails.replace('{name}', r.display_name)}
                  onClick={() => openDetails(r.user_id)}
                >
                  <span className="ov-name">{r.display_name}</span>
                  <span className="ov-sq">
                    {MONTHS.map((m) => (
                      <i key={m} className={`ov-${cellOf(cov, monthIndex(plan, year, m), curIdx)}`} />
                    ))}
                  </span>
                  <span className="ov-count">{cov.full}</span>
                </button>
              )
            })}
            <div className="ov-legend">
              <span>
                <i className="ov-paid" />
                {tx.legend.paid}
              </span>
              <span>
                <i className="ov-late" />
                {tx.legend.late}
              </span>
              <span>
                <i className="ov-pending" />
                {tx.legend.pending}
              </span>
              <span>
                <i className="ov-due" />
                {tx.legend.due}
              </span>
              <span>
                <i className="ov-future" />
                {tx.legend.future}
              </span>
            </div>
          </div>

          <div ref={detailsRef}>
            <Details
              group={group}
              plan={plan}
              rows={rows}
              names={names}
              year={year}
              curIdx={curIdx}
              selected={selected}
              onSelect={setSelected}
              tick={tick}
            />
          </div>
        </>
      ) : (
        <div className="card">
          <h3>{t('ovPerMember')}</h3>
          {group.is_president && <p className="small">{tx.setupHint}</p>}
          {rows.map((r) => (
            <div key={r.user_id} className="member-row">
              <div className="row between">
                <span>{r.display_name}</span>
                <span>
                  {money(r.validated, cur, locale)}
                  {r.pending > 0 && <small className="warn-text"> (+{money(r.pending, cur, locale)})</small>}
                </span>
              </div>
              <progress max={max} value={r.validated} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
