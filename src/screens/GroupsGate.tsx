import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { GroupInfo, Membership, MyGroup } from '../types'
import { errMsg } from '../lib/format'
import { CreateGroup } from './CreateGroup'
import { Shell } from './Shell'

type Row = Membership & { groups: GroupInfo }

function JoinGroup({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc('accept_invitation', { p_token: token, p_display_name: name })
    setBusy(false)
    if (error) setMsg(errMsg(error))
    else {
      sessionStorage.removeItem('cercly.invite')
      onDone()
    }
  }

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
              sessionStorage.removeItem('cercly.invite')
              onDone()
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

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('memberships')
      .select('group_id,user_id,display_name,is_president,can_validate,can_publish,status,groups(id,name,type,currency,period,visibility,loan_decision_mode)')
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
  if (groups === null) return <div className="center">{t('loading')}</div>
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
