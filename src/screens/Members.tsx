import { useState } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { Membership, MyGroup } from '../types'
import { leads } from '../types'
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
  const isP = leads(group) // president ou secretaire : gere les membres
  const isTrueP = group.is_president // le president seul : secretaire, transmission
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

  async function createLink() {
    setMsg('')
    setCopied(false)
    const { data, error } = await supabase.rpc('create_invite_link', { p_group: gid })
    if (error) {
      setMsg(errMsg(error))
      return
    }
    setLink(`${window.location.origin}/?invite=${String(data)}`)
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

  async function setSecretary(m: Membership | null) {
    const ok = m
      ? window.confirm(t('memSecretaryConfirm', { name: m.display_name }))
      : window.confirm(t('memSecretaryRemoveConfirm'))
    if (!ok) return
    setMsg('')
    const { error } = await supabase.rpc('set_secretary', { p_group: gid, p_user: m ? m.user_id : null })
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

  const whatsappUrl = link
    ? `https://wa.me/?text=${encodeURIComponent(t('memInviteMsg', { group: group.group.name, link }))}`
    : ''

  return (
    <div className="stack">
      <h2>{t('memTitle')}</h2>
      {isP && <p className="small">{t('memValidatorsHint')}</p>}
      {isP && validators < 2 && <p className="hint-warn">{t('memWarnOneValidator')}</p>}
      {msg && <p className="msg">{msg}</p>}

      {isP && (
        <div className="card">
          <h3>{t('memInvite')}</h3>
          <button type="button" className="btn primary" onClick={() => void createLink()}>
            {t('memInviteBtn')}
          </button>
          {link && (
            <div className="stack">
              <p className="small">{t('memInviteLink')}</p>
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
              <div className="row wrap">
                <button type="button" className="btn small" onClick={() => void copy()}>
                  {copied ? t('copied') : t('copy')}
                </button>
                <a className="btn small" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                  {t('memShareWhatsapp')}
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {members.map((m) => (
        <article key={m.user_id} className="card">
          <div className="row between">
            <strong>{m.display_name}</strong>
            <span className="tag">
              {t(m.is_president ? 'role_president' : m.is_secretary ? 'role_secretary' : m.can_validate ? 'role_validator' : m.can_publish ? 'role_publisher' : 'role_member')}
            </span>
          </div>
          {isP && !m.is_president && (
            <>
              <label className="check switch">
                {t('memCanValidate')}
                <input type="checkbox" role="switch" checked={m.can_validate} onChange={() => void toggle(m, 'can_validate')} />
              </label>
              <label className="check switch">
                {t('memCanPublish')}
                <input type="checkbox" role="switch" checked={m.can_publish} onChange={() => void toggle(m, 'can_publish')} />
              </label>
              <div className="row wrap">
                {isTrueP &&
                  (m.is_secretary ? (
                    <button className="btn small" onClick={() => void setSecretary(null)}>
                      {t('memSecretaryRemove')}
                    </button>
                  ) : (
                    <button className="btn small" onClick={() => void setSecretary(m)}>
                      {t('memSecretaryMake')}
                    </button>
                  ))}
                {isTrueP && (
                  <button className="btn small" onClick={() => void transfer(m)}>
                    {t('memTransfer')}
                  </button>
                )}
                {(isTrueP || !m.is_secretary) && m.user_id !== userId && (
                  <button className="btn small danger" onClick={() => void removeMember(m)}>
                    {t('remove')}
                  </button>
                )}
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  )
}
