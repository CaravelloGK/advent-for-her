// Edge Function: returns attempts state (attempts_left, locked_until) per day
// Deno runtime (Supabase Edge Functions)

// @ts-ignore - Deno runtime imports
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
// @ts-ignore - Deno runtime imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type ReqBody = {
  day_ids?: number[]
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      // @ts-ignore
      Deno.env.get("SUPABASE_URL") ?? "",
      // @ts-ignore
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { day_ids }: ReqBody = (await req.json().catch(() => ({}))) as ReqBody
    const now = new Date()

    const daysQuery = supabaseAdmin.from("days").select("id, max_attempts")
    const { data: days, error: daysError } = Array.isArray(day_ids) && day_ids.length > 0
      ? await daysQuery.in("id", day_ids)
      : await daysQuery

    if (daysError || !days) {
      return new Response(
        JSON.stringify({ ok: false, message: "Не удалось загрузить days" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    // solves: solved days ignore attempt limits
    const { data: solves, error: solvesError } = await supabaseAdmin
      .from("solves")
      .select("day_id")
      .in("day_id", days.map((d) => d.id))

    if (solvesError) {
      return new Response(
        JSON.stringify({ ok: false, message: "Не удалось загрузить solves" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }
    const solvedSet = new Set((solves ?? []).map((s) => s.day_id))

    const results: Array<{
      day_id: number
      attempts_left: number | null
      locked_until: string | null
      locked: boolean
      max_attempts: number
    }> = []

    for (const day of days) {
      const dayId = day.id as number
      const maxAttempts = (day.max_attempts as number | null) ?? 5

      if (solvedSet.has(dayId)) {
        results.push({
          day_id: dayId,
          attempts_left: null,
          locked_until: null,
          locked: false,
          max_attempts: maxAttempts,
        })
        continue
      }

      // latest lock (history table)
      const { data: lockRow } = await supabaseAdmin
        .from("attempt_locks")
        .select("locked_until")
        .eq("day_id", dayId)
        .order("locked_until", { ascending: false })
        .limit(1)
        .maybeSingle()

      const lockedUntil = lockRow?.locked_until ? new Date(lockRow.locked_until) : null
      const locked = !!(lockedUntil && lockedUntil.getTime() > now.getTime())

      if (locked) {
        results.push({
          day_id: dayId,
          attempts_left: 0,
          locked_until: lockedUntil!.toISOString(),
          locked: true,
          max_attempts: maxAttempts,
        })
        continue
      }

      // attempts count in current window (after last lock expiry if any)
      const attemptsQuery = supabaseAdmin
        .from("attempts")
        .select("*", { count: "exact", head: true })
        .eq("day_id", dayId)

      const { count: attemptsCount } = lockedUntil
        ? await attemptsQuery.gt("created_at", lockedUntil.toISOString())
        : await attemptsQuery

      const attemptsUsed = attemptsCount ?? 0
      const attemptsLeft = Math.max(0, maxAttempts - attemptsUsed)

      results.push({
        day_id: dayId,
        attempts_left: attemptsLeft,
        locked_until: null,
        locked: false,
        max_attempts: maxAttempts,
      })
    }

    return new Response(
      JSON.stringify({ ok: true, states: results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (e) {
    console.error("get_day_states error:", e)
    return new Response(
      JSON.stringify({ ok: false, message: "Внутренняя ошибка" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})


