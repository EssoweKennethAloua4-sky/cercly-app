import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { MemberTotal, MyGroup } from '../types'
import { errMsg, money } from '../lib/format'

export function Overview({ group }: { group: MyGroup }) {
  const { t, locale } = useI18n()
  const cur = group.group.currency
  const [validated, setValidated] = useState(0)
  const [pending, setPending] = useState(0)
  const [rows, setRows] = useState<MemberTotal[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void (async () => {
      const a = await supabase.rpc('group_total', { p_group: group.group_id })
      const b = await supabase.rpc('group_totals', { p_group: group.group_id })
      if (a.error || b.error) {
        setMsg(errMsg(a.error ?? b.error))
        return
      }
      const first = (a.data as Array<{ validated: number; pending: number }>)[0]
      setValidated(Number(first?.validated ?? 0))
      setPending(Number(first?.pending ?? 0))
      setRows(
        (b.data as MemberTotal[]).map((r) => ({ ...r, validated: Number(r.validated), pending: Number(r.pending) })),
      )
    })()
  }, [group.group_id])

  const max = Math.max(1, ...rows.map((r) => r.validated))

  return (
    <div className="stack">
      <h2>{t('ovTitle')}</h2>
      {msg && <p className="msg">{msg}</p>}
      <div className="grid2">
        <div className="card">
          <small>{t('ovValidated')}</small>
          <div className="big ok-text">{money(validated, cur, locale)}</div>
        </div>
        <div className="card">
          <small>{t('ovPending')}</small>
          <div className="big warn-text">{money(pending, cur, locale)}</div>
        </div>
      </div>
      <div className="card">
        <h3>{t('ovPerMember')}</h3>
        {rows.map((r) => (
          <div key={r.user_id} className="member-row">
            <div className="row between">
              <span>{r.display_name}</span>
              <span>
                {money(r.validated, cur, locale)}
                {r.pending > 0 && <small className="warn-text"> (+{money(r.pending, cur, locale)})</small>}
              </span>
            </div>
            <progress max={max} value={r.validated} />
          </div>
        ))}
      </div>
    </div>
  )
}
