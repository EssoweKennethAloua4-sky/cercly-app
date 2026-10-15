import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { Contribution, ContributionStatus, Membership, MyGroup } from '../types'
import { day, errMsg, money } from '../lib/format'
import { MAX_FILES, prepareFile, validFile } from '../lib/files'

const TAG: Record<ContributionStatus, string> = { en_attente: 'warn', validee: 'ok', rejetee: 'bad' }

export function Contributions({ group, members, userId }: { group: MyGroup; members: Membership[]; userId: string }) {
  const { t, locale } = useI18n()
  const gid = group.group_id
  const cur = group.group.currency
  const canReview = group.can_validate || group.is_president
  const [list, setList] = useState<Contribution[]>([])
  const [forId, setForId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fileKey, setFileKey] = useState(0)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('contributions')
      .select('id,payer_id,for_user_id,amount,paid_on,note,status,reject_reason,created_at,contribution_files(id,storage_path,mime_type)')
      .eq('group_id', gid)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) setMsg(errMsg(error))
    else setList(((data ?? []) as Contribution[]).map((c) => ({ ...c, amount: Number(c.amount) })))
  }, [gid])

  useEffect(() => {
    void load()
  }, [load])

  const name = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? '—'

  async function uploadProofs(contributionId: string, fs: File[]) {
    for (const f of fs) {
      const p = await prepareFile(f)
      const path = `${gid}/${contributionId}/${crypto.randomUUID()}.${p.ext}`
      const up = await supabase.storage.from('justificatifs').upload(path, p.blob, { contentType: p.mime, upsert: false })
      if (up.error) throw up.error
      const row = await supabase.from('contribution_files').insert({
        contribution_id: contributionId,
        group_id: gid,
        storage_path: path,
        mime_type: p.mime,
        size_bytes: p.blob.size,
        uploaded_by: userId,
      })
      if (row.error) throw row.error
    }
  }

  function pick(e: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg('')
    setOk('')
    const amt = Number(amount.replace(',', '.'))
    if (!(amt > 0)) return setMsg(t('cotBadAmount'))
    if (files.length === 0) return setMsg(t('cotNeedFile'))
    if (!files.every(validFile)) return setMsg(t('cotFileBad'))
    setBusy(true)
    try {
      const ins = await supabase
        .from('contributions')
        .insert({ group_id: gid, payer_id: userId, for_user_id: forId, amount: amt, paid_on: date, note: note.trim() || null })
        .select('id')
        .single()
      if (ins.error) throw ins.error
      await uploadProofs(String((ins.data as { id: string }).id), files)
      setAmount('')
      setNote('')
      setFiles([])
      setFileKey((k) => k + 1)
      setOk(t('cotSent'))
    } catch (err) {
      setMsg(errMsg(err))
    }
    setBusy(false)
    await load()
  }

  async function addProof(c: Contribution, fl: FileList | null) {
    const arr = Array.from(fl ?? [])
    if (arr.length === 0) return
    setMsg('')
    if ((c.contribution_files?.length ?? 0) + arr.length > MAX_FILES) return setMsg(t('cotMaxFiles'))
    if (!arr.every(validFile)) return setMsg(t('cotFileBad'))
    try {
      await uploadProofs(c.id, arr)
    } catch (err) {
      setMsg(errMsg(err))
    }
    await load()
  }

  async function openProof(path: string) {
    const { data, error } = await supabase.storage.from('justificatifs').createSignedUrl(path, 60)
    if (error || !data) setMsg(errMsg(error))
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function review(id: string, status: 'validee' | 'rejetee', why?: string) {
    setMsg('')
    const { error } = await supabase.rpc('review_contribution', { p_id: id, p_status: status, p_reason: why ?? null })
    if (error) setMsg(errMsg(error))
    else {
      setRejecting(null)
      setReason('')
      await load()
    }
  }

  const mine = list.filter((c) => c.payer_id === userId)
  const toReview = canReview ? list.filter((c) => c.status === 'en_attente' && c.payer_id !== userId) : []

  const card = (c: Contribution, reviewMode: boolean) => (
    <article key={c.id} className="card">
      <div className="row between">
        <strong>{t('cotForWho', { name: name(c.for_user_id) })}</strong>
        <span className={`tag ${TAG[c.status]}`}>{t(`st_${c.status}`)}</span>
      </div>
      <div>
        {money(c.amount, cur, locale)} · <small>{day(c.paid_on, locale)} · {t('cotPayer', { name: name(c.payer_id) })}</small>
      </div>
      {c.note && <p className="small pre">{c.note}</p>}
      {c.status === 'rejetee' && c.reject_reason && <p className="small bad-text">{t('cotRejectedWhy', { reason: c.reject_reason })}</p>}
      <div className="row wrap">
        {(c.contribution_files ?? []).map((f, i) => (
          <button key={f.id} className="btn small" onClick={() => void openProof(f.storage_path)}>
            {t('cotView')} {i + 1}
          </button>
        ))}
      </div>
      {!reviewMode && c.status === 'en_attente' && (
        <label className="btn small file">
          {t('cotAddProof')}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { void addProof(c, e.target.files); e.target.value = '' }} />
        </label>
      )}
      {!reviewMode && c.status === 'en_attente' && canReview && <p className="small">{t('cotOwn')}</p>}
      {reviewMode &&
        (rejecting === c.id ? (
          <div className="stack">
            <label className="field">
              <span>{t('cotReason')}</span>
              <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="row">
              <button className="btn danger" disabled={!reason.trim()} onClick={() => void review(c.id, 'rejetee', reason.trim())}>
                {t('cotConfirmReject')}
              </button>
              <button className="btn" onClick={() => setRejecting(null)}>
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button className="btn ok" onClick={() => void review(c.id, 'validee')}>
              {t('cotValidate')}
            </button>
            <button className="btn danger" onClick={() => { setRejecting(c.id); setReason('') }}>
              {t('cotReject')}
            </button>
          </div>
        ))}
    </article>
  )

  return (
    <div className="stack">
      <form className="card" onSubmit={submit}>
        <h2>{t('cotNew')}</h2>
        <label className="field">
          <span>{t('cotFor')}</span>
          <select required value={forId} onChange={(e) => setForId(e.target.value)}>
            <option value="">{t('cotChoose')}</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid2">
          <label className="field">
            <span>{t('cotAmount')} ({cur})</span>
            <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('cotDate')}</span>
            <input type="date" required value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>{t('cotProofs')}</span>
          <input key={fileKey} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={pick} />
        </label>
        <label className="field">
          <span>{t('cotNote')}</span>
          <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {msg && <p className="msg">{msg}</p>}
        {ok && <p className="ok-text">{ok}</p>}
        <button className="btn primary" disabled={busy}>
          {t('cotSubmit')}
        </button>
      </form>

      {canReview && (
        <section className="stack">
          <h2>{t('cotToReview')}</h2>
          {toReview.length === 0 && <p className="card small">{t('cotNoneReview')}</p>}
          {toReview.map((c) => card(c, true))}
        </section>
      )}

      <section className="stack">
        <h2>{t('cotMine')}</h2>
        {mine.length === 0 && <p className="card small">{t('cotNoneMine')}</p>}
        {mine.map((c) => card(c, false))}
      </section>
    </div>
  )
}
