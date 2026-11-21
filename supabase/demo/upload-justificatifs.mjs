// Depose les 3 faux justificatifs du groupe demo dans le stockage Supabase (une seule fois, apres la migration v0.17).
// Les chemins sont fixes : la remise a zero de chaque nuit les reutilise.
//
// A lancer depuis votre ordinateur, jamais dans l'application :
//   SUPABASE_URL=https://votre-projet.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node supabase/demo/upload-justificatifs.mjs
// (Supabase > Project Settings > API > service_role. Ne l'enregistrez dans aucun fichier.)
//
// Sans script : Storage > justificatifs, creez le dossier dddddddd-0000-4000-8000-000000000001,
// dedans les dossiers dddddddd-0000-4000-8000-000000000201, ...202 et ...203,
// et deposez dans chacun recu-1.png, recu-2.png ou recu-3.png renomme en recu.png.
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Renseignez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const group = 'dddddddd-0000-4000-8000-000000000001'

for (const i of [1, 2, 3]) {
  const path = `${group}/dddddddd-0000-4000-8000-00000000020${i}/recu.png`
  const file = await readFile(new URL(`./recu-${i}.png`, import.meta.url))
  const { error } = await supabase.storage.from('justificatifs').upload(path, file, { contentType: 'image/png', upsert: true })
  console.log(error ? `ECHEC ${path} : ${error.message}` : `OK ${path}`)
}
