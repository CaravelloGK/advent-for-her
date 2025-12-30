// Edge Function для получения награды уже решённого дня
// Деплой: supabase functions deploy get_reward

// @ts-ignore - Deno runtime imports (works in Supabase Edge Functions)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
// @ts-ignore - Deno runtime imports (works in Supabase Edge Functions)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // @ts-ignore - Deno global (available in Edge Functions runtime)
    const supabaseAdmin = createClient(
      // @ts-ignore
      Deno.env.get('SUPABASE_URL') ?? '',
      // @ts-ignore
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { day_id } = await req.json()

    if (!day_id) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Не указан day_id' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Проверяем, что день решён + узнаём, открывали ли награду раньше
    const { data: solve, error: solveError } = await supabaseAdmin
      .from('solves')
      .select('day_id, reward_opened_at')
      .eq('day_id', day_id)
      .single()

    if (solveError || !solve) {
      return new Response(
        JSON.stringify({ ok: false, message: 'День ещё не решён' }),
        { 
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Если награду ещё ни разу не открывали — отмечаем первое открытие
    let firstOpen = false
    if (!solve.reward_opened_at) {
      firstOpen = true
      const { error: openErr } = await supabaseAdmin
        .from('solves')
        .update({ reward_opened_at: new Date().toISOString() })
        .eq('day_id', day_id)
        .is('reward_opened_at', null)
      if (openErr) {
        console.error('Не удалось проставить reward_opened_at:', openErr)
        // firstOpen оставляем true — для UX это не критично, а состояние подтянется при следующем запросе
      }
    }

    // Получаем награду
    const { data: day, error } = await supabaseAdmin
      .from('days')
      .select('reward_type, reward_data')
      .eq('id', day_id)
      .single()

    if (error || !day) {
      return new Response(
        JSON.stringify({ ok: false, message: 'День не найден' }),
        { 
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Генерируем signed URL для изображения (если это image)
    let rewardData = day.reward_data
    if (day.reward_type === 'image' && rewardData?.url) {
      const storageUrl = rewardData.url
      let filePath = ''
      
      // Если это полный URL, извлекаем путь
      if (storageUrl.includes('/storage/v1/object/')) {
        const pathMatch = storageUrl.match(/\/object\/([^?]+)/)
        if (pathMatch) {
          filePath = pathMatch[1].replace(/^public\//, '').replace(/^rewards\//, '')
        }
      } else if (storageUrl.startsWith('rewards/')) {
        // Если это относительный путь вида "rewards/файл.jpg"
        filePath = storageUrl.replace(/^rewards\//, '')
      } else {
        // Если это просто имя файла или путь без префикса
        filePath = storageUrl
      }
      
      if (filePath) {
        // Генерируем signed URL (действителен 24 часа для удобства)
        // При каждом запросе генерируется новый signed URL
        const { data: signedUrlData, error: signedError } = await supabaseAdmin
          .storage
          .from('rewards')
          .createSignedUrl(filePath, 86400) // 24 часа
        
        if (signedError) {
          console.error('Ошибка генерации signed URL:', signedError)
        } else if (signedUrlData?.signedUrl) {
          rewardData = {
            ...rewardData,
            url: signedUrlData.signedUrl
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        first_open: firstOpen,
        reward: {
          type: day.reward_type,
          data: rewardData
        }
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ ok: false, message: 'Внутренняя ошибка сервера' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

