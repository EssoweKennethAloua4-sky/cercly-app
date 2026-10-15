import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import { Logo } from '../components/Logo'
import { errMsg } from '../lib/format'

// Double authentification (TOTP) obligatoire pour tous : première connexion = inscription du code,
// connexions suivantes = saisie du code à 6 chiffres.
export function MfaScreen({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const started = useRef(false)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error || !data) {
        setMsg(errMsg(error))
        return
      }
      const totp = data.all.filter((f) => f.factor_type === 'totp')
      const verified = totp.find((f) => f.status === 'verified')
      if (verified) {
        setFactorId(verified.id)
        return
      }
      // Nettoyage des tentatives d'inscription jamais terminées
      for (const f of totp) await supabase.auth.mfa.unenroll({ factorId: f.id })
      const r = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (r.error || !r.data) {
        setMsg(errMsg(r.error))
        return
      }
      setFactorId(r.data.id)
      setQr(r.data.totp.qr_code)
      setSecret(r.data.totp.secret)
    })()
  }, [])

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setBusy(true)
    setMsg('')
    const r = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setBusy(false)
    if (r.error) setMsg(r.error.message)
    else onDone()
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={verify}>
        <div className="brand">
          <Logo /> <span>{t('appName')}</span>
        </div>
        <h1>{t('mfaTitle')}</h1>
        <p>{qr ? t('mfaEnrollIntro') : t('mfaVerifyIntro')}</p>
        {qr && (
          <>
            <img className="qr" src={qr} alt="QR code" />
            <p className="small mono">{t('mfaSecret', { secret })}</p>
          </>
        )}
        <label className="field">
          <span>{t('mfaCode')}</span>
          <input
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        {msg && <p className="msg">{msg}</p>}
        <button className="btn primary" disabled={busy || !factorId}>
          {t('mfaConfirm')}
        </button>
        <button type="button" className="link" onClick={() => void supabase.auth.signOut()}>
          {t('signOut')}
        </button>
      </form>
    </div>
  )
}
