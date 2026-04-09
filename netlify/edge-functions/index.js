import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function getEnv(name) {
  if (typeof Netlify !== 'undefined' && Netlify.env) {
    return Netlify.env.get(name)
  }
  return Deno.env.get(name)
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export default async (req, _context) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL')
    const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en variables de entorno')
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    const { telefono, puntos, cajero, monto } = await req.json()

    if (!telefono || !puntos || puntos <= 0) {
      throw new Error('Parámetros inválidos. Se requiere telefono y puntos válidos.')
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
      telefono_cliente: telefono,
      puntos_sumados: puntos,
      monto_compra: monto || 0,
      cajero: cajero || 'desconocido',
      created_at: new Date().toISOString()
    })

    if (historialError) {
      throw new Error(`Error al guardar historial: ${historialError.message}`)
    }

    return jsonResponse({ success: true, nuevoTotal }, 200)
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unexpected error' }, 400)
  }
}
