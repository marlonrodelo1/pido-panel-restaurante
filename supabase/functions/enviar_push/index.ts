// enviar_push v25 — fix sonido en background:
//   - android.notification: añade default_sound, default_vibrate_timings, notification_priority MAX,
//     visibility PUBLIC, channel_id "pedidos" (debe existir en MainActivity con setSound).
//   - apns: añade `mutable-content` y eleva apns-priority/apns-push-type para iOS background.
//   - webpush: igual que antes pero con sound (browser-dependent).
// Importante: el cliente Android tiene que tener el NotificationChannel "pedidos"
// creado con setSound() para que suene en background. Si el canal estaba creado
// previamente sin sonido, MainActivity lo borra y recrea (ver MainActivity.java).
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts'

// CORS inline (sin depender de _shared/cors.ts)
const CORS_BASE: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function getCorsHeaders(_req: Request) { return { ...CORS_BASE, 'Content-Type': 'application/json' } }
function handleCorsPreflightRequest(_req: Request) { return new Response('ok', { headers: CORS_BASE }) }

const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'pidoo-push'
const FIREBASE_CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL') || 'firebase-adminsdk-fbsvc@pidoo-push.iam.gserviceaccount.com'
const FIREBASE_PRIVATE_KEY = Deno.env.get('FIREBASE_PRIVATE_KEY') || ''

let cachedAccessToken: string | null = null

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iss: FIREBASE_CLIENT_EMAIL, sub: FIREBASE_CLIENT_EMAIL, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, scope: 'https://www.googleapis.com/auth/firebase.messaging' }
  const headerB64 = base64url(new TextEncoder().encode(JSON.stringify(header)))
  const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(payload)))
  const unsignedToken = `${headerB64}.${payloadB64}`
  const pemContent = FIREBASE_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\\\\n/g, '').replace(/\\n/g, '').replace(/\s/g, '')
  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsignedToken))
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error('Failed to get FCM access token')
  cachedAccessToken = tokenData.access_token
  return cachedAccessToken!
}

function stringifyData(data: any): Record<string, string> {
  const out: Record<string, string> = {}
  if (!data || typeof data !== 'object') return out
  for (const k of Object.keys(data)) {
    const v = data[k]
    if (v === null || v === undefined) continue
    if (typeof v === 'string') out[k] = v
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
    else out[k] = JSON.stringify(v)
  }
  return out
}

async function sendFCM(fcmToken: string, title: string, body: string, data: Record<string, string> = {}): Promise<{ ok: boolean; status: number; error?: string; unregistered?: boolean }> {
  const accessToken = await getAccessToken()
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title, body },
        data,
        android: {
          priority: 'high',
          ttl: '600s',
          notification: {
            sound: 'default',
            channel_id: 'pedidos',
            default_sound: true,
            default_vibrate_timings: false,
            vibrate_timings: ['0s', '0.3s', '0.1s', '0.3s', '0.1s', '0.3s'],
            notification_priority: 'PRIORITY_MAX',
            visibility: 'PUBLIC',
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'alert',
          },
          payload: {
            aps: {
              alert: { title, body },
              sound: 'default',
              badge: 1,
              'content-available': 1,
              'mutable-content': 1,
            },
          },
        },
        webpush: {
          notification: {
            title,
            body,
            icon: '/favicon.png',
            requireInteraction: true,
            vibrate: [500, 200, 500, 200, 500],
          },
          headers: { Urgency: 'high', TTL: '600' },
        },
      },
    }),
  })
  if (res.ok) return { ok: true, status: res.status }
  const errBody = await res.text()
  const unregistered = errBody.includes('UNREGISTERED') || errBody.includes('NOT_FOUND') || res.status === 404
  return { ok: false, status: res.status, error: errBody, unregistered }
}

async function dbgLog(supabase: any, event: string, details: any) {
  try { await supabase.from('push_debug_logs').insert({ platform: 'edge', event: 'enviar_push:' + event, details: details ? JSON.stringify(details).slice(0, 1500) : null }) } catch (_) {}
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest(req)
  const CORS = getCorsHeaders(req)
  cachedAccessToken = null

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: CORS })
    const token = authHeader.replace('Bearer ', '')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (token !== serviceRoleKey && token !== anonKey) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token)
      if (authError || !user) return new Response(JSON.stringify({ error: 'Token invalido' }), { status: 401, headers: CORS })
    }

    const reqBody = await req.json()
    const { target_type, target_id, title, body, data, user_ids } = reqBody
    const safeData = stringifyData(data)
    await dbgLog(supabase, 'received', { user_ids, target_type, target_id, title })

    if (target_type === 'cliente' && target_id) {
      try { await supabase.rpc('claim_orphan_push_tokens_for', { p_user_id: target_id, p_user_type: 'cliente' }) } catch (_) {}
    }

    let query = supabase.from('push_subscriptions').select('*').not('fcm_token', 'is', null).neq('fcm_token', 'DEBUG').like('endpoint', 'fcm:%')
    if (Array.isArray(user_ids) && user_ids.length > 0) query = query.in('user_id', user_ids)
    else if (target_type === 'cliente' && target_id) query = query.eq('user_id', target_id).eq('user_type', 'cliente')
    else if (target_type === 'restaurante' && target_id) query = query.eq('establecimiento_id', target_id).eq('user_type', 'restaurante')
    else if (target_type === 'socio' && target_id) query = query.eq('user_id', target_id).eq('user_type', 'socio')
    else if (target_type === 'cliente') query = query.eq('user_type', 'cliente').not('user_id', 'is', null)
    else if (target_type === 'restaurante') query = query.eq('user_type', 'restaurante').not('establecimiento_id', 'is', null)
    else query = query.in('user_type', ['cliente', 'restaurante', 'socio']).or('user_id.not.is.null,establecimiento_id.not.is.null')

    const { data: subs, error: subsErr } = await query
    if (subsErr) return new Response(JSON.stringify({ error: subsErr.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
    if (!subs || subs.length === 0) { await dbgLog(supabase, 'no_subs', { user_ids, target_type, target_id }); return new Response(JSON.stringify({ sent: 0, total: 0 }), { headers: { ...CORS, 'Content-Type': 'application/json' } }) }

    const uniq = new Map<string, any>()
    for (const s of subs) { if (s.fcm_token && !uniq.has(s.fcm_token)) uniq.set(s.fcm_token, s) }
    const uniqueSubs = Array.from(uniq.values())

    const results = await Promise.all(
      uniqueSubs.map(async (sub) => {
        try {
          const r = await sendFCM(sub.fcm_token, title, body, safeData)
          if (r.ok) await dbgLog(supabase, 'fcm_ok', { token: sub.fcm_token.slice(0, 16) })
          else await dbgLog(supabase, 'fcm_fail', { token: sub.fcm_token.slice(0, 16), status: r.status, error: (r.error || '').slice(0, 600) })
          return { id: sub.id, ok: r.ok, unregistered: r.unregistered }
        } catch (e) {
          await dbgLog(supabase, 'fcm_exception', { msg: (e as any).message || String(e) })
          return { id: sub.id, ok: false, unregistered: false }
        }
      })
    )

    const sent = results.filter(r => r.ok).length
    const toDelete = results.filter(r => r.unregistered).map(r => r.id)
    if (toDelete.length > 0) await supabase.from('push_subscriptions').delete().in('id', toDelete)

    return new Response(JSON.stringify({ sent, total: uniqueSubs.length, deleted_invalid: toDelete.length }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as any).message }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
