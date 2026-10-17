import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { GroupInfo, Membership, MyGroup } from '../types'
import { errMsg } from '../lib/format'
import { CreateGroup } from './CreateGroup'
import { Shell } from './Shell'

type Row = Membership & { groups: GroupInfo }

async function clearInvite() {
  sessionStorage.removeItem('cercly.invite')
  await supabase.auth.updateUser({ data: { invite: null } })
}

function JoinGroup({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
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

  // Si le prenom est deja dans le compte, on rejoint directement.
  useEffect(() => {
    if (tried.current) return
    tried.current = true
    void (async () => {
      const { data } = await supabase.auth.getUser()
      const saved = String(data.user?.user_metadata?.display_name ?? '').trim()
      if (saved) {
        setName(saved)
        await join(saved)
      } else setBusy(false)
    })()
  }, [join])

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
        <CreateGroup first onDone={() => void load()} />
      </div>
    )
  return <Shell userId={userId} groups={groups} reload={load} />
}
