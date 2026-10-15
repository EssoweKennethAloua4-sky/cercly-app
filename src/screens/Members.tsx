import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { Membership, MyGroup } from '../types'
import { errMsg } from '../lib/format'

interface Props {
  group: MyGroup
  members: Membership[]
  userId: string
  reloadMembers: () => Promise<void>
  reloadGroups: () => Promise<void>
}

export function Members({ group, members, userId, reloadMembers, reloadGroups }: Props) {
  const { t } = useI18n()
  const gid = group.group_id
  const isP = group.is_president
  const [email, setEmail] = useState('')
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState('')

  const validators = members.filter((m) => m.can_validate || m.is_president).length

  async function toggle(m: Membership, field: 'can_validate' | 'can_publish') {
    setMsg('')
    const { error } = await supabase.from('memberships').update({ [field]: !m[field] }).eq('group_id', gid).eq('user_id', m.user_id)
    if (error) setMsg(errMsg(error))
    await reloadMembers()
  }

  async function invite(e: FormEvent) {
    e.preventDefault()
    setMsg('')
    setLink('')
    setCopied(false)
    const { data, error } = await supabase.rpc('invite_member', { p_group: gid, p_email: email })
    if (error) setMsg(errMsg(error))
    else {
      setLink(`${window.location.origin}/?invite=${String(data)}`)
      setEmail('')
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(link)
    setCopied(true)
  }

  async function transfer(m: Membership) {
    if (!window.confirm(t('memTransferConfirm', { name: m.display_name }))) return
    setMsg('')
    const { error } = await supabase.rpc('transfer_presidency', { p_group: gid, p_new: m.user_id })
    if (error) setMsg(errMsg(error))
    await reloadGroups()
    await reloadMembers()
  }

  async function removeMember(m: Membership) {
    if (!window.confirm(t('memRemoveConfirm', { name: m.display_name }))) return
    setMsg('')
    const { error } = await supabase.from('memberships').update({ status: 'removed' }).eq('group_id', gid).eq('user_id', m.user_id)
    if (error) setMsg(errMsg(error))
    await reloadMembers()
  }

  return (
    <div className="stack">
      <h2>{t('memTitle')}</h2>
      {isP && <p className="small">{t('memValidatorsHint')}</p>}
      {isP && validators < 2 && <p className="msg">{t('memWarnOneValidator')}</p>}
      {msg && <p className="msg">{msg}</p>}

      {isP && (
        <form className="card" onSubmit={invite}>
          <h3>{t('memInvite')}</h3>
          <label className="field">
            <span>{t('email')}</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn primary">{t('memInviteBtn')}</button>
          {link && (
            <div className="stack">
              <p className="small">{t('memInviteLink')}</p>
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn small" onClick={() => void copy()}>
                {copied ? t('copied') : t('copy')}
              </button>
            </div>
          )}
        </form>
      )}

      {members.map((m) => (
        <article key={m.user_id} className="card">
          <div className="row between">
            <strong>{m.display_name}</strong>
            <span className="tag">
              {t(m.is_president ? 'role_president' : m.can_validate ? 'role_validator' : m.can_publish ? 'role_publisher' : 'role_member')}
            </span>
          </div>
          {isP && !m.is_president && (
            <>
              <label className="check">
                <input type="checkbox" checked={m.can_validate} onChange={() => void toggle(m, 'can_validate')} />
                {t('memCanValidate')}
              </label>
              <label className="check">
                <input type="checkbox" checked={m.can_publish} onChange={() => void toggle(m, 'can_publish')} />
                {t('memCanPublish')}
              </label>
              <div className="row wrap">
                <button className="btn small" onClick={() => void transfer(m)}>
                  {t('memTransfer')}
                </button>
                <button className="btn small danger" onClick={() => void removeMember(m)}>
                  {t('remove')}
                </button>
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  )
}
