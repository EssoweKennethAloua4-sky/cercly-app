import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { Empty } from '../components/Icon'
import { useI18n } from '../i18n'
import type { Loan, LoanBorrower, Membership, MyGroup } from '../types'
import { day, errMsg, money } from '../lib/format'

interface Tally {
  pour: number
  contre: number
  quorum: number
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
      .select('id,link_member_id,borrower_member_id,guarantor_name,guarantor_member_id,guarantor_check,guarantor_response,amount,due_date,status,closes_at,decided_at,decision_basis,dismiss_reason,created_at')
      .eq('group_id', gid)
      .order('created_at', { ascending: false })
      .limit(100)
    if (res.error) {
      setMsg(errMsg(res.error))
      return
    }
    const list = ((res.data ?? []) as Loan[]).map((l) => ({ ...l, amount: Number(l.amount) }))
    setLoans(list)
    setLoaded(true)
    const ids = list.map((l) => l.id)
    if (ids.length === 0) return

    const b = await supabase.from('loan_borrowers').select('loan_id,name,phone,reason').in('loan_id', ids)
    setBorrowers(Object.fromEntries(((b.data ?? []) as LoanBorrower[]).map((x) => [x.loan_id, x])))
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
    return (
      <article key={l.id} className="card">
        <div className="row between">
          <strong>{b ? b.name : t('loanHidden')}</strong>
          <span className={`tag ${TAG[l.status] ?? ''}`}>{t(`ls_${l.status}`)}</span>
        </div>
        <div>
          {money(l.amount, cur, locale)} · <small>{t('loanDue', { date: day(l.due_date, locale) })}</small>
        </div>
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
