import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import { Logo } from '../components/Logo'
import { LangSwitch } from '../components/LangSwitch'

const MIN_PASSWORD = 8
const RESEND_DELAY = 60

const TXT = {
  fr: {
    sentTitle: 'Vérifiez votre boîte mail',
    sentBody: 'Nous avons envoyé un e-mail de confirmation à {email}. Ouvrez-le et cliquez sur le lien pour activer votre compte.',
    sentSpam: "Vous ne le voyez pas ? Regardez dans les courriers indésirables (spam). L'e-mail peut mettre une à deux minutes à arriver.",
    sentNext: 'Une fois votre adresse confirmée, revenez sur Cercly : vous serez connecté, ou vous pourrez vous connecter avec votre mot de passe.',
    resend: "Renvoyer l'e-mail",
    resendIn: 'Renvoyer dans {s} s',
    resent: 'E-mail renvoyé.',
    back: 'Retour',
    tagline: 'Les cotisations de votre groupe, claires pour tout le monde.',
    errors: {
      over_email_send_rate_limit: "Trop d'inscriptions en peu de temps : l'e-mail de confirmation n'a pas pu être envoyé. Réessayez dans un moment.",
      over_request_rate_limit: 'Trop de tentatives. Patientez quelques minutes puis réessayez.',
      invalid_credentials: 'E-mail ou mot de passe incorrect.',
      user_already_exists: 'Un compte existe déjà avec cette adresse. Connectez-vous plutôt.',
      email_exists: 'Un compte existe déjà avec cette adresse. Connectez-vous plutôt.',
      email_not_confirmed: "Votre adresse n'est pas encore confirmée : ouvrez l'e-mail de confirmation (regardez aussi dans les spams).",
      weak_password: 'Mot de passe trop faible : choisissez-en un plus long ou plus varié.',
      validation_failed: 'Adresse e-mail invalide.',
    } as Record<string, string>,
  },
  en: {
    sentTitle: 'Check your inbox',
    sentBody: 'We sent a confirmation e-mail to {email}. Open it and click the link to activate your account.',
    sentSpam: "Can't see it? Check your spam folder. The e-mail can take a minute or two to arrive.",
    sentNext: 'Once your address is confirmed, come back to Cercly: you will be signed in, or you can sign in with your password.',
    resend: 'Resend the e-mail',
    resendIn: 'Resend in {s} s',
    resent: 'E-mail sent again.',
    back: 'Back',
    tagline: "Your group's contributions, clear for everyone.",
    errors: {
      over_email_send_rate_limit: 'Too many sign-ups in a short time: the confirmation e-mail could not be sent. Try again in a while.',
      over_request_rate_limit: 'Too many attempts. Wait a few minutes and try again.',
      invalid_credentials: 'Wrong e-mail or password.',
      user_already_exists: 'An account already exists with this address. Sign in instead.',
      email_exists: 'An account already exists with this address. Sign in instead.',
      email_not_confirmed: 'Your address is not confirmed yet: open the confirmation e-mail (check your spam folder too).',
      weak_password: 'Password too weak: choose a longer or more varied one.',
      validation_failed: 'Invalid e-mail address.',
    } as Record<string, string>,
  },
}

function pendingInvite(): string | null {
  return new URLSearchParams(window.location.search).get('invite') ?? sessionStorage.getItem('cercly.invite')
}

export function AuthScreen() {
  const { t, locale } = useI18n()
  const tx = TXT[locale]
  const invite = pendingInvite()
  const redirect = invite ? `${window.location.origin}/?invite=${invite}` : window.location.origin
  const [mode, setMode] = useState<'in' | 'up'>(invite ? 'up' : 'in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  // Messages de Supabase (en anglais) traduits d'apres leur code ; message d'origine si le code est inconnu.
  function authError(err: { code?: string; message: string }): string {
    return (err.code && tx.errors[err.code]) || err.message
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg('')
    if (mode === 'up' && password.length < MIN_PASSWORD) {
      setMsg(t('passwordShort'))
      return
    }
    setBusy(true)
    const r =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: { display_name: name.trim(), invite: invite ?? undefined },
              emailRedirectTo: redirect,
            },
          })
    setBusy(false)
    if (r.error) {
      setMsg(authError(r.error))
      return
    }
    // Confirmation d'e-mail desactivee dans Supabase : le compte est deja actif, la session arrive directement
    // (App passe tout seul a l'ecran suivant). Pas d'ecran « Verifiez votre boite mail » dans ce cas.
    if (mode === 'up' && !r.data.session) {
      setSent(email.trim())
      setCooldown(RESEND_DELAY)
      setNote('')
    }
  }

  async function resend() {
    if (!sent || cooldown > 0) return
    setMsg('')
    setNote('')
    const r = await supabase.auth.resend({ type: 'signup', email: sent, options: { emailRedirectTo: redirect } })
    if (r.error) setMsg(authError(r.error))
    else setNote(tx.resent)
    setCooldown(RESEND_DELAY)
  }

  if (sent)
    return (
      <div className="center">
        <div className="card narrow">
          <div className="row between">
            <div className="brand">
              <Logo /> <span>{t('appName')}</span>
            </div>
            <LangSwitch />
          </div>
          <h1>{tx.sentTitle}</h1>
          <p>{tx.sentBody.replace('{email}', sent)}</p>
          <p className="small">{tx.sentSpam}</p>
          <p className="small">{tx.sentNext}</p>
          {msg && <p className="msg">{msg}</p>}
          {note && <p className="small">{note}</p>}
          <button type="button" className="btn primary" disabled={cooldown > 0} onClick={() => void resend()}>
            {cooldown > 0 ? tx.resendIn.replace('{s}', String(cooldown)) : tx.resend}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setSent(null)
              setMode('in')
              setMsg('')
              setNote('')
            }}
          >
            {tx.back}
          </button>
        </div>
      </div>
    )

  return (
    <div className="center">
      <form className="card narrow auth-card" onSubmit={submit}>
        <div className="auth-lang">
          <LangSwitch />
        </div>
        <div className="auth-intro">
          <Logo size={56} />
          <strong>{t('appName')}</strong>
          <p>{tx.tagline}</p>
        </div>
        <h1>{mode === 'in' ? t('authIn') : t('authUp')}</h1>
        {mode === 'up' && (
          <label className="field">
            <span>{t('yourName')}</span>
            <input required maxLength={60} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>{t('email')}</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>
            {t('password')} <small>{mode === 'up' ? `- ${t('passwordHint')}` : ''}</small>
          </span>
          <input
            type="password"
            required
            minLength={mode === 'up' ? MIN_PASSWORD : undefined}
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
