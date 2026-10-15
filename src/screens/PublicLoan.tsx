import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import { Logo } from '../components/Logo'
import { LangSwitch } from '../components/LangSwitch'
import { errMsg } from '../lib/format'

interface Info {
  group_name: string
  currency: string
  member_name: string
}

const isoDay = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)

// Page publique ouverte depuis le lien d'un membre : l'emprunteur remplit lui-même sa demande.
export function PublicLoan({ token }: { token: string }) {
  const { t } = useI18n()
  const [info, setInfo] = useState<Info | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const [reason, setReason] = useState('')
  const [guarantor, setGuarantor] = useState('')
  const [consent, setConsent] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    void supabase.rpc('get_loan_link_info', { p_token: token }).then(({ data, error }) => {
      setInfo(!error && Array.isArray(data) && data.length > 0 ? (data[0] as Info) : null)
    })
  }, [token])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg('')
    setBusy(true)
    const { error } = await supabase.rpc('submit_loan_request', {
      p_token: token,
      p_borrower_name: name,
      p_phone: phone,
      p_amount: Number(amount.replace(',', '.')),
      p_due_date: due,
      p_reason: reason.trim() || null,
      p_guarantor_name: guarantor,
      p_consent: consent,
    })
    setBusy(false)
    if (error) setMsg(errMsg(error))
    else setDone(true)
  }

  return (
    <div className="center">
      <div className="card narrow">
        <div className="row between">
          <div className="brand">
            <Logo /> <span>{t('appName')}</span>
          </div>
          <LangSwitch />
        </div>
        {info === undefined && <p>{t('loading')}</p>}
        {info === null && <p className="msg">{t('pubInvalid')}</p>}
        {info && done && <p className="ok-text">{t('pubThanks')}</p>}
        {info && !done && (
          <form className="stack" onSubmit={submit}>
            <h1>{t('pubTitle')}</h1>
            <p className="small">{t('pubFrom', { member: info.member_name, group: info.group_name })}</p>
            <label className="field">
              <span>{t('pubName')}</span>
              <input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>{t('pubPhone')}</span>
              <input required type="tel" autoComplete="tel" placeholder="+228 90 00 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <div className="grid2">
              <label className="field">
                <span>{t('pubAmount', { cur: info.currency })}</span>
                <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="field">
                <span>{t('pubDue')}</span>
                <input required type="date" min={isoDay(1)} max={isoDay(730)} value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>{t('pubReason')}</span>
              <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="field">
              <span>{t('pubGuarantor')}</span>
              <input required minLength={2} maxLength={100} value={guarantor} onChange={(e) => setGuarantor(e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span className="small">{t('pubConsent', { group: info.group_name })}</span>
            </label>
            {msg && <p className="msg">{msg}</p>}
            <button className="btn primary" disabled={busy || !consent}>
              {t('pubSubmit')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
