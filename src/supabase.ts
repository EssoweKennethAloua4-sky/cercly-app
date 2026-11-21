import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = Boolean(url && key)

// Clé "anon" uniquement : toute la sécurité repose sur les règles de la base (schema.sql).
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})

// Mode demo (bouton « Essayer la démo ») : un compte partage, limite par la base (migration v0.17).
// Le mot de passe est public par nature : c'est la base qui empeche ce compte de nuire.
const demoEmail = (import.meta.env.VITE_DEMO_EMAIL as string | undefined)?.trim().toLowerCase()
const demoPassword = import.meta.env.VITE_DEMO_PASSWORD as string | undefined

export const demoAvailable = Boolean(demoEmail && demoPassword)

export const isDemoEmail = (email: string | null | undefined): boolean =>
  demoAvailable && email?.trim().toLowerCase() === demoEmail

// Compte demo connecte en ce moment (fixe par App des que la session est connue)
let demoSession = false
export const isDemo = (): boolean => demoSession
export const setDemoSession = (on: boolean): void => {
  demoSession = on
}

export const signInDemo = () => supabase.auth.signInWithPassword({ email: demoEmail ?? '', password: demoPassword ?? '' })

// Deconnexion : pour le compte demo, seulement cet appareil, sinon tous les autres visiteurs seraient deconnectes.
export const signOut = () => supabase.auth.signOut(demoSession ? { scope: 'local' } : undefined)
