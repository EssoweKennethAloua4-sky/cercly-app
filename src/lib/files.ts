export const MAX_BYTES = 5 * 1024 * 1024
export const MAX_FILES = 5
export const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

export const validFile = (f: File): boolean => ALLOWED.includes(f.type) && f.size > 0 && f.size <= MAX_BYTES

export interface Prepared {
  blob: Blob
  mime: string
  ext: string
}

// Les images sont redessinées puis ré-encodées : cela supprime toutes les données cachées
// (position GPS, appareil photo...) et réduit la taille. Les PDF sont envoyés tels quels.
export async function prepareFile(f: File): Promise<Prepared> {
  if (f.type === 'application/pdf') return { blob: f, mime: f.type, ext: 'pdf' }
  const bmp = await createImageBitmap(f)
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image illisible')
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image illisible'))), 'image/jpeg', 0.9),
  )
  if (blob.size > MAX_BYTES) throw new Error('Image trop lourde')
  return { blob, mime: 'image/jpeg', ext: 'jpg' }
}
