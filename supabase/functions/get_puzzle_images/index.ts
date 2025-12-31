// Edge Function для получения signed URLs изображений головоломки
// Деплой: supabase functions deploy get_puzzle_images

// @ts-ignore - Deno runtime imports (works in Supabase Edge Functions)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
// @ts-ignore - Deno runtime imports (works in Supabase Edge Functions)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    })
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

    const { day_id, image_path } = await req.json()

    if (!day_id) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Не указан day_id' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }
    
    // Если передан image_path, генерируем signed URL только для картинки вопроса
    if (image_path) {
      let filePath = image_path
      
      // Убираем префиксы
      if (filePath.startsWith('rewards/')) {
        filePath = filePath.replace(/^rewards\//, '')
      } else if (filePath.startsWith('puzzles/')) {
        filePath = filePath.replace(/^puzzles\//, '')
      }
      
      // Если путь содержит полный URL Storage, извлекаем путь
      if (filePath.includes('/storage/v1/object/')) {
        const pathMatch = filePath.match(/\/object\/([^?]+)/)
        if (pathMatch) {
          filePath = pathMatch[1].replace(/^public\//, '').replace(/^rewards\//, '').replace(/^puzzles\//, '')
        }
      }
      
      console.log('Генерирую signed URL для картинки вопроса, путь:', filePath)
      
      const { data: signedUrlData, error: signedError } = await supabaseAdmin
        .storage
        .from('rewards')
        .createSignedUrl(filePath, 60 * 60 * 24) // 24 часа
      
      if (signedError) {
        console.error('Ошибка генерации signed URL для картинки вопроса:', signedError)
        return new Response(
          JSON.stringify({ 
            ok: false, 
            message: signedError.message,
            path: filePath,
            error: signedError 
          }),
          { 
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }
      
      console.log('Signed URL для картинки вопроса успешно создан')
      
      return new Response(
        JSON.stringify({
          ok: true,
          questionImageUrl: signedUrlData?.signedUrl || null
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Получаем данные дня
    const { data: day, error } = await supabaseAdmin
      .from('days')
      .select('puzzle_type, puzzle_data')
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

    // Проверяем, что это головоломка с изображениями
    if (!['match_images', 'chronological_images'].includes(day.puzzle_type) || !day.puzzle_data?.images) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Этот день не содержит головоломку с изображениями' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const images = day.puzzle_data.images
    const processedImages = []

    // Обрабатываем каждое изображение
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      let imageUrl = ''
      let filePath = ''

      // Определяем путь к файлу
      if (typeof img === 'string') {
        imageUrl = img
        filePath = img
      } else if (img.url) {
        imageUrl = img.url
        filePath = img.url
      } else if (img.path) {
        imageUrl = img.path
        filePath = img.path
      }

      // Извлекаем путь к файлу из URL или используем как есть
      if (filePath.includes('/storage/v1/object/')) {
        const pathMatch = filePath.match(/\/object\/([^?]+)/)
        if (pathMatch) {
          filePath = pathMatch[1].replace(/^public\//, '').replace(/^rewards\//, '').replace(/^puzzles\//, '')
        }
      } else if (filePath.startsWith('rewards/')) {
        // Убираем префикс rewards/, оставляем только имя файла
        filePath = filePath.replace(/^rewards\//, '')
      } else if (filePath.startsWith('puzzles/')) {
        filePath = filePath.replace(/^puzzles\//, '')
      }
      
      // Если путь пустой после обработки, используем оригинальный
      if (!filePath || filePath.trim() === '') {
        filePath = imageUrl
      }

      // Генерируем signed URL
      if (filePath) {
        const { data: signedUrlData, error: signedError } = await supabaseAdmin
          .storage
          .from('rewards') // Используем тот же bucket rewards
          .createSignedUrl(filePath, 60 * 60 * 24) // 24 часа

        if (signedError) {
          console.error(`Ошибка генерации signed URL для изображения ${i}:`, signedError)
          processedImages.push({
            original: imageUrl,
            signedUrl: null,
            error: signedError.message
          })
        } else if (signedUrlData?.signedUrl) {
          processedImages.push({
            original: imageUrl,
            signedUrl: signedUrlData.signedUrl
          })
        } else {
          processedImages.push({
            original: imageUrl,
            signedUrl: null,
            error: 'Не удалось получить signed URL'
          })
        }
      } else {
        // Если это уже полный URL (http/https), оставляем как есть
        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
          processedImages.push({
            original: imageUrl,
            signedUrl: imageUrl
          })
        } else {
          processedImages.push({
            original: imageUrl,
            signedUrl: null,
            error: 'Неверный формат пути к изображению'
          })
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        images: processedImages
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Ошибка get_puzzle_images:', error)
    return new Response(
      JSON.stringify({ 
        ok: false, 
        message: error instanceof Error ? error.message : 'Неизвестная ошибка' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

