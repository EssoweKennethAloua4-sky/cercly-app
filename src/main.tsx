import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import { PublicLoan } from './screens/PublicLoan'
// Police embarquee dans l'app (pas de Google Fonts : bloque par la CSP et indisponible hors ligne).
import '@fontsource-variable/plus-jakarta-sans'
import './lib/install'
import './styles.css'

const params = new URLSearchParams(window.location.search)

// Une invitation au groupe arrive par lien (?invite=...). On garde le jeton le temps de la session
// et on le retire aussitôt de l'adresse (historique, copier-coller, en-têtes).
const invite = params.get('invite')
if (invite) {
  sessionStorage.setItem('cercly.invite', invite)
  window.history.replaceState({}, '', window.location.pathname)
}

// Lien de demande de prêt (?pret=...) : page publique, sans connexion.
const pret = params.get('pret')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>{pret ? <PublicLoan token={pret} /> : <App />}</I18nProvider>
  </React.StrictMode>,
)
