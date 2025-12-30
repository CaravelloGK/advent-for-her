// Supabase client configuration
// Используем window.supabase чтобы избежать конфликта имён

const SUPABASE_URL = 'https://eeopmulgnvletwcwqzna.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlb3BtdWxnbnZsZXR3Y3dxem5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyNTQ4NjUsImV4cCI6MjA4MTgzMDg2NX0.dknCEE0AZdwA2Lv73tOWWFtAu64dXz-CdUj1CypyzIo';
const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Создаём клиент
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Делаем доступным глобально для других скриптов
window.supabaseClient = supabaseClient;
window.SUPABASE_FUNCTIONS_URL = SUPABASE_FUNCTIONS_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

// Экспортируем для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { supabaseClient, SUPABASE_FUNCTIONS_URL };
}

