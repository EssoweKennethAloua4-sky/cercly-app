import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './supabase'
import { useI18n } from './i18n'
import { AuthScreen } from './screens/Auth'
import { MfaScreen } from './screens/Mfa'
import { GroupsGate } from './screens/GroupsGate'

type Gate = 'loading' | 'signed-out' | 'mfa' | 'ready'

// Lien d'invitation (?invite=CODE) : on garde le code en memoire des l'ouverture de la page,
// que la personne soit connectee ou non, puis on le retire de l'adresse.
;(() => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('invite')
  if (!code) return
  sessionStorage.setItem('cercly.invite', code)
  params.delete('invite')
  const rest = params.toString()
  window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash)
})()

export default function App() {
  const { t } = useI18n()
  const [session, setSession] = useState<Session | null>(null)
  const [gate, setGate] = useState<Gate>('loading')

  const evaluate = useCallback(async (s: Session | null) => {
    setSession(s)
    if (!s) {
      setGate('signed-out')
      return
    }
    // La 2FA n'est demandee que si la personne l'a activee elle-meme.
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    const needsCode = data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
    setGate(needsCode ? 'mfa' : 'ready')
  }, [])

  useEffect(() => {
    if (!configured) return
    void supabase.auth.getSession().then(({ data }) => evaluate(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setTimeout(() => void evaluate(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [evaluate])

  if (!configured)
    return (
      <div className="center">
        <p className="card narrow">{t('configMissing')}</p>
      </div>
    )
  if (gate === 'loading') return <div className="center">{t('loading')}</div>
  if (gate === 'signed-out' || !session) return <AuthScreen />
  if (gate === 'mfa')
    return <MfaScreen onDone={() => void supabase.auth.getSession().then(({ data }) => evaluate(data.session))} />
  return <GroupsGate userId={session.user.id} />
}
