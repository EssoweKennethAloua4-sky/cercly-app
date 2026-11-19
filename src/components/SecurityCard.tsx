import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import { errMsg } from '../lib/format'

const TXT = {
  fr: {
    title: 'Double authentification',
    on: 'Activée : un code de votre application d’authentification est demandé à chaque connexion.',
    off: 'Pas encore activée. Avec elle, un mot de passe volé ne suffit plus pour entrer dans votre compte.',
    required:
      'Obligatoire pour vous : vous êtes président, secrétaire ou validateur. Tant qu’elle n’est pas activée, vous pouvez consulter le groupe mais pas valider, décider ni régler.',
    enable: 'Activer la double authentification',
    scan: 'Scannez ce code avec une application d’authentification (Google Authenticator, Aegis, Authy…), puis saisissez le code à 6 chiffres.',
    secret: 'Ou saisissez cette clé : {secret}',
    code: 'Code à 6 chiffres',
    confirm: 'Valider',
    cancel: 'Annuler',
    done: 'Double authentification activée.',
  },
  en: {
    title: 'Two-factor authentication',
    on: 'On: a code from your authenticator app is asked at every sign-in.',
    off: 'Not turned on yet. With it, a stolen password is no longer enough to get into your account.',
    required:
      'Required for you: you are president, secretary or validator. Until it is on, you can view the group but not validate, decide or change settings.',
    enable: 'Turn on two-factor authentication',
    scan: 'Scan this code with an authenticator app (Google Authenticator, Aegis, Authy…), then enter the 6-digit code.',
    secret: 'Or enter this key: {secret}',
    code: '6-digit code',
    confirm: 'Confirm',
    cancel: 'Cancel',
    done: 'Two-factor authentication is on.',
  },
}

interface Status {
  has_mfa: boolean
  needs_mfa: boolean
}

// Etat de la 2FA de la personne connectee. Si la fonction n'existe pas encore (base avant v0.16),
// on se rabat sur la liste des facteurs : la carte reste utilisable.
export async function loadSecurityStatus(): Promise<Status> {
  const r = await supabase.rpc('my_security_status')
  const row = Array.isArray(r.data) ? (r.data[0] as Status | undefined) : undefined
  if (!r.error && row) return row
  const f = await supabase.auth.mfa.listFactors()
  const has = (f.data?.all ?? []).some((x) => x.factor_type === 'totp' && x.status === 'verified')
  return { has_mfa: has, needs_mfa: false }
}

export function SecurityCard({ onChange }: { onChange?: () => void }) {
  const { locale } = useI18n()
  const tx = TXT[locale]
  const [status, setStatus] = useState<Status | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setStatus(await loadSecurityStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function start() {
    setMsg('')
    setBusy(true)
    // Nettoyage des tentatives jamais terminees, puis nouvelle inscription
    const list = await supabase.auth.mfa.listFactors()
    for (const f of list.data?.all ?? []) if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    const r = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    setBusy(false)
    if (r.error || !r.data) {
      setMsg(errMsg(r.error))
      return
    }
    setFactorId(r.data.id)
    setQr(r.data.totp.qr_code)
    setSecret(r.data.totp.secret)
  }

  async function cancel() {
    if (factorId) await supabase.auth.mfa.unenroll({ factorId })
    setFactorId(null)
    setQr('')
    setSecret('')
    setCode('')
    setMsg('')
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setBusy(true)
    setMsg('')
    const r = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    setBusy(false)
    if (r.error) {
      setMsg(errMsg(r.error))
      return
    }
    setFactorId(null)
    setQr('')
    setSecret('')
    setCode('')
    setMsg(tx.done)
    await refresh()
    onChange?.()
  }

  if (!status) return null

  return (
    <section className="card">
      <h3>{tx.title}</h3>
      <p className="small">{status.has_mfa ? tx.on : tx.off}</p>
      {!status.has_mfa && status.needs_mfa && <p className="hint-warn">{tx.required}</p>}
      {msg && <p className="msg">{msg}</p>}
      {!status.has_mfa && !factorId && (
        <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>
          {tx.enable}
        </button>
      )}
      {factorId && (
        <form className="stack" onSubmit={verify}>
          <p className="small">{tx.scan}</p>
          {qr && <img className="qr" src={qr} alt="QR code" />}
          <p className="small mono">{tx.secret.replace('{secret}', secret)}</p>
          <label className="field">
            <span>{tx.code}</span>
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
          <div className="row">
            <button className="btn primary" disabled={busy}>
              {tx.confirm}
            </button>
            <button type="button" className="btn" onClick={() => void cancel()}>
              {tx.cancel}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
