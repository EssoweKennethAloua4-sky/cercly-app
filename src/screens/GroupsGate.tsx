import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { GroupInfo, Membership, MyGroup } from '../types'
import { errMsg } from '../lib/format'
import { CreateGroup } from './CreateGroup'
import { Shell } from './Shell'

type Row = Membership & { groups: GroupInfo }

const TXT = {
  fr: {
    welcomeTitle: 'Bienvenue sur Cercly',
    welcomeIntro: 'Vous ne faites encore partie d’aucun groupe. Que voulez-vous faire ?',
    create: 'Créer un groupe',
    createHint: 'Vous serez le président du groupe et vous inviterez les membres.',
    joinWithLink: 'Rejoindre un groupe',
    joinWithLinkHint: 'Collez le lien d’invitation que le président vous a envoyé.',
    linkLabel: 'Lien d’invitation',
    badLink: 'Ce lien ne ressemble pas à un lien d’invitation Cercly.',
    back: 'Retour',
    joinAs: 'Vous êtes connecté(e) avec {email}.',
    notMe: 'Ce n’est pas mon compte',
    notMeHint: 'Vous serez déconnecté(e) et vous pourrez créer votre compte avec ce lien.',
  },
  en: {
    welcomeTitle: 'Welcome to Cercly',
    welcomeIntro: 'You are not in any group yet. What would you like to do?',
    create: 'Create a group',
    createHint: 'You will be the president and invite the members.',
    joinWithLink: 'Join a group',
    joinWithLinkHint: 'Paste the invitation link the president sent you.',
    linkLabel: 'Invitation link',
    badLink: 'This does not look like a Cercly invitation link.',
    back: 'Back',
    joinAs: 'You are signed in as {email}.',
    notMe: 'This is not my account',
    notMeHint: 'You will be signed out and can create your account with this link.',
  },
}

async function clearInvite() {
  sessionStorage.removeItem('cercly.invite')
  await supabase.auth.updateUser({ data: { invite: null } })
}

// Accepte le lien complet (https://…/?invite=CODE) ou le code seul.
function inviteFrom(text: string): string | null {
  const s = text.trim()
  if (!s) return null
  try {
    const code = new URL(s).searchParams.get('invite')
    if (code) return code
  } catch {
    // pas une adresse : peut-etre le code seul
  }
  return /^[A-Za-z0-9_-]{6,}$/.test(s) ? s : null
}

// Premier ecran apres l'inscription, sans groupe ni invitation : creer un groupe OU coller un lien d'invitation.
function Welcome({ onCreated, onInvite }: { onCreated: () => void; onInvite: (code: string) => void }) {
  const { t, locale } = useI18n()
  const tx = TXT[locale]
  const [step, setStep] = useState<'choose' | 'create' | 'join'>('choose')
  const [link, setLink] = useState('')
  const [msg, setMsg] = useState('')

  if (step === 'create') return <CreateGroup onDone={onCreated} onCancel={() => setStep('choose')} />

  if (step === 'join')
    return (
      <form
        className="card narrow"
        onSubmit={(e) => {
          e.preventDefault()
          const code = inviteFrom(link)
          if (!code) return setMsg(tx.badLink)
          sessionStorage.setItem('cercly.invite', code)
          onInvite(code)
        }}
      >
        <h1>{tx.joinWithLink}</h1>
        <p className="small">{tx.joinWithLinkHint}</p>
        <label className="field">
          <span>{tx.linkLabel}</span>
          <input required value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/?invite=…" />
        </label>
        {msg && <p className="msg">{msg}</p>}
        <div className="row">
          <button className="btn primary">{t('join')}</button>
          <button type="button" className="btn" onClick={() => setStep('choose')}>
            {tx.back}
          </button>
        </div>
      </form>
    )

  return (
    <div className="card narrow">
      <h1>{tx.welcomeTitle}</h1>
      <p className="small">{tx.welcomeIntro}</p>
      <button type="button" className="choice-card" onClick={() => setStep('join')}>
        <strong>{tx.joinWithLink}</strong>
        <span className="small">{tx.joinWithLinkHint}</span>
      </button>
      <button type="button" className="choice-card" onClick={() => setStep('create')}>
        <strong>{tx.create}</strong>
        <span className="small">{tx.createHint}</span>
      </button>
      <button type="button" className="link" onClick={() => void supabase.auth.signOut()}>
        {t('signOut')}
      </button>
    </div>
  )
}

function JoinGroup({ token, onDone }: { token: string; onDone: () => void }) {
  const { t, locale } = useI18n()
  const tx = TXT[locale]
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(true)
  const tried = useRef(false)

  const join = useCallback(
    async (displayName: string) => {
      setBusy(true)
      setMsg('')
      const { error } = await supabase.rpc('accept_invitation', { p_token: token, p_display_name: displayName })
      if (error) {
        setMsg(errMsg(error))
        setBusy(false)
        return
      }
      await clearInvite()
      onDone()
    },
    [token, onDone],
  )

  // On rejoint directement seulement si ce compte a ete cree avec CE lien (inscription depuis l'invitation).
  // Sinon (telephone deja connecte a un autre compte), on demande confirmation : sinon le mauvais compte
  // rejoindrait le groupe sans que la personne ait pu creer le sien.
  useEffect(() => {
    if (tried.current) return
    tried.current = true
    void (async () => {
      const { data } = await supabase.auth.getUser()
      const meta = data.user?.user_metadata ?? {}
      const saved = String(meta.display_name ?? '').trim()
      setName(saved)
      setEmail(data.user?.email ?? '')
      if (saved && meta.invite === token) await join(saved)
      else setBusy(false)
    })()
  }, [join, token])

  async function notMe() {
    // l'invitation reste en memoire (sessionStorage) : l'ecran de connexion s'ouvrira sur « Creer un compte »
    sessionStorage.setItem('cercly.invite', token)
    await supabase.auth.signOut()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    await join(name.trim())
  }

  if (busy && !msg) return <div className="center">{t('loading')}</div>

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>{t('joinTitle')}</h1>
        <p>{t('joinIntro')}</p>
        {email && <p className="small">{tx.joinAs.replace('{email}', email)}</p>}
        <label className="field">
          <span>{t('yourName')}</span>
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {msg && <p className="msg">{msg}</p>}
        <div className="row">
          <button className="btn primary" disabled={busy}>
            {t('join')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void clearInvite().then(onDone)
            }}
          >
            {t('cancel')}
          </button>
        </div>
        <button type="button" className="link" onClick={() => void notMe()}>
          {tx.notMe}
        </button>
        <p className="small">{tx.notMeHint}</p>
      </form>
    </div>
  )
}

export function GroupsGate({ userId }: { userId: string }) {
  const { t } = useI18n()
  const [groups, setGroups] = useState<MyGroup[] | null>(null)
  const [error, setError] = useState('')
  const [invite, setInvite] = useState<string | null>(() => sessionStorage.getItem('cercly.invite'))
  const [inviteChecked, setInviteChecked] = useState(invite !== null)

  // Le code d'invitation peut aussi venir du compte (inscription faite depuis le lien).
  useEffect(() => {
    if (invite !== null) return
    void supabase.auth.getUser().then(({ data }) => {
      const saved = data.user?.user_metadata?.invite
      if (typeof saved === 'string' && saved) setInvite(saved)
      setInviteChecked(true)
    })
  }, [invite])

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('memberships')
      .select('group_id,user_id,display_name,is_president,can_validate,can_publish,status,groups(id,name,type,currency,period,visibility,loan_decision_mode,expected_amount,initial_amount,start_month)')
      .eq('user_id', userId)
      .eq('status', 'active')
    if (err) {
      setError(errMsg(err))
      return
    }
    const rows = (data ?? []) as unknown as Row[]
    setGroups(rows.map((m) => ({ ...m, group: m.groups })))
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <div className="center"><p className="msg">{error}</p></div>
  if (groups === null || !inviteChecked) return <div className="center">{t('loading')}</div>
  if (invite)
    return (
      <JoinGroup
        token={invite}
        onDone={() => {
          setInvite(null)
          void load()
        }}
      />
    )
  if (groups.length === 0)
    return (
      <div className="center">
        <Welcome onCreated={() => void load()} onInvite={setInvite} />
      </div>
    )
  return <Shell userId={userId} groups={groups} reload={load} />
}
