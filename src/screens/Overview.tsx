import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { GroupInfo, MemberTotal, MyGroup } from '../types'
import { errMsg, money } from '../lib/format'

type Cell = 'paid' | 'pending' | 'late' | 'due' | 'future' | 'before'

const fr = {
  upToDate: 'À jour',
  lateTotal: 'Retard cumulé',
  monthly: 'Cotisations mois par mois',
  countHead: 'Payés',
  legend: { paid: 'payé', late: 'en retard', pending: 'à valider', due: 'ce mois-ci', future: 'à venir' },
  setupHint: "Pour activer le suivi mois par mois, indiquez le montant attendu chaque mois dans l'onglet Réglages.",
  prevYear: 'Année précédente',
  nextYear: 'Année suivante',
  initial: 'Apport initial',
  initialPaid: 'payé',
  initialMissing: 'il manque {amount}',
  paidUntil: "Payé jusqu'à {month}",
  paidNothing: 'Aucun mois payé pour le moment.',
  partial: 'partiel : {paid} sur {due}',
  st: {
    paid: 'Payé',
    pending: 'À valider',
    late: 'En retard',
    due: 'À payer ce mois-ci',
    future: 'À venir',
    before: '',
  } as Record<Cell, string>,
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
  initial: 'Initial contribution',
  initialPaid: 'paid',
  initialMissing: '{amount} missing',
  paidUntil: 'Paid up to {month}',
  paidNothing: 'No month paid yet.',
  partial: 'partial: {paid} of {due}',
  st: {
    paid: 'Paid',
    pending: 'To review',
    late: 'Overdue',
    due: 'Due this month',
    future: 'Upcoming',
    before: '',
  } as Record<Cell, string>,
}

const TXT = { fr, en }

const CSS = `
.ov-head,.ov-row{display:flex;align-items:center;gap:8px;width:100%}
.ov-row{background:none;border:0;border-top:1px solid rgba(128,128,128,.18);color:inherit;font:inherit;text-align:left;padding:8px 0;cursor:pointer}
.ov-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ov-sq{display:flex;gap:3px;flex:none}
.ov-sq i{width:12px;height:12px;border-radius:3px;display:block;font-style:normal;font-size:10px;line-height:12px;text-align:center}
.ov-head .ov-sq i{opacity:.6}
.ov-count{width:36px;text-align:right;flex:none;opacity:.75;font-size:13px}
.c-paid{background:#2eb872}
.c-late{background:#e5484d}
.c-pending{background:#f5a524}
.c-due{border:1.5px solid #06b6d4}
.c-future{border:1px solid currentColor;opacity:.3}
.c-before{background:currentColor;opacity:.12}
.ov-year{display:flex;align-items:center;gap:8px}
.ov-detail{padding:4px 0 10px}
.ov-list{list-style:none;margin:6px 0 0;padding:0}
.ov-list li{display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:13px}
.st-paid{color:#2eb872}
.st-late{color:#e5484d}
.st-pending{color:#f5a524}
.st-due{color:#06b6d4}
.st-future{opacity:.6}
.ov-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;opacity:.85;margin-top:10px}
.ov-legend i{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:5px;vertical-align:-1px}
@media (max-width:360px){.ov-sq{gap:2px}.ov-sq i{width:10px}}
`

const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

function fill(s: string, v: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''))
}

interface Plan {
  expected: number
  initial: number
  sy: number
  sm: number
}

// Montants en centimes pour eviter les erreurs d'arrondi.
function parsePlan(g: GroupInfo): Plan | null {
  const expected = Math.round(Number(g.expected_amount ?? 0) * 100)
  if (!(expected > 0) || !g.start_month) return null
  const [y, m] = g.start_month.split('-').map(Number)
  if (!y || !m) return null
  return { expected, initial: Math.round(Number(g.initial_amount ?? 0) * 100), sy: y, sm: m - 1 }
}

function monthIndex(plan: Plan, y: number, m: number): number {
  return (y - plan.sy) * 12 + (m - plan.sm)
}

interface Cover {
  full: number
  allFull: number
  validated: number
  monthsCash: number
  initialMissing: number
}

// Les cotisations validees remplissent d'abord l'apport initial, puis chaque mois dans l'ordre.
function cover(plan: Plan, validated: number, pending: number): Cover {
  const v = Math.round(validated * 100)
  const p = Math.round(pending * 100)
  const monthsCash = Math.max(0, v - plan.initial)
  return {
    full: Math.floor(monthsCash / plan.expected),
    allFull: Math.floor(Math.max(0, v + p - plan.initial) / plan.expected),
    validated: v,
    monthsCash,
    initialMissing: Math.max(0, plan.initial - v),
  }
}

function cellOf(cov: Cover, idx: number, curIdx: number): Cell {
  if (idx < 0) return 'before'
  if (idx < cov.full) return 'paid'
  if (idx < cov.allFull) return 'pending'
  if (idx < curIdx) return 'late'
  if (idx === curIdx) return 'due'
  return 'future'
}

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
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [year, setYear] = useState(now.getFullYear())

  useEffect(() => {
    void (async () => {
      const a = await supabase.rpc('group_total', { p_group: group.group_id })
      const b = await supabase.rpc('group_totals', { p_group: group.group_id })
      if (a.error || b.error) {
        setMsg(errMsg(a.error ?? b.error))
        return
      }
      const first = (a.data as Array<{ validated: number; pending: number }>)[0]
      setValidated(Number(first?.validated ?? 0))
      setPending(Number(first?.pending ?? 0))
      setRows(
        (b.data as MemberTotal[]).map((r) => ({ ...r, validated: Number(r.validated), pending: Number(r.pending) })),
      )
    })()
  }, [group.group_id])

  const max = Math.max(1, ...rows.map((r) => r.validated))
  const fmt = (cents: number) => money(cents / 100, cur, locale)

  const monthName = (y: number, m: number) => {
    const s = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(new Date(y, m, 1))
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
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

  return (
    <div className="stack">
      <style>{CSS}</style>
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
            const isOpen = open === r.user_id
            return (
              <div key={r.user_id}>
                <button type="button" className="ov-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.user_id)}>
                  <span className="ov-name">{r.display_name}</span>
                  <span className="ov-sq">
                    {MONTHS.map((m) => (
                      <i key={m} className={`c-${cellOf(cov, monthIndex(plan, year, m), curIdx)}`} />
                    ))}
                  </span>
                  <span className="ov-count">{cov.full}</span>
                </button>
                {isOpen && (
                  <div className="ov-detail">
                    <p className="small">
                      {cov.full > 0 ? fill(tx.paidUntil, { month: monthName(plan.sy, plan.sm + cov.full - 1) }) : tx.paidNothing}
                    </p>
                    {plan.initial > 0 && (
                      <p className="small">
                        {tx.initial} : {cov.initialMissing === 0 ? tx.initialPaid : fill(tx.initialMissing, { amount: fmt(cov.initialMissing) })}
                      </p>
                    )}
                    <ul className="ov-list">
                      {MONTHS.map((m) => {
                        const idx = monthIndex(plan, year, m)
                        const cell = cellOf(cov, idx, curIdx)
                        if (cell === 'before') return null
                        const covered = Math.min(plan.expected, Math.max(0, cov.monthsCash - idx * plan.expected))
                        const partial = cell === 'late' || cell === 'due' ? covered : 0
                        return (
                          <li key={m}>
                            <span>{monthName(year, m)}</span>
                            <span className={`st-${cell}`}>
                              {tx.st[cell]}
                              {partial > 0 && ` · ${fill(tx.partial, { paid: fmt(partial), due: fmt(plan.expected) })}`}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
          <div className="ov-legend">
            <span>
              <i className="c-paid" />
              {tx.legend.paid}
            </span>
            <span>
              <i className="c-late" />
              {tx.legend.late}
            </span>
            <span>
              <i className="c-pending" />
              {tx.legend.pending}
            </span>
            <span>
              <i className="c-due" />
              {tx.legend.due}
            </span>
            <span>
              <i className="c-future" />
              {tx.legend.future}
            </span>
          </div>
        </div>
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
