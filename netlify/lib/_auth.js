// Autenticación segura con JWT en cookies HttpOnly
// Usuario fijo: "administrador-del-lote"
// Contraseña se lee de variable de entorno o default

const FIXED_USER = 'administrador-del-lote'
const SESSION_COOKIE_NAME = 'cajero_session'
const SESSION_TTL_SECONDS = 28800 // 8 horas

function getEnv(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env) {
    return Netlify.env.get(name)
  }
  return Deno.env.get(name)
}

function getAllowedOrigin() {
  // Usar variable de entorno o default a wildcard
  // Config esperada: ALLOWED_ORIGIN=https://rfwdsfgdnfdfgegdbf0pbodgt0odnbot348n.netlify.app
  return getEnv('ALLOWED_ORIGIN') || '*'
}

function getCorsHeaders(req) {
  const origin = req.headers.get('origin') || getAllowedOrigin()
  const allowedOrigin = getAllowedOrigin()
  
  // Si ALLOWED_ORIGIN está configurado, validar que el origen coincida
  if (allowedOrigin !== '*' && origin !== allowedOrigin) {
    // Aún responder con el origen configurado permitido
    return {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
    }
  }
  
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export function jsonResponse(payload, status = 200, req = null, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(req ? getCorsHeaders(req) : { 'Access-Control-Allow-Origin': '*' }),
    ...extraHeaders,
  }
  return new Response(JSON.stringify(payload), { status, headers })
}

function base64UrlEncode(str) {
  const b = new TextEncoder().encode(str)
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded)
  return new TextDecoder().decode(new Uint8Array(binary.split('').map(c => c.charCodeAt(0))))
}

async function hmacSign(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)))
}

function getSessionSecret() {
  const secret = getEnv('SESSION_SECRET')
  if (!secret || secret.length < 32) {
    console.warn('[AUTH] SESSION_SECRET no configurado o muy corto, usando default (INSEGURO para producción)')
    return 'default-session-secret-change-in-env-32-chars-minimum-123456'
  }
  return secret
}

export async function createSessionToken(user = FIXED_USER) {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + SESSION_TTL_SECONDS
  
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({ sub: user, iat: now, exp }))
  const message = `${header}.${payload}`
  const signature = await hmacSign(message, getSessionSecret())
  
  return `${message}.${signature}`
}

export async function verifySessionToken(token) {
  if (!token) return null
  
  const parts = token.split('.')
  if (parts.length !== 3) return null
  
  const [header, payload, signature] = parts
  const message = `${header}.${payload}`
  const expectedSignature = await hmacSign(message, getSessionSecret())
  
  if (signature !== expectedSignature) return null
  
  try {
    const payloadData = JSON.parse(base64UrlDecode(payload))
    const now = Math.floor(Date.now() / 1000)
    
    if (payloadData.exp <= now) return null // Token expirado
    return payloadData
  } catch {
    return null
  }
}

function getCajeroCookie(token) {
  const maxAge = SESSION_TTL_SECONDS
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}

function getClearCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export async function handleLogin(req) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }
  
  let body = {}
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400, req)
  }
  
  const password = String(body?.password || '').trim()
  const configuredPassword = getEnv('ADMIN_PASSWORD')
  
  if (!password) {
    return jsonResponse({ error: 'Contraseña requerida' }, 400, req)
  }
  
  if (!configuredPassword) {
    console.warn('[AUTH] ADMIN_PASSWORD no configurado en variables de entorno')
    return jsonResponse({ error: 'Servidor no configurado' }, 500, req)
  }
  
  if (password !== configuredPassword) {
    return jsonResponse({ error: 'Contraseña inválida' }, 401, req)
  }
  
  const token = await createSessionToken(FIXED_USER)
  return jsonResponse(
    { success: true, user: FIXED_USER },
    200,
    req,
    { 'Set-Cookie': getCajeroCookie(token) },
  )
}

export function handleLogout(req) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, req)
  }
  
  return jsonResponse(
    { success: true },
    200,
    req,
    { 'Set-Cookie': getClearCookie() },
  )
}

export async function requireAuth(req) {
  const cookies = parseCookies(req.headers.get('cookie') || '')
  const token = cookies[SESSION_COOKIE_NAME]
  
  if (!token) {
    return { ok: false, error: 'No autorizado', status: 401 }
  }
  
  const payload = await verifySessionToken(token)
  if (!payload) {
    return { ok: false, error: 'Sesión inválida o expirada', status: 401 }
  }
  
  return { ok: true, user: payload.sub }
}

function parseCookies(cookieHeader) {
  const cookies = {}
  if (!cookieHeader) return cookies
  
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.split('=').map(c => c.trim())
    if (name && value) {
      cookies[name] = decodeURIComponent(value)
    }
  })
  
  return cookies
}

export function getCorsHeadersForRequest(req) {
  return getCorsHeaders(req)
}
