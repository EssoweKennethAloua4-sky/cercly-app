import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { Announcement, Membership, MyGroup } from '../types'
import { day, errMsg } from '../lib/format'

export function Announcements({ group, members, userId }: { group: MyGroup; members: Membership[]; userId: string }) {
  const { t, locale } = useI18n()
  const gid = group.group_id
  const canPublish = group.can_publish || group.is_president
  const [items, setItems] = useState<Announcement[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('announcements')
      .select('id,author_id,title,body,created_at')
      .eq('group_id', gid)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) setMsg(errMsg(error))
    else setItems((data ?? []) as Announcement[])
  }, [gid])

  useEffect(() => {
    void load()
  }, [load])

  async function publish(e: FormEvent) {
    e.preventDefault()
    setMsg('')
    const { error } = await supabase.from('announcements').insert({ group_id: gid, author_id: userId, title, body })
    if (error) setMsg(errMsg(error))
    else {
      setTitle('')
      setBody('')
      await load()
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) setMsg(errMsg(error))
    else await load()
  }

  const name = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? '—'

  return (
    <div className="stack">
      {canPublish && (
        <form className="card" onSubmit={publish}>
          <h2>{t('annNew')}</h2>
          <label className="field">
            <span>{t('annTitle')}</span>
            <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('annBody')}</span>
            <textarea required rows={3} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <button className="btn primary">{t('annPublish')}</button>
        </form>
      )}
      {msg && <p className="msg">{msg}</p>}
      {items.length === 0 && <p className="card small">{t('annEmpty')}</p>}
      {items.map((a) => (
        <article key={a.id} className="card accent">
          <div className="row between">
            <h3>{a.title}</h3>
            {(group.is_president || (canPublish && a.author_id === userId)) && (
              <button className="btn small" onClick={() => void remove(a.id)}>
                {t('annDelete')}
              </button>
            )}
          </div>
          <p className="pre">{a.body}</p>
          <small>
            {t('annBy', { name: name(a.author_id) })} · {day(a.created_at, locale)}
          </small>
        </article>
      ))}
    </div>
  )
}
