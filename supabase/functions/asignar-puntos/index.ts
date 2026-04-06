import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Manejo de pre-flight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Variables de entorno de Supabase 
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Crear cliente usando SERVICE_ROLE para bypass de RLS (Seguro en Edge Function)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Parse del body de la request
    const { telefono, puntos, cajero, monto } = await req.json()

    // Validaciones basicas
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

    // 3. Registrar en el historial de forma asíncrona pero esperando confirmación
    await supabaseAdmin.from('historial_puntos').insert({
      telefono_cliente: telefono,
      puntos_sumados: puntos,
      monto_compra: monto || 0,
      cajero: cajero || 'desconocido',
      created_at: new Date().toISOString()
    })

    // Retornar éxito
    return new Response(
      JSON.stringify({ success: true, nuevoTotal }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
