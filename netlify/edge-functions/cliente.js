import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

function sanitizeTelefono(input) {
  return String(input || '').replace(/[^+0-9]/g, '')
}

function formatNombre(cliente) {
  const nombre = (cliente?.Nombre || '').trim()
  const apellido = (cliente?.Apellido || '').trim()
  const full = `${nombre} ${apellido}`.trim()
  return full || null
}

export default async (req, _context) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL')
    const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en variables de entorno')
    }

    const url = new URL(req.url)
    const telefono = sanitizeTelefono(url.searchParams.get('telefono'))

    if (!telefono) {
      throw new Error('Parámetros inválidos. Se requiere telefono.')
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Intentamos traer nombre y apellido si existen en el schema.
    let cliente = null
    {
      const { data, error } = await supabaseAdmin
        .from('Clientes')
        .select('Telef,Puntos,Nombre')
        .eq('Telef', telefono)
        .single()

      if (!error && data) {
        cliente = data
      } else if (error) {
        // Si el schema no tiene Nombre/Apellido, caemos a un select mínimo.
        const msg = String(error.message || '')
        const missingColumn = msg.includes('column') && msg.includes('does not exist')
        if (!missingColumn) {
          throw new Error(`Cliente no encontrado o error: ${error.message}`)
        }
      }
    }

    if (!cliente) {
      const { data, error } = await supabaseAdmin
        .from('Clientes')
        .select('Telef,Nombre,Puntos')
        .eq('Telef', telefono)
        .single()

      if (error || !data) {
        throw new Error(`Cliente no encontrado o error: ${error?.message}`)
      }
      cliente = data
    }

    return jsonResponse(
      {
        success: true,
        cliente: {
          telefono: cliente.Telef ?? telefono,
          puntos: cliente.Puntos ?? 0,
          nombre: formatNombre(cliente.Nombre),
        },
      },
      200,
    )
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unexpected error' }, 400)
  }
}
