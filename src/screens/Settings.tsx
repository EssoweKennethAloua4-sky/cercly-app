import { useState } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import type { GroupModules, ModuleName, MyGroup } from '../types'
import { errMsg } from '../lib/format'

const MODULES: ModuleName[] = ['annonces', 'cotisations', 'rappels', 'prets']

export function Settings({ group, modules, reloadModules, reloadGroups }: { group: MyGroup; modules: GroupModules; reloadModules: () => Promise<void>; reloadGroups: () => Promise<void> }) {
  const { t } = useI18n()
  const gid = group.group_id
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)

  async function setModule(m: ModuleName, enabled: boolean) {
    setMsg('')
    setOk(false)
    const { error } = await supabase.from('group_modules').update({ enabled }).eq('group_id', gid).eq('module', m)
    if (error) setMsg(errMsg(error))
    else setOk(true)
    await reloadModules()
  }

  async function setField(field: 'loan_decision_mode' | 'visibility' | 'period', value: string) {
    setMsg('')
    setOk(false)
    const { error } = await supabase.from('groups').update({ [field]: value }).eq('id', gid)
    if (error) setMsg(errMsg(error))
    else setOk(true)
    await reloadGroups()
  }

  return (
    <div className="stack">
      <h2>{t('setTitle')}</h2>
      {msg && <p className="msg">{msg}</p>}
      {ok && <p className="ok-text">{t('setSaved')}</p>}

      <section className="card">
        <h3>{t('setModules')}</h3>
        {MODULES.map((m) => (
          <label key={m} className="check">
            <input type="checkbox" checked={modules[m]} onChange={(e) => void setModule(m, e.target.checked)} />
            {t(`mod_${m}`)}
          </label>
        ))}
      </section>

      <section className="card">
        <label className="field">
          <span>{t('setLoanMode')}</span>
          <select value={group.group.loan_decision_mode} onChange={(e) => void setField('loan_decision_mode', e.target.value)}>
            <option value="vote_tous">{t('mode_vote_tous')}</option>
            <option value="responsables">{t('mode_responsables')}</option>
          </select>
        </label>
      </section>

      <section className="card">
        <label className="field">
          <span>{t('setVisibility')}</span>
          <select value={group.group.visibility} onChange={(e) => void setField('visibility', e.target.value)}>
            <option value="tous">{t('vis_tous')}</option>
            <option value="soi">{t('vis_soi')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('setPeriod')}</span>
          <select value={group.group.period} onChange={(e) => void setField('period', e.target.value)}>
            {['jour', 'semaine', 'mois', 'annee'].map((p) => (
              <option key={p} value={p}>
                {t(`per_${p}`)}
              </option>
            ))}
          </select>
        </label>
      </section>
    </div>
  )
}
