import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth, jsonResponse as authJsonResponse, getCorsHeadersForRequest } from '../lib/_auth.js'

const PESOS_POR_PUNTO = Number(getEnv('PESOS_POR_PUNTO') || 1000)

function getEnv(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env) {
    return Netlify.env.get(name)
  }
  return Deno.env.get(name)
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

function sanitizeTelefono(input) {
  return String(input || '').replace(/[^+0-9]/g, '')
}

export default async (req, _context) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeadersForRequest(req) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const auth = await requireAuth(req)
  if (!auth.ok) {
    return authJsonResponse({ error: auth.error }, auth.status, req)
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL')
    const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en variables de entorno')
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    const { telefono: telefonoRaw, monto: montoRaw } = await req.json()

    const telefono = sanitizeTelefono(telefonoRaw)
    const monto = Number(montoRaw)
    const cajeroId = String(auth.user || '').trim()

    if (!telefono) {
      throw new Error('Parámetros inválidos. Se requiere telefono válido.')
    }

    if (!Number.isFinite(monto) || monto <= 0) {
      throw new Error('Parámetros inválidos. Se requiere monto válido.')
    }

    // Optional lightweight guard to avoid absurd payloads.
    if (cajeroId.length > 80) {
      throw new Error('Parámetros inválidos. cajero demasiado largo.')
    }

    const puntos = Math.floor(monto / PESOS_POR_PUNTO)

    if (puntos < 1) {
      throw new Error(`El monto mínimo es $${PESOS_POR_PUNTO}`)
    }

    // 1. Obtener puntos actuales
    const { data: cliente, error: getError } = await supabaseAdmin
      .from('Clientes')
      .select('Puntos')
      .eq('Telef', telefono)
      .single()

    if (getError || !cliente) {
      throw new Error(`Cliente no encontrado o error: ${getError?.message}`)
    }

    const puntosActuales = cliente.Puntos || 0
    const nuevoTotal = puntosActuales + puntos

    // 2. Actualizar puntos
    const { error: updateError } = await supabaseAdmin
      .from('Clientes')
      .update({ Puntos: nuevoTotal })
      .eq('Telef', telefono)

    if (updateError) {
      throw new Error(`Error al actualizar puntos: ${updateError.message}`)
    }

    const { error: historialError } = await supabaseAdmin.from('Historial_Puntos').insert({
      Telef_cliente: telefono,
      Cantidad_Puntos: puntos,
      Monto_gastado: monto,
    })

    if (historialError) {
      throw new Error(`Error al guardar historial: ${historialError.message}`)
    }

    return jsonResponse({ success: true, nuevoTotal, puntosAsignados: puntos }, 200)
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unexpected error' }, 400)
  }
}
