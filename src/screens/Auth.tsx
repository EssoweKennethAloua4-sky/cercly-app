import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import { Logo } from '../components/Logo'
import { LangSwitch } from '../components/LangSwitch'

export function AuthScreen() {
  const { t } = useI18n()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg('')
    if (mode === 'up' && password.length < 12) {
      setMsg(t('passwordShort'))
      return
    }
    setBusy(true)
    const r =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password })
    setBusy(false)
    if (r.error) setMsg(r.error.message)
    else if (mode === 'up') setMsg(t('checkEmail'))
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <div className="row between">
          <div className="brand">
            <Logo /> <span>{t('appName')}</span>
          </div>
          <LangSwitch />
        </div>
        <h1>{mode === 'in' ? t('authIn') : t('authUp')}</h1>
        <label className="field">
          <span>{t('email')}</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>
            {t('password')} <small>{mode === 'up' ? `· ${t('passwordHint')}` : ''}</small>
          </span>
          <input
            type="password"
            required
            minLength={mode === 'up' ? 12 : undefined}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {msg && <p className="msg">{msg}</p>}
        <button className="btn primary" disabled={busy}>
          {mode === 'in' ? t('signIn') : t('signUp')}
        </button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg('') }}>
          {mode === 'in' ? t('toSignUp') : t('toSignIn')}
        </button>
      </form>
    </div>
  )
}
