import { supabase } from './supabase'

/**
 * Sube una imagen a Supabase Storage y devuelve la URL pública.
 * @param {File} file - Archivo a subir
 * @param {string} bucket - Nombre del bucket (logos, banners, productos, store-assets)
 * @param {string} folder - Carpeta dentro del bucket (ej: "establecimientos", "socios")
 */
export async function uploadImage(file, bucket, folder = '') {
  if (!file.type.startsWith('image/'))
    throw new Error('Solo se permiten archivos de imagen')
  if (file.size > 5 * 1024 * 1024)
    throw new Error('La imagen no puede superar los 5 MB')

  const ext = file.name.split('.').pop()
  const fileName = `${folder ? folder + '/' : ''}${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await supabase.storage
    .from(bucket)
    .upload(fileName, file, { cacheControl: '3600', upsert: false })

  if (error) throw new Error('Error al subir imagen: ' + error.message)

  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(fileName)

  return urlData.publicUrl
}
