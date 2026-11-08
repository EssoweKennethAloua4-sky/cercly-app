import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { Empty } from '../components/Icon'
import { useI18n } from '../i18n'
import type { Loan, LoanBorrower, LoanRepayment, Membership, MyGroup } from '../types'
import { day, errMsg, money } from '../lib/format'

interface Tally {
  pour: number
  contre: number
  quorum: number
}

const TXT = {
  fr: {
    waitGuarantor: 'En attente du garant : {name} doit confirmer dans l’app avant le vote.',
    waitFix: 'Garant non reconnu : le président doit corriger le garant, ou décider directement.',
    openVote: 'Ouvrir le vote sans attendre le garant',
    grant: 'Accorder le prêt',
    refuse: 'Refuser le prêt',
    grantConfirm: 'Accorder ce prêt de {amount} maintenant, sans attendre le vote ?',
    refuseConfirm: 'Refuser ce prêt de {amount} maintenant ?',
    presidentHint: 'En tant que président, vous pouvez décider tout de suite :',
    terms: 'Taux {rate} % · intérêt {interest} · total dû {total}',
    paid: 'Remboursé {paid} sur {total}',
    left: 'Reste à rembourser : {left}',
    history: 'Remboursements',
    addRepay: 'Enregistrer un remboursement',
    repayAmount: 'Montant reçu',
    repayDate: 'Date',
    repayNote: 'Note (facultatif)',
    repaySave: 'Enregistrer',
    repayDelete: 'Supprimer',
    repayDeleteConfirm: 'Supprimer ce remboursement de {amount} ?',
    editRate: 'Modifier le taux',
    rate: 'Taux (%)',
    interestOpt: 'Intérêt (laisser vide pour le calculer)',
    save: 'Enregistrer',
    cancel: 'Annuler',
    overdue: 'Échéance dépassée',
  },
  en: {
    waitGuarantor: 'Waiting for the guarantor: {name} must confirm in the app before the vote.',
    waitFix: 'Guarantor not recognised: the president must fix the guarantor, or decide directly.',
    openVote: 'Open the vote without waiting for the guarantor',
    grant: 'Approve the loan',
    refuse: 'Refuse the loan',
    grantConfirm: 'Approve this {amount} loan now, without waiting for the vote?',
    refuseConfirm: 'Refuse this {amount} loan now?',
    presidentHint: 'As president, you can decide right away:',
    terms: 'Rate {rate}% · interest {interest} · total due {total}',
    paid: 'Repaid {paid} of {total}',
    left: 'Left to repay: {left}',
    history: 'Repayments',
    addRepay: 'Record a repayment',
    repayAmount: 'Amount received',
    repayDate: 'Date',
    repayNote: 'Note (optional)',
    repaySave: 'Save',
    repayDelete: 'Delete',
    repayDeleteConfirm: 'Delete this repayment of {amount}?',
    editRate: 'Change the rate',
    rate: 'Rate (%)',
    interestOpt: 'Interest (leave empty to compute it)',
    save: 'Save',
    cancel: 'Cancel',
    overdue: 'Past due',
  },
}

// Montant saisi a la main : espaces et virgule acceptes ; NaN si vide ou invalide
const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(/\s/g, '').replace(',', '.')))
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TAG: Record<string, string> = {
  a_examiner: 'warn',
  en_vote: 'warn',
  validee: 'ok',
  remboursee: 'ok',
  garant_refuse: 'bad',
  refusee: 'bad',
  annulee: 'bad',
}

export function Loans({ group, members, userId }: { group: MyGroup; members: Membership[]; userId: string }) {
  const { t, locale } = useI18n()
  const tx = TXT[locale]
  const gid = group.group_id
  const cur = group.group.currency
  const isP = group.is_president
  const canReview = isP || group.can_validate

  const [link, setLink] = useState<{ token: string; status: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [loans, setLoans] = useState<Loan[]>([])
  const [loaded, setLoaded] = useState(false)
  const [borrowers, setBorrowers] = useState<Record<string, LoanBorrower>>({})
  const [myVotes, setMyVotes] = useState<Record<string, string>>({})
  const [canVote, setCanVote] = useState<Record<string, boolean>>({})
  const [tally, setTally] = useState<Record<string, Tally>>({})
  const [msg, setMsg] = useState('')
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [why, setWhy] = useState('')
  const [fixing, setFixing] = useState<string | null>(null)
  const [fixB, setFixB] = useState('')
  const [fixG, setFixG] = useState('')
  const [needsDecision, setNeedsDecision] = useState<string | null>(null)
  const [repays, setRepays] = useState<Record<string, LoanRepayment[]>>({})
  const [repaying, setRepaying] = useState<string | null>(null)
  const [rAmount, setRAmount] = useState('')
  const [rDate, setRDate] = useState('')
  const [rNote, setRNote] = useState('')
  const [rating, setRating] = useState<string | null>(null)
  const [rRate, setRRate] = useState('')
  const [rInterest, setRInterest] = useState('')

  const name = (id: string | null) => (id ? members.find((m) => m.user_id === id)?.display_name ?? '—' : '—')

  const load = useCallback(async () => {
    const lk = await supabase
      .from('loan_links')
      .select('token,status')
      .eq('group_id', gid)
      .in('status', ['actif', 'pause'])
      .maybeSingle()
    setLink(lk.data ? (lk.data as { token: string; status: string }) : null)

    const res = await supabase
      .from('loans')
      .select('id,link_member_id,borrower_member_id,guarantor_name,guarantor_member_id,guarantor_check,guarantor_response,amount,interest_rate,interest,due_date,status,closes_at,decided_at,decision_basis,dismiss_reason,created_at')
      .eq('group_id', gid)
      .order('created_at', { ascending: false })
      .limit(100)
    if (res.error) {
      setMsg(errMsg(res.error))
      return
    }
    const list = ((res.data ?? []) as Loan[]).map((l) => ({ ...l, amount: Number(l.amount), interest: Number(l.interest ?? 0) }))
    setLoans(list)
    setLoaded(true)
    const ids = list.map((l) => l.id)
    if (ids.length === 0) return

    const b = await supabase.from('loan_borrowers').select('loan_id,name,phone,reason').in('loan_id', ids)
    setBorrowers(Object.fromEntries(((b.data ?? []) as LoanBorrower[]).map((x) => [x.loan_id, x])))
    const rp = await supabase.from('loan_repayments').select('id,loan_id,amount,paid_on,note').in('loan_id', ids).order('paid_on')
    const byLoan: Record<string, LoanRepayment[]> = {}
    for (const x of (rp.data ?? []) as LoanRepayment[]) (byLoan[x.loan_id] ??= []).push({ ...x, amount: Number(x.amount) })
    setRepays(byLoan)
    const v = await supabase.from('loan_votes').select('loan_id,vote').in('loan_id', ids)
    setMyVotes(Object.fromEntries(((v.data ?? []) as Array<{ loan_id: string; vote: string }>).map((x) => [x.loan_id, x.vote])))

    const tl: Record<string, Tally> = {}
    const cv: Record<string, boolean> = {}
    for (const l of list.filter((x) => x.status === 'en_vote')) {
      const [a, q, c] = await Promise.all([
        supabase.rpc('loan_tally', { p_loan: l.id }),
        supabase.rpc('loan_quorum', { p_loan: l.id }),
        supabase.rpc('can_vote_loan', { p_loan: l.id }),
      ])
      const row = (a.data as Array<{ pour: number; contre: number }> | null)?.[0]
      tl[l.id] = { pour: Number(row?.pour ?? 0), contre: Number(row?.contre ?? 0), quorum: Number(q.data ?? 2) }
      cv[l.id] = c.data === true
    }
    setTally(tl)
    setCanVote(cv)
  }, [gid])

  useEffect(() => {
    void load()
  }, [load])

  async function call(fn: string, args: Record<string, unknown>): Promise<boolean> {
    setMsg('')
    const { error } = await supabase.rpc(fn, args)
    if (error) {
      setMsg(errMsg(error))
      return false
    }
    await load()
    return true
  }

  async function vote(id: string, v: 'pour' | 'contre') {
    setMsg('')
    const { error } = await supabase.from('loan_votes').insert({ loan_id: id, voter_id: userId, vote: v })
    if (error) setMsg(errMsg(error))
    await load()
  }

  async function close(id: string, decision?: 'validee' | 'refusee') {
    setMsg('')
    const { error } = await supabase.rpc('close_loan', { p_loan: id, p_decision: decision ?? null })
    if (error) {
      const m = errMsg(error)
      setMsg(m)
      if (m.includes('doit décider')) setNeedsDecision(id)
    } else {
      setNeedsDecision(null)
      await load()
    }
  }

  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url)
    setCopied(true)
  }

  const url = link ? `${window.location.origin}/?pret=${link.token}` : ''

  const card = (l: Loan) => {
    const b = borrowers[l.id]
    const voteOver = l.closes_at !== null && new Date(l.closes_at) <= new Date()
    const tl = tally[l.id]
    const total = l.amount + l.interest
    const list = repays[l.id] ?? []
    const sum = list.reduce((a, x) => a + x.amount, 0)
    const paid = l.status === 'remboursee' ? Math.max(sum, total) : sum
    const left = Math.max(0, total - paid)
    const granted = l.status === 'validee' || l.status === 'remboursee'
    const late = l.status === 'validee' && new Date(l.due_date + 'T23:59:59') < new Date()
    const m = (n: number) => money(n, cur, locale)
    return (
      <article key={l.id} className="card">
        <div className="row between">
          <strong>{b ? b.name : t('loanHidden')}</strong>
          <span className={`tag ${TAG[l.status] ?? ''}`}>{t(`ls_${l.status}`)}</span>
        </div>
        <div>
          {money(l.amount, cur, locale)} · <small>{t('loanDue', { date: day(l.due_date, locale) })}</small>
        </div>
        {l.interest_rate !== null && (
          <small>
            {tx.terms.replace('{rate}', String(Number(l.interest_rate))).replace('{interest}', m(l.interest)).replace('{total}', m(total))}
          </small>
        )}
        {granted && (
          <div className="stack">
            <div className="repay-bar" aria-hidden="true">
              <i style={{ width: `${total > 0 ? Math.min(100, (paid / total) * 100) : 0}%` }} />
            </div>
            <small>{tx.paid.replace('{paid}', m(paid)).replace('{total}', m(total))}</small>
            {l.status === 'validee' && <strong className={late ? 'bad-text' : ''}>{tx.left.replace('{left}', m(left))}</strong>}
            {late && <span className="tag bad">{tx.overdue}</span>}
            {list.length > 0 && (
              <details>
                <summary className="small">
                  {tx.history} ({list.length})
                </summary>
                <ul className="fee-list">
                  {list.map((x) => (
                    <li key={x.id}>
                      <span>
                        {day(x.paid_on, locale)}
                        {x.note ? ` · ${x.note}` : ''}
                      </span>
                      <strong>{m(x.amount)}</strong>
                      {isP && (
                        <button
                          type="button"
                          className="btn small danger"
                          onClick={() => {
                            if (window.confirm(tx.repayDeleteConfirm.replace('{amount}', m(x.amount)))) void call('delete_loan_repayment', { p_id: x.id })
                          }}
                        >
                          {tx.repayDelete}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {b && <small className="mono">{b.phone}</small>}
        {b?.reason && <small className="pre">{t('loanReason', { reason: b.reason })}</small>}
        <small>
          {t('loanGuarantor', { name: l.guarantor_member_id ? name(l.guarantor_member_id) : l.guarantor_name })} ·{' '}
          {t('loanLinkOf', { name: name(l.link_member_id) })}
        </small>
        {l.guarantor_check === 'inconnu' && <span className="tag warn">{t('loanWarnUnknown')}</span>}
        {l.guarantor_check === 'autre_membre' && <span className="tag warn">{t('loanWarnOther')}</span>}
        {l.status === 'annulee' && l.dismiss_reason && <small className="bad-text">{t('loanDismissedWhy', { reason: l.dismiss_reason })}</small>}
        {l.decision_basis && <small>{t(`basis_${l.decision_basis}`)}</small>}

        {/* Ce que la demande attend, dit simplement (sinon personne ne comprend pourquoi rien ne bouge) */}
        {l.status === 'a_examiner' && l.guarantor_response === 'en_attente' && l.guarantor_member_id && l.guarantor_member_id !== userId && (
          <p className="hint-warn">{tx.waitGuarantor.replace('{name}', name(l.guarantor_member_id))}</p>
        )}
        {l.status === 'a_examiner' && !l.guarantor_member_id && <p className="hint-warn">{tx.waitFix}</p>}

        {l.status === 'a_examiner' && l.guarantor_response === 'en_attente' && l.guarantor_member_id === userId && (
          <div className="stack">
            <p className="small">{t('loanIAmGuarantor')}</p>
            <div className="row">
              <button className="btn ok" onClick={() => void call('respond_as_guarantor', { p_loan: l.id, p_accept: true })}>
                {t('loanGuarantorYes')}
              </button>
              <button className="btn danger" onClick={() => void call('respond_as_guarantor', { p_loan: l.id, p_accept: false })}>
                {t('loanGuarantorNo')}
              </button>
            </div>
          </div>
        )}

        {l.status === 'en_vote' && tl && (
          <div className="stack">
            <small>{t('loanTally', { pour: tl.pour, contre: tl.contre, quorum: tl.quorum })}</small>
            {l.closes_at && <small>{t('loanVoteEnds', { date: day(l.closes_at, locale) })}</small>}
            {myVotes[l.id] ? (
              <small className="ok-text">{t('loanYourVote', { vote: t(`v_${myVotes[l.id]}`) })}</small>
            ) : (
              canVote[l.id] && (
                <div className="row">
                  <button className="btn ok" onClick={() => void vote(l.id, 'pour')}>
                    {t('loanVoteFor')}
                  </button>
                  <button className="btn danger" onClick={() => void vote(l.id, 'contre')}>
                    {t('loanVoteAgainst')}
                  </button>
                </div>
              )
            )}
            {isP && voteOver && (
              <div className="stack">
                {needsDecision === l.id ? (
                  <>
                    <small>{t('loanDecideHint')}</small>
                    <div className="row">
                      <button className="btn ok" onClick={() => void close(l.id, 'validee')}>
                        {t('loanDecideYes')}
                      </button>
                      <button className="btn danger" onClick={() => void close(l.id, 'refusee')}>
                        {t('loanDecideNo')}
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="btn" onClick={() => void close(l.id)}>
                    {t('loanClose')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {l.status === 'a_examiner' && isP &&
          (fixing === l.id ? (
            <div className="stack">
              <label className="field">
                <span>{t('loanFixBorrower')}</span>
                <select value={fixB} onChange={(e) => setFixB(e.target.value)}>
                  <option value="">{t('loanNoneOpt')}</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('loanFixGuarantor')}</span>
                <select value={fixG} onChange={(e) => setFixG(e.target.value)}>
                  <option value="">{t('loanNoneOpt')}</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button
                  className="btn primary"
                  onClick={() =>
                    void call('link_loan_parties', { p_loan: l.id, p_borrower_member: fixB || null, p_guarantor_member: fixG || null }).then((ok) => ok && setFixing(null))
                  }
                >
                  {t('loanSave')}
                </button>
                <button className="btn" onClick={() => setFixing(null)}>
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn small" onClick={() => { setFixing(l.id); setFixB(l.borrower_member_id ?? ''); setFixG(l.guarantor_member_id ?? '') }}>
              {t('loanFix')}
            </button>
          ))}

        {l.status === 'a_examiner' && canReview &&
          (dismissing === l.id ? (
            <div className="stack">
              <label className="field">
                <span>{t('loanDismissReason')}</span>
                <input maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} />
              </label>
              <div className="row">
                <button className="btn danger" disabled={!why.trim()} onClick={() => void call('dismiss_loan', { p_loan: l.id, p_reason: why.trim() }).then((ok) => { if (ok) { setDismissing(null); setWhy('') } })}>
                  {t('loanConfirm')}
                </button>
                <button className="btn" onClick={() => setDismissing(null)}>
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn small danger" onClick={() => { setDismissing(l.id); setWhy('') }}>
              {t('loanDismiss')}
            </button>
          ))}

        {l.status === 'a_examiner' && canReview && (
          <button className="btn small" onClick={() => void call('open_loan_vote_now', { p_loan: l.id })}>
            {tx.openVote}
          </button>
        )}

        {/* Le president decide sans attendre le garant ni la fin du vote (jamais pour sa propre demande) */}
        {isP && ['a_examiner', 'garant_refuse', 'en_vote'].includes(l.status) && l.borrower_member_id !== userId && (
          <div className="stack">
            <small>{tx.presidentHint}</small>
            <div className="row wrap">
              <button
                className="btn ok"
                onClick={() => {
                  if (window.confirm(tx.grantConfirm.replace('{amount}', money(l.amount, cur, locale))))
                    void call('decide_loan_now', { p_loan: l.id, p_decision: 'validee' })
                }}
              >
                {tx.grant}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (window.confirm(tx.refuseConfirm.replace('{amount}', money(l.amount, cur, locale))))
                    void call('decide_loan_now', { p_loan: l.id, p_decision: 'refusee' })
                }}
              >
                {tx.refuse}
              </button>
            </div>
          </div>
        )}

        {l.status === 'validee' && canReview &&
          (repaying === l.id ? (
            <div className="stack">
              <label className="field">
                <span>
                  {tx.repayAmount} ({cur})
                </span>
                <input inputMode="decimal" value={rAmount} onChange={(e) => setRAmount(e.target.value)} />
              </label>
              <label className="field">
                <span>{tx.repayDate}</span>
                <input type="date" value={rDate} max={today()} onChange={(e) => setRDate(e.target.value)} />
              </label>
              <label className="field">
                <span>{tx.repayNote}</span>
                <input maxLength={300} value={rNote} onChange={(e) => setRNote(e.target.value)} />
              </label>
              <div className="row">
                <button
                  className="btn primary"
                  disabled={!(num(rAmount) > 0) || !rDate}
                  onClick={() =>
                    void call('record_loan_repayment', {
                      p_loan: l.id,
                      p_amount: num(rAmount),
                      p_paid_on: rDate,
                      p_note: rNote.trim() || null,
                    }).then((ok) => ok && setRepaying(null))
                  }
                >
                  {tx.repaySave}
                </button>
                <button className="btn" onClick={() => setRepaying(null)}>
                  {tx.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn primary"
              onClick={() => {
                setRepaying(l.id)
                setRAmount(String(left))
                setRDate(today())
                setRNote('')
              }}
            >
              {tx.addRepay}
            </button>
          ))}

        {isP && ['a_examiner', 'garant_refuse', 'en_vote', 'validee'].includes(l.status) &&
          (rating === l.id ? (
            <div className="stack">
              <label className="field">
                <span>{tx.rate}</span>
                <input inputMode="decimal" value={rRate} onChange={(e) => setRRate(e.target.value)} />
              </label>
              <label className="field">
                <span>
                  {tx.interestOpt} ({cur})
                </span>
                <input inputMode="decimal" value={rInterest} onChange={(e) => setRInterest(e.target.value)} />
              </label>
              <div className="row">
                <button
                  className="btn primary"
                  disabled={!(num(rRate) >= 0)}
                  onClick={() =>
                    void call('set_loan_interest', {
                      p_loan: l.id,
                      p_rate: num(rRate),
                      p_interest: rInterest.trim() ? num(rInterest) : null,
                    }).then((ok) => ok && setRating(null))
                  }
                >
                  {tx.save}
                </button>
                <button className="btn" onClick={() => setRating(null)}>
                  {tx.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn small"
              onClick={() => {
                setRating(l.id)
                setRRate(String(Number(l.interest_rate ?? 0)))
                setRInterest('')
              }}
            >
              {tx.editRate}
            </button>
          ))}

        {l.status === 'validee' && isP && (
          <button className="btn" onClick={() => void call('mark_loan_repaid', { p_loan: l.id })}>
            {t('loanRepaid')}
          </button>
        )}

        {isP && b && ['garant_refuse', 'refusee', 'remboursee', 'annulee'].includes(l.status) && (
          <button
            className="btn small danger"
            onClick={() => {
              if (window.confirm(t('loanPurgeConfirm'))) void call('purge_loan_borrower', { p_loan: l.id })
            }}
          >
            {t('loanPurge')}
          </button>
        )}
      </article>
    )
  }

  return (
    <div className="stack">
      <h2>{t('loansTitle')}</h2>
      {msg && <p className="msg">{msg}</p>}

      <section className="card">
        <h3>{t('loanMyLink')}</h3>
        <p className="small">{t('loanLinkIntro')}</p>
        {!link && (
          <button className="btn primary" onClick={() => void call('get_or_create_loan_link', { p_group: gid })}>
            {t('loanLinkCreate')}
          </button>
        )}
        {link && (
          <>
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
            {link.status === 'pause' && <p className="small warn-text">{t('loanLinkPaused')}</p>}
            <div className="row wrap">
              <button className="btn small" onClick={() => void copyLink(url)}>
                {copied ? t('copied') : t('copy')}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  if (window.confirm(t('loanLinkRegenConfirm'))) {
                    setCopied(false)
                    void call('regenerate_loan_link', { p_group: gid })
                  }
                }}
              >
                {t('loanLinkRegenerate')}
              </button>
              <button className="btn small" onClick={() => void call('set_loan_link_paused', { p_group: gid, p_paused: link.status === 'actif' })}>
                {link.status === 'actif' ? t('loanLinkPause') : t('loanLinkResume')}
              </button>
            </div>
          </>
        )}
      </section>

      {loaded && loans.length === 0 && <Empty icon="loans" title={t('loanNone')} text={t('loanNoneHint')} />}
      {loans.map(card)}
    </div>
  )
}
