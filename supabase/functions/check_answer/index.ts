// Edge Function для проверки ответа
// Деплой: supabase functions deploy check_answer

// @ts-ignore - Deno runtime imports (works in Supabase Edge Functions)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
// @ts-ignore - Deno runtime imports (works in Supabase Edge Functions)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Создаём клиент с service role для обхода RLS
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

    const { day_id, answer } = await req.json()

    if (!day_id || !answer) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Не указаны day_id или answer' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 1. Получаем данные дня (с правильным ответом)
    const { data: day, error: dayError } = await supabaseAdmin
      .from('days')
      .select('id, unlock_at, puzzle_type, correct_answer, max_attempts, reward_type, reward_data')
      .eq('id', day_id)
      .single()

    if (dayError || !day) {
      return new Response(
        JSON.stringify({ ok: false, message: 'День не найден' }),
        { 
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 2. Проверяем, что день разблокирован
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const unlockDate = new Date(day.unlock_at)
    unlockDate.setHours(0, 0, 0, 0)

    if (unlockDate > today) {
      return new Response(
        JSON.stringify({ ok: false, message: 'День ещё не открыт' }),
        { 
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 3. Проверяем, не решён ли уже день
    const { data: existingSolve } = await supabaseAdmin
      .from('solves')
      .select('id')
      .eq('day_id', day_id)
      .single()

    if (existingSolve) {
      // День уже решён, возвращаем награду
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'День уже решён',
          reward: {
            type: day.reward_type,
            data: day.reward_data
          }
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 4. Проверяем количество попыток
    const { count: attemptsCount } = await supabaseAdmin
      .from('attempts')
      .select('*', { count: 'exact', head: true })
      .eq('day_id', day_id)
      .gte('created_at', new Date(today).toISOString().split('T')[0])

    const maxAttempts = day.max_attempts || 5
    const attemptsLeft = Math.max(0, maxAttempts - (attemptsCount || 0))

    if (attemptsLeft <= 0) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          message: 'Превышен лимит попыток. Попробуй завтра!',
          attempts_left: 0
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // 5. Проверяем правильность ответа в зависимости от типа головоломки
    const normalizeAnswer = (text: string): string => {
      return text
        .trim()
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\s+/g, ' ')
    }

    let isCorrect = false

    if (day.puzzle_type === 'match_images') {
      // Для головоломки с сопоставлением картинок
      try {
        const userAnswer = JSON.parse(answer)
        let correctAnswer
        
        // Парсим correct_answer (может быть строкой JSON или уже объектом)
        if (typeof day.correct_answer === 'string') {
          correctAnswer = JSON.parse(day.correct_answer)
        } else {
          correctAnswer = day.correct_answer
        }
        
        if (Array.isArray(userAnswer) && Array.isArray(correctAnswer)) {
          // Сравниваем массивы сопоставлений
          if (userAnswer.length !== correctAnswer.length) {
            isCorrect = false
          } else {
            // Проверяем, что все сопоставления правильные
            // Сортируем для сравнения
            const sortedUser = [...userAnswer].sort((a, b) => a.number - b.number)
            const sortedCorrect = [...correctAnswer].sort((a, b) => a.number - b.number)
            
            isCorrect = sortedUser.every((userPair, idx) => {
              const correctPair = sortedCorrect[idx]
              return userPair.number === correctPair.number && 
                     userPair.imageId === correctPair.imageId
            })
          }
        } else {
          isCorrect = false
        }
      } catch (e) {
        // Если не удалось распарсить JSON, ответ неправильный
        console.error('Ошибка парсинга ответа для match_images:', e)
        isCorrect = false
      }
    } else {
      // Для обычных текстовых головоломок
      const normalizedAnswer = normalizeAnswer(answer)
      const normalizedCorrect = normalizeAnswer(day.correct_answer)

      // Проверяем ответ (поддержка массива правильных ответов)
      if (day.correct_answer.includes('|')) {
        // Если ответ содержит |, это список вариантов
        const correctAnswers = day.correct_answer.split('|').map(a => normalizeAnswer(a))
        isCorrect = correctAnswers.includes(normalizedAnswer)
      } else {
        isCorrect = normalizedAnswer === normalizedCorrect
      }
    }

    // 7. Сохраняем попытку
    await supabaseAdmin
      .from('attempts')
      .insert({
        day_id,
        answer: answer, // Сохраняем оригинальный ответ
        is_correct: isCorrect
      })

    if (isCorrect) {
      // 8. Если правильно — помечаем как решённый
      await supabaseAdmin
        .from('solves')
        .insert({
          day_id,
          solved_at: new Date().toISOString()
        })

      // Обновляем solved_at в days для удобства
      await supabaseAdmin
        .from('days')
        .update({ solved_at: new Date().toISOString() })
        .eq('id', day_id)

      // 9. Генерируем signed URL для изображения (если это image)
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

      // 10. Возвращаем награду
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Правильно! 🎉',
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
    } else {
      // Неправильный ответ
      return new Response(
        JSON.stringify({
          ok: false,
          message: 'Неправильно, попробуй ещё',
          attempts_left: attemptsLeft - 1
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }
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

