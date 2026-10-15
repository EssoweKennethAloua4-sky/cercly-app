import { useI18n } from '../i18n'
import type { Locale } from '../types'

export function LangSwitch({ onChange }: { onChange?: (l: Locale) => void }) {
  const { locale, setLocale, t } = useI18n()
  return (
    <select
      className="lang"
      aria-label={t('language')}
      value={locale}
      onChange={(e) => {
        const l: Locale = e.target.value === 'en' ? 'en' : 'fr'
        setLocale(l)
        onChange?.(l)
      }}
    >
      <option value="fr">FR</option>
      <option value="en">EN</option>
    </select>
  )
}
