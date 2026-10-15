import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { AppNotification } from '../types'
import { day, money } from '../lib/format'

export function NotificationsPanel({ groupId, currency, onRead }: { groupId: string; currency: string; onRead: () => void }) {
  const { t, locale } = useI18n()
  const [items, setItems] = useState<AppNotification[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('id,group_id,kind,details,read_at,created_at')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(50)
    setItems((data ?? []) as AppNotification[])
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  const text = (n: AppNotification) => {
    const d = n.details
    return t(`n_${n.kind}`, {
      amount: d.amount !== undefined ? money(Number(d.amount), currency, locale) : '',
      title: String(d.title ?? ''),
      reason: String(d.reason ?? ''),
      name: String(d.name ?? ''),
    })
  }

  async function markAll() {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('group_id', groupId).is('read_at', null)
    await load()
    onRead()
  }

  return (
    <div className="panel" role="dialog" aria-label={t('notifTitle')}>
      <div className="row between">
        <strong>{t('notifTitle')}</strong>
        <button className="link" onClick={() => void markAll()}>
          {t('notifMarkRead')}
        </button>
      </div>
      {items.length === 0 && <p className="small">{t('notifNone')}</p>}
      <ul className="notifs">
        {items.map((n) => (
          <li key={n.id} className={n.read_at ? '' : 'unread'}>
            <div>{text(n)}</div>
            <small>{day(n.created_at, locale)}</small>
          </li>
        ))}
      </ul>
    </div>
  )
}
