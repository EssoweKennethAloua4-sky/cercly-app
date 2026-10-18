import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { Contribution, MemberTotal, MyGroup } from '../types'
import { errMsg, money } from '../lib/format'
import { allocate, cellOf, cover, fill, monthIndex, type Cell, type Piece, type Plan } from '../lib/schedule'
import '../suivi.css'

const fr = {
  title: 'Détails des cotisations',
  hint: 'Touchez une personne pour voir tout le détail.',
  received: 'Cotisé',
  feesLine: "+ {amount} de frais d'envoi (non comptés)",
  feesTotal: "Frais d'envoi (non comptés)",
  paySplit: 'envoyé {sent}, dont {fee} de frais',
  dueToDate: 'Dû à ce jour',
  upToDate: 'À jour',
  late: 'Retard {amount}',
  ahead: 'Avance {amount}',
  back: 'Retour',
  summary: 'Résumé',
  validated: 'Total validé',
  pending: 'En attente de validation',
  situation: 'Situation',
  balLate: 'En retard de {amount}',
  balAhead: 'En avance de {amount}',
  balOk: 'À jour',
  initial: 'Apport initial',
  initialPaid: 'payé en entier',
  initialNone: 'aucun apport demandé',
  initialMissing: 'il manque {amount}',
  monthsPaid: 'Mois payés en entier',
  paidUntil: 'Payé jusqu\'à',
  none: 'aucun',
  history: 'Historique des paiements',
  noPayments: 'Aucun paiement enregistré.',
  paidBy: 'Payé par {name}',
  someone: 'un membre',
  note: 'Note : {note}',
  reason: 'Motif du rejet : {reason}',
  pendingInfo: 'Sera répartie sur les mois après validation.',
  split: 'Répartition',
  complete: 'complet',
  rest: 'reste {amount}',
  monthsRun: '{count} mois × {amount}',
  monthByMonth: 'Mois par mois',
  partial: 'partiel : {paid} sur {due}',
  status: { validee: 'Validée', en_attente: 'En attente', rejetee: 'Rejetée' } as Record<string, string>,
  st: {
    paid: 'Payé',
    pending: 'À valider',
    late: 'En retard',
    due: 'À payer ce mois-ci',
    future: 'À venir',
    before: '',
  } as Record<Cell, string>,
  loading: 'Chargement…',
}

type Dict = typeof fr

const en: Dict = {
  title: 'Contribution details',
  hint: 'Tap a person to see every detail.',
  received: 'Contributed',
  feesLine: '+ {amount} of transfer fees (not counted)',
  feesTotal: 'Transfer fees (not counted)',
  paySplit: 'sent {sent}, including {fee} of fees',
  dueToDate: 'Due to date',
  upToDate: 'Up to date',
  late: 'Overdue {amount}',
  ahead: 'Ahead {amount}',
  back: 'Back',
  summary: 'Summary',
  validated: 'Approved total',
  pending: 'Waiting for approval',
  situation: 'Situation',
  balLate: 'Overdue by {amount}',
  balAhead: 'Ahead by {amount}',
  balOk: 'Up to date',
  initial: 'Initial contribution',
  initialPaid: 'paid in full',
  initialNone: 'none required',
  initialMissing: '{amount} missing',
  monthsPaid: 'Months paid in full',
  paidUntil: 'Paid up to',
  none: 'none',
  history: 'Payment history',
  noPayments: 'No payment recorded.',
  paidBy: 'Paid by {name}',
  someone: 'a member',
  note: 'Note: {note}',
  reason: 'Reason for rejection: {reason}',
  pendingInfo: 'Will be applied to the months once approved.',
  split: 'Breakdown',
  complete: 'complete',
  rest: '{amount} left',
  monthsRun: '{count} months × {amount}',
  monthByMonth: 'Month by month',
  partial: 'partial: {paid} of {due}',
  status: { validee: 'Approved', en_attente: 'Pending', rejetee: 'Rejected' } as Record<string, string>,
  st: {
    paid: 'Paid',
    pending: 'To review',
    late: 'Overdue',
    due: 'Due this month',
    future: 'Upcoming',
    before: '',
  } as Record<Cell, string>,
  loading: 'Loading…',
}

const TXT = { fr, en }
const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

interface Props {
  group: MyGroup
  plan: Plan
  rows: MemberTotal[]
  names: Record<string, string>
  year: number
  curIdx: number
  selected: string | null
  onSelect: (id: string | null) => void
  tick: number
}

export function Details({ group, plan, rows, names, year, curIdx, selected, onSelect, tick }: Props) {
  const { locale } = useI18n()
  const tx = TXT[locale]
  const loc = locale === 'en' ? 'en' : 'fr'
  const cur = group.group.currency
  const [items, setItems] = useState<Contribution[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!selected) return
    let alive = true
    void (async () => {
      const { data, error } = await supabase
        .from('contributions')
        .select('id,payer_id,for_user_id,amount,fee,paid_on,note,status,reject_reason,created_at')
        .eq('group_id', group.group_id)
        .eq('for_user_id', selected)
        .order('paid_on', { ascending: true })
        .order('created_at', { ascending: true })
      if (!alive) return
      if (error) {
        setErr(errMsg(error))
        setItems([])
        return
      }
      setErr('')
      setItems((data ?? []) as unknown as Contribution[])
    })()
    return () => {
      alive = false
    }
  }, [selected, tick, group.group_id])

  const fmt = (cents: number) => money(cents / 100, cur, locale)
  // cotisation d'un paiement = montant envoye - frais d'envoi (en centimes)
  const netC = (c: Contribution) => Math.round((Number(c.amount) - Number(c.fee ?? 0)) * 100)
  const feeC = (c: Contribution) => Math.round(Number(c.fee ?? 0) * 100)
  const monthName = (y: number, m: number) => {
    const s = new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(new Date(y, m, 1))
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' }).format(
      new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1),
    )
  }

  const due = curIdx >= 0 ? plan.initial + plan.expected * curIdx : 0
  const sel = rows.find((r) => r.user_id === selected) ?? null

  const validated = useMemo(() => (items ?? []).filter((c) => c.status === 'validee'), [items])
  const pieces = useMemo(
    () => allocate(plan, validated.map(netC)),
    [plan, validated],
  )
  const piecesById = useMemo(() => {
    const m = new Map<string, Piece[]>()
    validated.forEach((c, i) => m.set(c.id, pieces[i] ?? []))
    return m
  }, [validated, pieces])

  function pieceText(p: Piece): string {
    const tail = p.complete ? tx.complete : fill(tx.rest, { amount: fmt(p.rest) })
    if (p.kind === 'initial') return `${tx.initial} : ${fmt(p.amount)} (${tail})`
    if (p.from === p.to) return `${monthName(plan.sy, plan.sm + p.from)} : ${fmt(p.amount)} (${tail})`
    return `${monthName(plan.sy, plan.sm + p.from)} → ${monthName(plan.sy, plan.sm + p.to)} : ${fill(tx.monthsRun, {
      count: p.to - p.from + 1,
      amount: fmt(plan.expected),
    })}`
  }

  if (!sel) {
    return (
      <div className="card">
        <h3>{tx.title}</h3>
        <p className="small">{tx.hint}</p>
        {rows.map((r) => {
          const v = Math.round(r.validated * 100)
          const late = Math.max(0, due - v)
          const ahead = Math.max(0, v - due)
          return (
            <button key={r.user_id} type="button" className="dt-item" onClick={() => onSelect(r.user_id)}>
              <span className="dt-main">
                <strong>{r.display_name}</strong>
                <span className="dt-sub">
                  {tx.received} {fmt(v)} · {tx.dueToDate} {fmt(due)}
                </span>
                {(r.fees ?? 0) > 0 && <span className="dt-sub">{fill(tx.feesLine, { amount: fmt(Math.round((r.fees ?? 0) * 100)) })}</span>}
              </span>
              <span className={`tag ${late > 0 ? 'bad' : 'ok'}`}>
                {late > 0 ? fill(tx.late, { amount: fmt(late) }) : ahead > 0 ? fill(tx.ahead, { amount: fmt(ahead) }) : tx.upToDate}
              </span>
              <span className="dt-arrow" aria-hidden="true">
                ›
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  const cov = cover(plan, sel.validated, sel.pending)
  const v = Math.round(sel.validated * 100)
  const p = Math.round(sel.pending * 100)
  const late = Math.max(0, due - v)
  const ahead = Math.max(0, v - due)
  const history = [...(items ?? [])].reverse()

  return (
    <div className="card">
      <div className="dt-top">
        <h3>{sel.display_name}</h3>
        <button type="button" className="btn small" onClick={() => onSelect(null)}>
          {tx.back}
        </button>
      </div>
      {err && <p className="msg">{err}</p>}

      <div className="dt-block">
        <h4>{tx.summary}</h4>
        <div className="dt-sum">
          <div>
            <span className="dt-sub">{tx.validated}</span>
            <strong>{fmt(v)}</strong>
          </div>
          {p > 0 && (
            <div>
              <span className="dt-sub">{tx.pending}</span>
              <strong>{fmt(p)}</strong>
            </div>
          )}
          <div>
            <span className="dt-sub">{tx.dueToDate}</span>
            <strong>{fmt(due)}</strong>
          </div>
          {(sel.fees ?? 0) > 0 && (
            <div>
              <span className="dt-sub">{tx.feesTotal}</span>
              <strong>{fmt(Math.round((sel.fees ?? 0) * 100))}</strong>
            </div>
          )}
          <div>
            <span className="dt-sub">{tx.situation}</span>
            <strong className={late > 0 ? 'dt-bad' : 'dt-good'}>
              {late > 0 ? fill(tx.balLate, { amount: fmt(late) }) : ahead > 0 ? fill(tx.balAhead, { amount: fmt(ahead) }) : tx.balOk}
            </strong>
          </div>
        </div>
        <p className="small">
          {tx.initial} : {plan.initial === 0 ? tx.initialNone : cov.initialMissing === 0 ? tx.initialPaid : fill(tx.initialMissing, { amount: fmt(cov.initialMissing) })}
        </p>
        <p className="small">
          {tx.monthsPaid} : {cov.full} · {tx.paidUntil} : {cov.full > 0 ? monthName(plan.sy, plan.sm + cov.full - 1) : tx.none}
        </p>
      </div>

      <div className="dt-block">
        <h4>{tx.history}</h4>
        {items === null && <p className="small">{tx.loading}</p>}
        {items !== null && history.length === 0 && <p className="small">{tx.noPayments}</p>}
        {history.map((c) => {
          const parts = piecesById.get(c.id) ?? []
          const statusClass = c.status === 'validee' ? 'ok' : c.status === 'rejetee' ? 'bad' : 'warn'
          return (
            <div key={c.id} className="dt-pay">
              <div className="dt-pay-head">
                <span>
                  <strong>{fmt(netC(c))}</strong>
                  <span className="dt-sub"> · {fmtDate(c.paid_on)}</span>
                </span>
                <span className={`tag ${statusClass}`}>{tx.status[c.status] ?? c.status}</span>
              </div>
              {feeC(c) > 0 && (
                <p className="small">{fill(tx.paySplit, { sent: fmt(Math.round(Number(c.amount) * 100)), fee: fmt(feeC(c)) })}</p>
              )}
              {c.payer_id !== c.for_user_id && (
                <p className="small">{fill(tx.paidBy, { name: names[c.payer_id] ?? tx.someone })}</p>
              )}
              {c.note && <p className="small">{fill(tx.note, { note: c.note })}</p>}
              {c.status === 'rejetee' && c.reject_reason && <p className="small">{fill(tx.reason, { reason: c.reject_reason })}</p>}
              {c.status === 'en_attente' && <p className="small">{tx.pendingInfo}</p>}
              {parts.length > 0 && (
                <ul className="dt-split" aria-label={tx.split}>
                  {parts.map((pc, i) => (
                    <li key={i}>{pieceText(pc)}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <div className="dt-block">
        <h4>
          {tx.monthByMonth} · {year}
        </h4>
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
                <span className={`ov-st-${cell}`}>
                  {tx.st[cell]}
                  {partial > 0 && ` · ${fill(tx.partial, { paid: fmt(partial), due: fmt(plan.expected) })}`}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
