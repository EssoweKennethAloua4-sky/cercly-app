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
  allUpToDate: 'tous à jour',
  someLate: '{n} en retard',
  nothingLate: 'rien à rattraper',
  catchUp: 'à rattraper',
  monthly: 'Suivi des membres',
  prevYear: 'Année précédente',
  nextYear: 'Année suivante',
  openDetails: 'Voir le détail de {name}',
  received: 'Cotisé',
  fees: "dont {amount} de frais d'envoi, non comptés",
  dueToDate: 'Dû à ce jour',
  monthsPaid: (n: number) => `${n} mois payé${n > 1 ? 's' : ''}`,
  setupHint: "Pour activer le suivi mois par mois, indiquez le montant attendu chaque mois dans l'onglet Réglages.",
  legend: { initial: 'apport', paid: 'payé', pending: 'à valider', late: 'en retard', due: 'ce mois-ci', future: 'à venir' },
}

type Dict = typeof fr

const en: Dict = {
  upToDate: 'Up to date',
  lateTotal: 'Total overdue',
  allUpToDate: 'everyone up to date',
  someLate: '{n} overdue',
  nothingLate: 'nothing overdue',
  catchUp: 'to catch up',
  monthly: 'Member tracking',
  prevYear: 'Previous year',
  nextYear: 'Next year',
  openDetails: 'See details for {name}',
  received: 'Contributed',
  fees: '{amount} of transfer fees not counted',
  dueToDate: 'Due to date',
  monthsPaid: (n: number) => `${n} month${n === 1 ? '' : 's'} paid`,
  setupHint: 'To turn on month-by-month tracking, set the amount expected each month in the Settings tab.',
  legend: { initial: 'initial', paid: 'paid', pending: 'to review', late: 'overdue', due: 'this month', future: 'upcoming' },
}

const TXT = { fr, en }
const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

interface Props {
  group: MyGroup
  onGo?: (k: 'cot' | 'loans') => void
  loansEnabled?: boolean
}

export function Overview({ group, onGo, loansEnabled }: Props) {
  const { t, locale } = useI18n()
  const tx = TXT[locale]
  const loc = locale === 'en' ? 'en' : 'fr'
  const g = group.group
  const cur = g.currency
  const plan = useMemo(() => parsePlan(g), [g])
  const now = new Date()
  const [validated, setValidated] = useState(0)
  const [pending, setPending] = useState(0)
  const [fees, setFees] = useState(0)
  const [rows, setRows] = useState<MemberTotal[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  const [loaded, setLoaded] = useState(false)
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
    const first = (a.data as Array<{ validated: number; pending: number; fees?: number }>)[0]
    setValidated(Number(first?.validated ?? 0))
    setPending(Number(first?.pending ?? 0))
    setFees(Number(first?.fees ?? 0))
    setRows((b.data as MemberTotal[]).map((r) => ({ ...r, validated: Number(r.validated), pending: Number(r.pending), fees: Number(r.fees ?? 0) })))
    const n = await supabase.from('memberships').select('user_id,display_name').eq('group_id', group.group_id)
    if (!n.error) {
      const list = (n.data ?? []) as Array<{ user_id: string; display_name: string }>
      setNames(Object.fromEntries(list.map((m) => [m.user_id, m.display_name])))
    }
    setLoaded(true)
    setTick((x) => x + 1)
  }, [group.group_id])

  // Rechargement : a l'ouverture, au retour sur l'onglet ou la fenetre, puis toutes les 20 secondes.
  useEffect(() => {
    setLoaded(false)
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
  const dueC = plan && curIdx >= 0 ? plan.initial + plan.expected * curIdx : 0
  let upToDate = 0
  let lateTotal = 0
  if (plan) {
    for (const r of rows) {
      const late = Math.max(0, dueC - Math.round(r.validated * 100))
      if (late === 0) upToDate += 1
      lateTotal += late
    }
  }
  const lateCount = rows.length - upToDate

  function openDetails(id: string) {
    setSelected(id)
    window.setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  // Tant que les chiffres ne sont pas arrives, on montre des blocs gris plutot qu'un faux "0".
  if (!loaded)
    return (
      <div className="stack" aria-busy="true">
        {msg && <p className="msg">{msg}</p>}
        <div className="skel skel-hero" />
        <div className="grid2">
          <div className="skel skel-tile" />
          <div className="skel skel-tile" />
        </div>
        <div className="skel skel-list" />
      </div>
    )

  return (
    <div className="stack">
      {msg && <p className="msg">{msg}</p>}

      <section className="hero">
        <span className="hero-label">{t('ovValidated')}</span>
        <div className="hero-amount">{money(validated, cur, locale)}</div>
        <span className="hero-sub">
          {t('ovPending')} : {money(pending, cur, locale)}
        </span>
        {fees > 0 && <span className="hero-sub">{tx.fees.replace('{amount}', money(fees, cur, locale))}</span>}
        {onGo && (
          <div className="hero-actions">
            <button type="button" className="pill pill-light" onClick={() => onGo('cot')}>
              {t('nav_cot')}
            </button>
            {loansEnabled && (
              <button type="button" className="pill pill-glass" onClick={() => onGo('loans')}>
                {t('nav_loans')}
              </button>
            )}
          </div>
        )}
      </section>

      {plan && (
        <div className="grid2">
          <div className="card tile">
            <small>{tx.upToDate}</small>
            <div className="tile-value">
              {upToDate}/{rows.length}
            </div>
            <span className={`tag ${lateCount > 0 ? 'bad' : 'ok'}`}>
              {lateCount > 0 ? tx.someLate.replace('{n}', String(lateCount)) : tx.allUpToDate}
            </span>
          </div>
          <div className="card tile">
            <small>{tx.lateTotal}</small>
            <div className="tile-value">{fmt(lateTotal)}</div>
            <span className={`tag ${lateTotal > 0 ? 'warn' : 'ok'}`}>{lateTotal > 0 ? tx.catchUp : tx.nothingLate}</span>
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
            <div className="seg-head" aria-hidden="true">
              {plan.initial > 0 && <i />}
              {MONTHS.map((m) => (
                <i key={m}>{letter(m)}</i>
              ))}
            </div>
            {rows.map((r) => {
              const cov = cover(plan, r.validated, r.pending)
              const valC = Math.round(r.validated * 100)
              const pendC = Math.round(r.pending * 100)
              const initialCls =
                plan.initial === 0
                  ? null
                  : valC >= plan.initial
                    ? 'initial'
                    : valC + pendC >= plan.initial
                      ? 'pending'
                      : curIdx >= 0
                        ? 'late'
                        : 'future'
              return (
                <button
                  key={r.user_id}
                  type="button"
                  className="seg-row"
                  aria-label={tx.openDetails.replace('{name}', r.display_name)}
                  onClick={() => openDetails(r.user_id)}
                >
                  <span className="seg-top">
                    <strong>{r.display_name}</strong>
                    <span className="seg-count">{tx.monthsPaid(cov.full)}</span>
                  </span>
                  <span className="seg" aria-hidden="true">
                    {initialCls && <i className={`seg-${initialCls}`} />}
                    {MONTHS.map((m) => (
                      <i key={m} className={`seg-${cellOf(cov, monthIndex(plan, year, m), curIdx)}`} />
                    ))}
                  </span>
                  <span className="seg-sub">
                    <span>
                      {tx.received} {fmt(valC)}
                    </span>
                    <span>
                      {tx.dueToDate} {fmt(dueC)}
                    </span>
                  </span>
                </button>
              )
            })}
            <div className="seg-legend">
              {plan.initial > 0 && (
                <span>
                  <i className="seg-initial" />
                  {tx.legend.initial}
                </span>
              )}
              <span>
                <i className="seg-paid" />
                {tx.legend.paid}
              </span>
              <span>
                <i className="seg-pending" />
                {tx.legend.pending}
              </span>
              <span>
                <i className="seg-late" />
                {tx.legend.late}
              </span>
              <span>
                <i className="seg-due" />
                {tx.legend.due}
              </span>
              <span>
                <i className="seg-future" />
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
