import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
import { useI18n } from '../i18n'
import { errMsg } from '../lib/format'

const TYPES = ['tontine', 'association', 'famille', 'equipe', 'classe', 'autre']
const CURRENCIES = ['XOF', 'XAF', 'EUR', 'USD', 'CAD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'MAD', 'DZD', 'TND', 'GHS', 'NGN', 'GNF', 'CDF', 'KES', 'ZAR', 'EGP', 'AED', 'CNY', 'JPY', 'BRL']

export function CreateGroup({ onDone, onCancel, first }: { onDone: (id: string) => void; onCancel?: () => void; first?: boolean }) {
  const { t, locale } = useI18n()
  const [name, setName] = useState('')
  const [type, setType] = useState('tontine')
  const [currency, setCurrency] = useState('XOF')
  const [display, setDisplay] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  // Le prenom a deja ete donne a l'inscription : on le propose plutot que de le redemander.
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const saved = String(data.user?.user_metadata?.display_name ?? '').trim()
      if (saved) setDisplay((d) => d || saved)
    })
  }, [])

  // Noms des monnaies dans la langue de l'utilisateur ; repli sur le code seul si le navigateur ne sait pas.
  const currencyOptions = useMemo(() => {
    let names: Intl.DisplayNames | null = null
    try {
      names = new Intl.DisplayNames([locale], { type: 'currency' })
    } catch {
      names = null
    }
    return CURRENCIES.map((c) => ({ code: c, label: `${c} — ${names?.of(c) ?? c}` }))
  }, [locale])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const { data, error } = await supabase.rpc('create_group', {
      p_name: name,
      p_type: type,
      p_currency: currency,
      p_display_name: display,
    })
    setBusy(false)
    if (error) setMsg(errMsg(error))
    else onDone(String(data))
  }

  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>{t('createGroupTitle')}</h1>
      {first && <p className="small">{t('noGroupHint')}</p>}
      <label className="field">
        <span>{t('groupName')}</span>
        <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('groupType')}</span>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`type_${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('currency')}</span>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {currencyOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('yourName')}</span>
        <input required maxLength={60} value={display} onChange={(e) => setDisplay(e.target.value)} />
        <small>{t('yourNameHint')}</small>
      </label>
      {msg && <p className="msg">{msg}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {t('create')}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {t('cancel')}
          </button>
        )}
        {first && (
          <button type="button" className="link" onClick={() => void supabase.auth.signOut()}>
            {t('signOut')}
          </button>
        )}
      </div>
    </form>
  )
}
