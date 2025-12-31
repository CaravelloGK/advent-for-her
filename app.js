// Главный файл приложения

// Получаем URL функций из supabase.js (должен быть загружен раньше)
// Используем функцию для получения значения, чтобы избежать конфликта имён
function getSupabaseFunctionsUrl() {
  return window.SUPABASE_FUNCTIONS_URL || 'https://eeopmulgnvletwcwqzna.supabase.co/functions/v1';
}

function getSupabaseAnonKey() {
  return window.SUPABASE_ANON_KEY || '';
}

// Экранирование HTML для безопасной вставки в атрибуты
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Утилиты для нормализации ответа
function normalizeAnswer(answer) {
  return answer
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

// Parse a DATE-only string (YYYY-MM-DD) as LOCAL midnight to avoid timezone shifts.
function parseLocalDate(dateString) {
  if (!dateString) return null;
  if (typeof dateString === 'string') {
    const m = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      return new Date(y, mo, d, 0, 0, 0, 0); // local midnight
    }
  }
  const dt = new Date(dateString);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

// Проверка, доступен ли день
function isDayUnlocked(unlockAt) {
  if (!unlockAt) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const unlockDate = parseLocalDate(unlockAt);
  if (!unlockDate) return false;
  unlockDate.setHours(0, 0, 0, 0);
  return unlockDate <= today;
}

// Форматирование даты
function formatDate(dateString) {
  const date = parseLocalDate(dateString) || new Date(dateString);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long'
  });
}

// Получение дня недели
function getWeekday(dateString) {
  const date = parseLocalDate(dateString) || new Date(dateString);
  return date.toLocaleDateString('ru-RU', {
    weekday: 'short'
  });
}

// Получение числа дня
function getDayNumber(dateString) {
  const date = parseLocalDate(dateString) || new Date(dateString);
  return date.getDate();
}

// Загрузка дней из БД
async function loadDays() {
  const container = document.getElementById('days');
  if (!container) {
    console.error('Элемент #days не найден!');
    return;
  }

  container.innerHTML = '<div class="loading">Загрузка…</div>';

  // Проверяем, что supabaseClient доступен
  const client = window.supabaseClient || supabaseClient;
  if (!client) {
    console.error('supabaseClient не определён! Проверь порядок загрузки скриптов.');
    container.innerHTML = '<div class="loading">Ошибка: Supabase не загружен 😢<br><small>Открой консоль (F12) для деталей</small></div>';
    return;
  }

  try {
    console.log('Загружаю дни из БД...');
    
    // Загружаем дни (без reward_data)
    const { data: daysData, error: daysError } = await client
      .from('days')
      .select('id, day_number, title, unlock_at, puzzle_type, puzzle_data')
      .order('day_number');

    if (daysError) {
      console.error('Ошибка загрузки дней:', daysError);
      container.innerHTML = `<div class="loading">Ошибка загрузки 😢<br><small>${daysError.message || 'Проверь консоль (F12)'}</small></div>`;
      return;
    }

    if (!daysData || daysData.length === 0) {
      console.warn('Данные пусты. Возможно, таблица days пуста или RLS блокирует доступ.');
      container.innerHTML = '<div class="loading">Нет данных 😢<br><small>Добавь дни в БД или проверь RLS политики</small></div>';
      return;
    }

    // Загружаем решённые дни из таблицы solves
    const { data: solvesData, error: solvesError } = await client
      .from('solves')
      .select('day_id, solved_at, reward_opened_at');

    // Создаём мапы: day_id -> solved_at / reward_opened_at
    const solvesMap = {};
    const openedMap = {};
    if (solvesData && !solvesError) {
      solvesData.forEach(solve => {
        solvesMap[solve.day_id] = solve.solved_at;
        openedMap[solve.day_id] = solve.reward_opened_at || null;
      });
    }

    // Попытки/локи (attempts_left / locked_until) через Edge Function (service role)
    const attemptStatesMap = {};
    try {
      const resp = await fetch(`${getSupabaseFunctionsUrl()}/get_day_states`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getSupabaseAnonKey()}`
        },
        body: JSON.stringify({ day_ids: daysData.map(d => d.id) })
      });
      const json = await resp.json();
      if (resp.ok && json?.ok && Array.isArray(json.states)) {
        json.states.forEach(s => {
          attemptStatesMap[s.day_id] = s;
        });
      } else {
        console.warn('get_day_states: bad response', json);
      }
    } catch (e) {
      console.warn('get_day_states failed', e);
    }

    // Объединяем данные
    const processedData = daysData.map(day => ({
      ...day,
      solved_at: solvesMap[day.id] || null,
      reward_opened_at: openedMap[day.id] || null,
      attempts_left: attemptStatesMap[day.id]?.attempts_left ?? null,
      attempts_locked_until: attemptStatesMap[day.id]?.locked_until ?? null
    }));

    console.log('Ответ от Supabase:', { 
      daysCount: daysData.length, 
      solvesCount: solvesData?.length || 0,
      processedData 
    });

    if (!processedData || processedData.length === 0) {
      console.warn('Данные пусты. Возможно, таблица days пуста или RLS блокирует доступ.');
      container.innerHTML = '<div class="loading">Нет данных 😢<br><small>Добавь дни в БД или проверь RLS политики</small></div>';
      return;
    }

    console.log(`Загружено дней: ${processedData.length}`);
    renderDays(processedData);
    startPerCardTimers();
    
    return Promise.resolve(); // Возвращаем Promise для цепочки
  } catch (err) {
    console.error('Неожиданная ошибка:', err);
    container.innerHTML = `<div class="loading">Ошибка загрузки 😢<br><small>${err.message || 'Проверь консоль (F12)'}</small></div>`;
    return Promise.reject(err);
  }
}

function isAttemptsLocked(day) {
  if (!day?.attempts_locked_until) return false;
  const until = new Date(day.attempts_locked_until).getTime();
  return Number.isFinite(until) && until > Date.now();
}

function formatCountdownMs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}д ${h}ч ${m}м`;
  if (h > 0) return `${h}ч ${m}м ${s}с`;
  return `${m}м ${s}с`;
}

function startPerCardTimers() {
  if (window.__cardTimersInterval) clearInterval(window.__cardTimersInterval);
  if (window.__frostUpdateInterval) clearInterval(window.__frostUpdateInterval);
  window.__cardTimersInterval = setInterval(() => {
    const now = Date.now();
    document.querySelectorAll('[data-countdown-to]').forEach((el) => {
      const to = el.getAttribute('data-countdown-to');
      if (!to) return;
      const ts = new Date(to).getTime();
      if (!Number.isFinite(ts)) return;
      const diff = ts - Date.now();
      el.textContent = diff <= 0 ? '0м 0с' : formatCountdownMs(diff);
    });
  }, 1000);

  // Frost can update very rarely (only when crossing tier boundaries).
  // Keep it infrequent to avoid restarting visual animations.
  window.__frostUpdateInterval = setInterval(() => {
    updateLockedCardsFrost();
  }, 10 * 60 * 1000); // 10 minutes
}

function frostCoverageForMsLeft(msLeft) {
  const h = msLeft / 3600000;
  if (h < 24) return 0.10;
  if (h < 48) return 0.25;
  if (h < 72) return 0.40;
  if (h < 96) return 0.60;
  if (h < 120) return 0.75;
  if (h < 144) return 0.90;
  // farther than 6 days: almost fully frozen
  return 0.95;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFrostMaskDataUrl({ seed, coverage }) {
  // SVG mask: white => frost visible, black => frost hidden (thawed)
  // We draw "frost blobs" biased to edges at low coverage.
  const size = 120;
  const rnd = mulberry32(seed);
  const blobs = Math.max(3, Math.round(4 + coverage * 22));
  const edgeBias = Math.max(0, 1 - coverage); // low coverage => more edge-heavy
  const minR = 10 + coverage * 6;
  const maxR = 18 + coverage * 22;

  const circles = [];
  for (let i = 0; i < blobs; i++) {
    let x, y;
    if (rnd() < edgeBias) {
      // pick near an edge/corner
      const side = Math.floor(rnd() * 4);
      if (side === 0) { x = rnd() * 22; y = rnd() * size; }
      else if (side === 1) { x = size - rnd() * 22; y = rnd() * size; }
      else if (side === 2) { x = rnd() * size; y = rnd() * 22; }
      else { x = rnd() * size; y = size - rnd() * 22; }
    } else {
      x = rnd() * size;
      y = rnd() * size;
    }
    const r = minR + (maxR - minR) * rnd();
    const a = 0.75 + 0.25 * rnd();
    circles.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="white" opacity="${a.toFixed(2)}"/>`);
  }

  // Always add a thin frosty rim so it reads like a window edge.
  const rimOpacity = Math.min(1, 0.25 + coverage * 0.65);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <filter id="b" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="${(1.6 + coverage * 1.4).toFixed(2)}"/>
        </filter>
      </defs>
      <rect width="${size}" height="${size}" fill="black"/>
      <g filter="url(#b)">
        <rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="12" ry="12" fill="white" opacity="${rimOpacity.toFixed(2)}"/>
        ${circles.join('')}
      </g>
    </svg>`;

  // Use base64 to avoid any issues with spaces/percent-encoding inside CSS url().
  // SVG is ASCII-only here, so btoa is safe.
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function updateLockedCardsFrost() {
  // We base frost on the same countdown timestamp used in the UI to keep it consistent.
  document.querySelectorAll('.day.day-locked').forEach((card) => {
    const dayId = parseInt(card.getAttribute('data-day-id') || '0', 10) || 0;
    const countdown = card.querySelector('.day-status-locked [data-countdown-to]');
    const to = countdown?.getAttribute('data-countdown-to') || card.getAttribute('data-unlock-at');
    if (!to) return;
    const ts = new Date(to).getTime();
    if (!Number.isFinite(ts)) return;
    const msLeft = ts - Date.now();
    const coverage = frostCoverageForMsLeft(msLeft);

    // Quantize to tiers so we don't regenerate every time.
    const tier = String(coverage);
    if (card.dataset.frostTier === tier) return;
    card.dataset.frostTier = tier;

    // Deterministic seed per day, so blobs don't "jump" each update — only grow/shrink.
    const seed = (dayId * 9973 + 1337) >>> 0;
    const maskUrl = buildFrostMaskDataUrl({ seed, coverage });
    card.style.setProperty('--frost-mask', `url("${maskUrl}")`);

    // Also scale overlay intensity with coverage so tiers are obvious visually.
    const frostOpacity = Math.min(0.98, 0.20 + coverage * 0.90);
    card.style.setProperty('--frost-opacity', String(frostOpacity));
    card.style.setProperty('--frost-level', String(coverage));

    // Debug (enable by typing: window.DEBUG_FROST = true)
    if (window.DEBUG_FROST) {
      console.log('[frost]', { dayId, msLeft, hoursLeft: (msLeft / 3600000).toFixed(2), coverage, frostOpacity });
    }
  });
}

// Рендер карточек дней
function renderDays(days) {
  const container = document.getElementById('days');
  container.innerHTML = '';

  days.forEach((day, index) => {
    const div = document.createElement('div');
    const isUnlockedByDate = isDayUnlocked(day.unlock_at);
    const isSolved = !!day.solved_at;
    const isRewardOpened = !!day.reward_opened_at;
    const isLockedByAttempts = isAttemptsLocked(day);
    const isUnlocked = isUnlockedByDate && !isLockedByAttempts;

    let className = 'day';
    if (!isUnlockedByDate) className += ' day-locked';
    if (isLockedByAttempts) className += ' day-attempts-locked';
    if (isSolved) className += ' day-solved';
    if (isSolved && !isRewardOpened) className += ' day-awaiting-claim';
    if (isSolved && isRewardOpened) className += ' day-opened';

    div.className = className;
    div.dataset.dayId = day.id;
    div.dataset.dayIndex = index;
    if (day.unlock_at) div.dataset.unlockAt = day.unlock_at;
    if (day.attempts_locked_until) div.dataset.attemptsLockedUntil = day.attempts_locked_until;

    const weekday = getWeekday(day.unlock_at);
    const dayNumber = day.day_number ?? day.id;
    
    // Layers:
    // - frost overlay (only visible when .day-locked)
    // - attempts overlay (only visible when .day-attempts-locked)
    let content = '<div class="frost-overlay" aria-hidden="true"></div><div class="attempts-overlay" aria-hidden="true"></div><div class="day-content">';
    content += `<div class="day-weekday">${weekday}</div>`;
    content += `<div class="day-number">${dayNumber}</div>`;
    let statusHtml = '';

    if (!isUnlockedByDate) {
      const unlockDt = parseLocalDate(day.unlock_at);
      const unlockTo = (unlockDt || new Date(day.unlock_at)).toISOString();
      statusHtml = `
        <div class="day-status day-status-locked">
          <span class="day-countdown" data-countdown-to="${unlockTo}">—</span>
        </div>
      `;
    } else if (isLockedByAttempts) {
      const retryTo = new Date(day.attempts_locked_until).toISOString();
      statusHtml = `
        <div class="day-status day-status-attempts-locked">
          Неудачница! Попробуй через <span class="day-countdown" data-countdown-to="${retryTo}">—</span>
        </div>
      `;
    } else if (isSolved) {
      // 2 состояния для решённого дня:
      // - Решено, но награду ни разу не открывали (ждёт забора)
      // - Решено, награду уже открывали (можно пересмотреть)
      if (isRewardOpened) {
        statusHtml = `
          <div class="day-status day-status-opened">Посмотреть что внутри</div>
        `;
      } else {
        statusHtml = `
          <div class="day-status day-status-solved">Забирай подарок!</div>
        `;
      }
    } else {
      // Показываем вопрос с картинкой, если есть
      const puzzleData = day.puzzle_data || {};
      const title = (day.title || puzzleData.title || 'Загадка');
      content += `<div class="day-question"><div class="day-question-text">${escapeHtml(title)}</div></div>`;
      statusHtml = `<div class="day-status">Готово к решению</div>`;
    }

    content += '</div>'; // закрываем day-content
    content += statusHtml; // статус/таймер поверх, не под blur

    div.innerHTML = content;

    if (isUnlocked) {
      div.addEventListener('click', () => handleDayClick(day));
    }

    container.appendChild(div);
    
    // (no inline style hacks here; animations are driven purely by CSS classes)
  });

  // After DOM render: sync frost masks once.
  updateLockedCardsFrost();
}

// Клик по карточке: решаем/забираем/смотрим награду
function handleDayClick(day) {
  // Mobile/overlay "click-through" guard:
  // when we close the modal (esp. after correct answer), the same tap/click can land on the card underneath.
  // We suppress day clicks for a short window to ensure the user actually sees the shake state first.
  if (Date.now() < (window.__suppressDayClicksUntil || 0)) {
    console.log('handleDayClick: suppressed click-through');
    return;
  }
  if (!isDayUnlocked(day.unlock_at)) return;
  if (isAttemptsLocked(day)) {
    return;
  }
  const isSolved = !!day.solved_at;
  const isRewardOpened = !!day.reward_opened_at;

  // Решено, но награду ещё не открывали: сначала анимация на карточке, потом модалка с наградой
  if (isSolved && !isRewardOpened) {
    startClaimRewardFlow(day);
    return;
  }

  // Иначе — обычная модалка (головоломка или просмотр награды)
  openDayModal(day);
}

function startClaimRewardFlow(day) {
  const dayId = day.id;
  const el = document.querySelector(`.day[data-day-id="${dayId}"]`);
  if (!el) {
    console.warn('startClaimRewardFlow: элемент не найден, открываю модалку напрямую');
    openRewardModal(day);
    return;
  }
  if (el.dataset.claiming === '1') {
    console.log('startClaimRewardFlow: анимация уже запущена');
    return;
  }
  
  console.log('startClaimRewardFlow: запускаю анимацию для дня', dayId);
  el.dataset.claiming = '1';

  // Убираем day-awaiting-claim и добавляем day-claiming
  el.classList.remove('day-awaiting-claim');
  el.classList.add('day-claiming');

  // Не центрируем принудительно (важнее анимация, чем "прилипание" к центру)
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

  // После анимации — показываем модалку с наградой (и только тогда вызываем get_reward)
  // shake-strong (~1.08s) + pop/flash (~0.55s) with small buffer
  const CLAIM_ANIMATION_MS = 1700;
  setTimeout(() => {
    console.log('startClaimRewardFlow: анимация завершена, открываю модалку');
    el.classList.remove('day-claiming');
    delete el.dataset.claiming;
    openRewardModal(day);
  }, CLAIM_ANIMATION_MS);
}

function openRewardModal(day) {
  // Важно: для решённых дней openDayModal сразу рисует reward UI и вызывает loadReward()
  openDayModal(day);
}


// Открытие модала дня
function openDayModal(day) {
  const modal = document.getElementById('modal');
  const modalContent = document.getElementById('modal-content');
  
  if (!modal || !modalContent) return;

  const isUnlocked = isDayUnlocked(day.unlock_at);
  const isSolved = !!day.solved_at;
  const isLockedByAttempts = isAttemptsLocked(day);

  // Attempts-locked days are not openable; state is shown on the card itself.
  if (isLockedByAttempts) return;

  let html = `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-header">
      <div class="modal-title">День ${day.day_number ?? day.id}</div>
      <div class="modal-subtitle">${formatDate(day.unlock_at)}</div>
    </div>
    <div class="modal-body">
  `;

  if (!isUnlocked) {
    html += `
      <div class="question">🔒 Этот день ещё не открыт. Откроется ${formatDate(day.unlock_at)}.</div>
    `;
  } else if (isSolved) {
    // Если решено, показываем награду (она должна быть уже загружена)
    html += `
      <div class="question">Молодец, жопич!</div>
      <div class="reward" id="reward-content">
        <div class="loading">Грузиммммммммм…</div>
      </div>
    `;
  } else {
    // Определяем тип головоломки
    const puzzleType = day.puzzle_type || 'text';
    const puzzleData = day.puzzle_data || {};
    
    // Показываем вопрос/картинки (поддержка 1 или нескольких)
    let questionHtml = '';
    const questionImages = Array.isArray(puzzleData.question_images)
      ? puzzleData.question_images
      : (puzzleData.image ? [puzzleData.image] : []);

    const placeholder = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'420\' height=\'240\'%3E%3Crect fill=\'%23333\' width=\'420\' height=\'240\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' fill=\'%23999\' font-size=\'16\'%3EЗагрузка...%3C/text%3E%3C/svg%3E';

    // Desired order: first image -> text -> second image (if exists)
    if (questionImages.length > 0) {
      const originalPath = String(questionImages[0] || '');
      let imageUrl = placeholder;
      if (originalPath.startsWith('http://') || originalPath.startsWith('https://') || originalPath.startsWith('data:')) {
        imageUrl = originalPath;
      }
      questionHtml += `<img src="${imageUrl}" alt="Загадка" class="puzzle-question-image" data-day-id="${day.id}" data-question-idx="0" data-original-path="${escapeHtml(originalPath)}" />`;
    }

    if (puzzleData.question) {
      questionHtml += `<div class="question-text">${puzzleData.question}</div>`;
    }

    if (questionImages.length > 1) {
      // Render remaining images after text. If more than 2, show them as a small grid.
      if (questionImages.length === 2) {
        const originalPath = String(questionImages[1] || '');
        let imageUrl = placeholder;
        if (originalPath.startsWith('http://') || originalPath.startsWith('https://') || originalPath.startsWith('data:')) {
          imageUrl = originalPath;
        }
        questionHtml += `<img src="${imageUrl}" alt="Загадка" class="puzzle-question-image" data-day-id="${day.id}" data-question-idx="1" data-original-path="${escapeHtml(originalPath)}" />`;
      } else {
        questionHtml += `<div class="puzzle-question-images puzzle-question-images-bottom">`;
        questionImages.slice(1).forEach((path, idx) => {
          const realIdx = idx + 1;
          const originalPath = String(path || '');
          let imageUrl = placeholder;
          if (originalPath.startsWith('http://') || originalPath.startsWith('https://') || originalPath.startsWith('data:')) {
            imageUrl = originalPath;
          }
          questionHtml += `<img src="${imageUrl}" alt="Загадка" class="puzzle-question-image" data-day-id="${day.id}" data-question-idx="${realIdx}" data-original-path="${escapeHtml(originalPath)}" />`;
        });
        questionHtml += `</div>`;
      }
    }
    
    html += `<div class="question">${questionHtml || 'Загадка'}</div>`;
    
    // Разные типы головоломок
    if (puzzleType === 'match_images') {
      html += renderMatchImagesPuzzle(day.id, puzzleData);
    } else if (puzzleType === 'chronological_images') {
      html += renderChronologicalImagesPuzzle(day.id, puzzleData);
    } else {
      // Обычный текстовый ввод
      html += `
        <input 
          type="text" 
          class="answer-input" 
          id="answer-input" 
          placeholder="Введи ответ..."
          autocomplete="off"
        />
        <button class="btn btn-primary" id="check-btn" onclick="checkAnswer(${day.id})">
          Проверить
        </button>
        <div id="feedback"></div>
        <div class="attempts-info" id="attempts-info"></div>
      `;
    }
  }

  html += '</div>';
  modalContent.innerHTML = html;
  modal.classList.add('active');

  // Если день решён, загружаем награду после того, как элемент создан в DOM
  if (isSolved) {
    // DOM уже создан после innerHTML, но дадим браузеру кадр на отрисовку
    requestAnimationFrame(() => loadReward(day.id));
  }

  // Инициализация для разных типов головоломок
  if (day.puzzle_type === 'match_images') {
    // Загружаем signed URLs для изображений и картинки вопроса перед инициализацией
    Promise.all([
      loadPuzzleQuestionImage(day.id, day.puzzle_data),
      loadPuzzleImages(day.id)
    ]).then(() => {
      initMatchImagesPuzzle(day.id);
    });
  } else if (day.puzzle_type === 'chronological_images') {
    Promise.all([
      loadPuzzleQuestionImage(day.id, day.puzzle_data),
      loadPuzzleImages(day.id)
    ]).then(() => {
      initChronologicalImagesPuzzle(day.id);
    });
  } else {
    // Загружаем signed URL для картинки вопроса (если есть)
    if (day.puzzle_data?.image) {
      loadPuzzleQuestionImage(day.id, day.puzzle_data);
    }
    
    const input = document.getElementById('answer-input');
    if (input) {
      input.focus();
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          checkAnswer(day.id);
        }
      });
    }
  }
}

// Рендер головоломки: расположи фото в хронологическом порядке
function renderChronologicalImagesPuzzle(dayId, puzzleData) {
  const images = puzzleData.images || [];
  const positions = [1, 2, 3, 4];

  let html = `
    <div class="chrono-puzzle" data-day-id="${dayId}">
      <div class="chrono-instruction">Расположи фотографии в хронологическом порядке:</div>
      <div class="chrono-slots">
        ${positions.map(pos => `
          <div class="chrono-slot" data-position="${pos}">
            <div class="chrono-slot-label">${pos}</div>
            <div class="chrono-drop" data-position="${pos}" id="chrono-drop-${dayId}-${pos}">
              <div class="drop-placeholder">Перетащи сюда</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="chrono-images">
        ${images.map((img, idx) => {
          let imageUrl = '';
          if (typeof img === 'string') imageUrl = img;
          else if (img.url) imageUrl = img.url;
          else if (img.path) imageUrl = img.path;

          let finalUrl = imageUrl;
          if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('data:'))) {
            finalUrl = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'90\'%3E%3Crect fill=\'%23333\' width=\'120\' height=\'90\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' fill=\'%23999\' font-size=\'12\'%3EЗагрузка...%3C/text%3E%3C/svg%3E';
          }

          return `
            <div class="chrono-image-item" draggable="true" data-image-id="${idx}" data-day-id="${dayId}">
              <img src="${finalUrl}" alt="Фото ${idx + 1}"
                   data-original-path="${escapeHtml(imageUrl)}" />
            </div>
          `;
        }).join('')}
      </div>

      <div class="chrono-actions">
        <button class="btn btn-secondary" type="button" onclick="resetChronologicalPuzzle(${dayId})">Сбросить</button>
        <button class="btn btn-primary" id="check-btn" onclick="checkChronologicalAnswer(${dayId})">Проверить</button>
      </div>
      <div id="feedback"></div>
      <div class="attempts-info" id="attempts-info"></div>
    </div>
  `;

  return html;
}

function resetChronologicalPuzzle(dayId) {
  const puzzle = document.querySelector(`.chrono-puzzle[data-day-id="${dayId}"]`);
  if (!puzzle) return;
  const imageItems = puzzle.querySelectorAll('.chrono-image-item');
  const dropZones = puzzle.querySelectorAll('.chrono-drop');

  imageItems.forEach(item => {
    item.style.opacity = '1';
    item.style.pointerEvents = 'auto';
    item.classList.remove('dragging');
  });

  dropZones.forEach(zone => {
    zone.innerHTML = '<div class="drop-placeholder">Перетащи сюда</div>';
    delete zone.dataset.imageId;
    zone.classList.remove('drag-over');
  });
}

function initChronologicalImagesPuzzle(dayId) {
  const puzzle = document.querySelector(`.chrono-puzzle[data-day-id="${dayId}"]`);
  if (!puzzle) return;

  const imageItems = puzzle.querySelectorAll('.chrono-image-item');
  const dropZones = puzzle.querySelectorAll('.chrono-drop');

  let draggedElement = null;
  let rafId = null;
  let lastTouchMove = null;

  // Desktop drag & drop
  imageItems.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.dataset.imageId);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });
  });

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const imageId = e.dataTransfer.getData('text/plain');
      const imageItem = puzzle.querySelector(`.chrono-image-item[data-image-id="${imageId}"]`);
      if (!imageItem) return;

      // If slot already occupied, free previous
      if (zone.dataset.imageId) {
        const prevImageId = zone.dataset.imageId;
        const prevItem = puzzle.querySelector(`.chrono-image-item[data-image-id="${prevImageId}"]`);
        if (prevItem) {
          prevItem.style.opacity = '1';
          prevItem.style.pointerEvents = 'auto';
        }
      }

      // Remove from previous slot if any
      const previousDrop = puzzle.querySelector(`.chrono-drop[data-image-id="${imageId}"]`);
      if (previousDrop && previousDrop !== zone) {
        previousDrop.innerHTML = '<div class="drop-placeholder">Перетащи сюда</div>';
        delete previousDrop.dataset.imageId;
      }

      zone.innerHTML = '';
      const img = imageItem.querySelector('img').cloneNode(true);
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '10px';
      zone.appendChild(img);
      zone.dataset.imageId = imageId;

      imageItem.style.opacity = '0.3';
      imageItem.style.pointerEvents = 'none';
    });
  });

  // Touch (mobile): reuse "ghost" drag approach
  imageItems.forEach(item => {
    item.addEventListener('touchstart', (e) => {
      e.preventDefault();
      draggedElement = item;
      const touch = e.touches[0];
      item.classList.add('dragging');
      item.style.opacity = '0.5';

      const dragImage = item.cloneNode(true);
      dragImage.style.position = 'fixed';
      dragImage.style.top = `${touch.clientY - 55}px`;
      dragImage.style.left = `${touch.clientX - 55}px`;
      dragImage.style.width = '110px';
      dragImage.style.height = '110px';
      dragImage.style.zIndex = '10000';
      dragImage.style.pointerEvents = 'none';
      dragImage.style.opacity = '0.85';
      dragImage.id = 'drag-ghost-chrono';
      document.body.appendChild(dragImage);
    }, { passive: false });

    item.addEventListener('touchmove', (e) => {
      if (!draggedElement) return;
      e.preventDefault();
      lastTouchMove = e.touches[0];
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const touch = lastTouchMove;
        if (!touch) return;

        const dragGhost = document.getElementById('drag-ghost-chrono');
        if (dragGhost) {
          dragGhost.style.top = `${touch.clientY - 55}px`;
          dragGhost.style.left = `${touch.clientX - 55}px`;
        }

        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        const dropZone = elementBelow?.closest('.chrono-drop');
        dropZones.forEach(z => z.classList.remove('drag-over'));
        if (dropZone) dropZone.classList.add('drag-over');
      });
    }, { passive: false });

    item.addEventListener('touchend', (e) => {
      if (!draggedElement) return;
      e.preventDefault();
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      const touch = e.changedTouches[0];
      const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
      const dropZone = elementBelow?.closest('.chrono-drop');

      const dragGhost = document.getElementById('drag-ghost-chrono');
      if (dragGhost) dragGhost.remove();

      draggedElement.classList.remove('dragging');
      draggedElement.style.opacity = '1';
      dropZones.forEach(z => z.classList.remove('drag-over'));

      if (dropZone) {
        const imageId = draggedElement.dataset.imageId;
        const imageItem = puzzle.querySelector(`.chrono-image-item[data-image-id="${imageId}"]`);
        if (imageItem) {
          // Free previous
          if (dropZone.dataset.imageId) {
            const prevImageId = dropZone.dataset.imageId;
            const prevItem = puzzle.querySelector(`.chrono-image-item[data-image-id="${prevImageId}"]`);
            if (prevItem) {
              prevItem.style.opacity = '1';
              prevItem.style.pointerEvents = 'auto';
            }
          }
          const previousDrop = puzzle.querySelector(`.chrono-drop[data-image-id="${imageId}"]`);
          if (previousDrop && previousDrop !== dropZone) {
            previousDrop.innerHTML = '<div class="drop-placeholder">Перетащи сюда</div>';
            delete previousDrop.dataset.imageId;
          }
          dropZone.innerHTML = '';
          const img = imageItem.querySelector('img').cloneNode(true);
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          img.style.borderRadius = '10px';
          dropZone.appendChild(img);
          dropZone.dataset.imageId = imageId;
          imageItem.style.opacity = '0.3';
          imageItem.style.pointerEvents = 'none';
        }
      }
      draggedElement = null;
    }, { passive: false });
  });
}

function checkChronologicalAnswer(dayId) {
  const puzzle = document.querySelector(`.chrono-puzzle[data-day-id="${dayId}"]`);
  if (!puzzle) return;
  const dropZones = puzzle.querySelectorAll('.chrono-drop');
  const order = [];

  // positions 1..4: collect image ids in order
  for (let pos = 1; pos <= 4; pos++) {
    const zone = puzzle.querySelector(`.chrono-drop[data-position="${pos}"]`);
    const imageId = zone?.dataset.imageId;
    if (imageId === undefined) {
      const feedback = document.getElementById('feedback');
      showFeedback(feedback, 'Заполни все 4 слота', 'error');
      return;
    }
    order.push(parseInt(imageId, 10));
  }

  checkAnswer(dayId, JSON.stringify(order));
}

// Закрытие модала
function closeModal() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.classList.remove('active');
  }
}

// Рендер головоломки с сопоставлением картинок и цифр
function renderMatchImagesPuzzle(dayId, puzzleData) {
  const images = puzzleData.images || [];
  const numbers = puzzleData.numbers || [1, 2, 3, 4];
  
  let html = `
    <div class="match-puzzle" data-day-id="${dayId}">
      <div class="match-instruction">Сопоставь картинки с цифрами:</div>
      <div class="match-container">
        <div class="match-numbers">
          ${numbers.map(num => `
            <div class="match-number-slot" data-number="${num}">
              <div class="match-number-label">${num}</div>
              <div class="match-image-drop" data-number="${num}" id="drop-${dayId}-${num}">
                <div class="drop-placeholder">Перетащи сюда</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="match-images">
          ${images.map((img, idx) => {
            // Поддержка разных форматов URL
            let imageUrl = '';
            if (typeof img === 'string') {
              imageUrl = img;
            } else if (img.url) {
              imageUrl = img.url;
            } else if (img.path) {
              imageUrl = img.path;
            }
            
            // Временно используем placeholder - signed URLs будут загружены через Edge Function
            // Если это уже полный URL, используем его
            let finalUrl = imageUrl;
            if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('data:'))) {
              // Это относительный путь - будет заменен на signed URL после загрузки
              finalUrl = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect fill=\'%23333\' width=\'100\' height=\'100\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' fill=\'%23999\' font-size=\'14\'%3EЗагрузка...%3C/text%3E%3C/svg%3E';
            }
            
            return `
            <div class="match-image-item" draggable="true" data-image-id="${idx}" data-day-id="${dayId}">
              <img src="${finalUrl}" alt="Изображение ${idx + 1}" 
                   data-original-path="${imageUrl}"
                   onerror="console.error('Ошибка загрузки изображения ${idx + 1}:', '${imageUrl}'); this.style.display='none'; this.parentElement.innerHTML='<div style=\\'padding:20px;text-align:center;color:rgba(255,255,255,0.5)\\'>Изображение ${idx + 1}<br><small>Не загружено</small></div>';" />
            </div>
          `;
          }).join('')}
        </div>
      </div>
      <button class="btn btn-primary" id="check-btn" onclick="checkMatchAnswer(${dayId})">
        Проверить
      </button>
      <div id="feedback"></div>
      <div class="attempts-info" id="attempts-info"></div>
    </div>
  `;
  
  return html;
}

// Сброс состояния головоломки с сопоставлением
function resetMatchPuzzle(dayId) {
  const puzzle = document.querySelector(`.match-puzzle[data-day-id="${dayId}"]`);
  if (!puzzle) return;
  
  const imageItems = puzzle.querySelectorAll('.match-image-item');
  const dropZones = puzzle.querySelectorAll('.match-image-drop');
  
  // Возвращаем все картинки обратно
  imageItems.forEach(item => {
    item.style.opacity = '1';
    item.style.pointerEvents = 'auto';
    item.classList.remove('dragging');
  });
  
  // Очищаем все зоны
  dropZones.forEach(zone => {
    zone.innerHTML = '<div class="drop-placeholder">Перетащи сюда</div>';
    delete zone.dataset.imageId;
    zone.classList.remove('drag-over');
  });
}

// Инициализация головоломки с сопоставлением
function initMatchImagesPuzzle(dayId) {
  const puzzle = document.querySelector(`.match-puzzle[data-day-id="${dayId}"]`);
  if (!puzzle) return;
  
  const imageItems = puzzle.querySelectorAll('.match-image-item');
  const dropZones = puzzle.querySelectorAll('.match-image-drop');
  
  let draggedElement = null;
  let rafId = null;
  let lastTouchMove = null;
  
  // Drag & Drop для десктопа
  imageItems.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.dataset.imageId);
      item.classList.add('dragging');
    });
    
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });
  });
  
  dropZones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      
      const imageId = e.dataTransfer.getData('text/plain');
      const imageItem = puzzle.querySelector(`.match-image-item[data-image-id="${imageId}"]`);
      
      if (imageItem && zone.dataset.number) {
        // Если в зоне уже есть картинка, убираем её
        if (zone.dataset.imageId) {
          const prevImageId = zone.dataset.imageId;
          const prevItem = puzzle.querySelector(`.match-image-item[data-image-id="${prevImageId}"]`);
          if (prevItem) {
            prevItem.style.opacity = '1';
            prevItem.style.pointerEvents = 'auto';
          }
        }
        
        // Убираем из предыдущего места, если было
        const previousDrop = puzzle.querySelector(`.match-image-drop[data-image-id="${imageId}"]`);
        if (previousDrop && previousDrop !== zone) {
          previousDrop.innerHTML = '<div class="drop-placeholder">Перетащи сюда</div>';
          delete previousDrop.dataset.imageId;
        }
        
        // Добавляем в новое место
        zone.innerHTML = '';
        const img = imageItem.querySelector('img').cloneNode(true);
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '8px';
        img.style.cursor = 'pointer';
        img.title = 'Кликни, чтобы убрать';
        zone.appendChild(img);
        zone.dataset.imageId = imageId;
        
        // Скрываем оригинальную картинку
        imageItem.style.opacity = '0.3';
        imageItem.style.pointerEvents = 'none';
      }
    });
    
  });
  
  // Touch для мобильных - полноценный drag & drop
  imageItems.forEach(item => {
    item.addEventListener('touchstart', (e) => {
      e.preventDefault();
      draggedElement = item;
      const touch = e.touches[0];
      item.classList.add('dragging');
      item.style.opacity = '0.5';
      
      // Создаем визуальный элемент для перетаскивания
      const dragImage = item.cloneNode(true);
      dragImage.style.position = 'fixed';
      dragImage.style.top = `${touch.clientY - 60}px`;
      dragImage.style.left = `${touch.clientX - 60}px`;
      dragImage.style.width = '120px';
      dragImage.style.height = '120px';
      dragImage.style.zIndex = '10000';
      dragImage.style.pointerEvents = 'none';
      dragImage.style.opacity = '0.8';
      dragImage.id = 'drag-ghost';
      document.body.appendChild(dragImage);
    }, { passive: false });
    
    item.addEventListener('touchmove', (e) => {
      if (!draggedElement) return;
      e.preventDefault();
      lastTouchMove = e.touches[0];
      // Throttle: не делаем тяжёлые операции на каждый touchmove, только раз в кадр
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const touch = lastTouchMove;
        if (!touch) return;
        
        // Обновляем позицию визуального элемента
        const dragGhost = document.getElementById('drag-ghost');
        if (dragGhost) {
          dragGhost.style.top = `${touch.clientY - 60}px`;
          dragGhost.style.left = `${touch.clientX - 60}px`;
        }
        
        // Определяем, над какой зоной находимся
        const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
        const dropZone = elementBelow?.closest('.match-image-drop');
        
        // Убираем подсветку со всех зон
        dropZones.forEach(z => z.classList.remove('drag-over'));
        
        // Подсвечиваем текущую зону
        if (dropZone && !dropZone.dataset.imageId) {
          dropZone.classList.add('drag-over');
        }
      });
    }, { passive: false });
    
    item.addEventListener('touchend', (e) => {
      if (!draggedElement) return;
      e.preventDefault();
      
      // Сбрасываем возможный rAF
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      
      const touch = e.changedTouches[0];
      const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
      const dropZone = elementBelow?.closest('.match-image-drop');
      
      // Убираем визуальный элемент
      const dragGhost = document.getElementById('drag-ghost');
      if (dragGhost) {
        dragGhost.remove();
      }
      
      draggedElement.classList.remove('dragging');
      draggedElement.style.opacity = '1';
      
      // Убираем подсветку со всех зон
      dropZones.forEach(z => z.classList.remove('drag-over'));
      
      if (dropZone) {
        const imageId = draggedElement.dataset.imageId;
        
        // Если в зоне уже есть картинка, убираем её
        if (dropZone.dataset.imageId) {
          const prevImageId = dropZone.dataset.imageId;
          const prevItem = puzzle.querySelector(`.match-image-item[data-image-id="${prevImageId}"]`);
          if (prevItem) {
            prevItem.style.opacity = '1';
            prevItem.style.pointerEvents = 'auto';
          }
        }
        
        // Убираем из предыдущего места, если было
        const previousDrop = puzzle.querySelector(`.match-image-drop[data-image-id="${imageId}"]`);
        if (previousDrop && previousDrop !== dropZone) {
          previousDrop.innerHTML = '<div class="drop-placeholder">Перетащи сюда</div>';
          delete previousDrop.dataset.imageId;
          const prevItem = puzzle.querySelector(`.match-image-item[data-image-id="${imageId}"]`);
          if (prevItem) {
            prevItem.style.opacity = '1';
            prevItem.style.pointerEvents = 'auto';
          }
        }
        
        // Добавляем в новое место
        dropZone.innerHTML = '';
        const img = draggedElement.querySelector('img').cloneNode(true);
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '8px';
        dropZone.appendChild(img);
        dropZone.dataset.imageId = imageId;
        
        // Скрываем оригинальную картинку
        draggedElement.style.opacity = '0.3';
        draggedElement.style.pointerEvents = 'none';
      }
      
      draggedElement = null;
    }, { passive: false });
  });
  
  // Обработчик клика на изображение в зоне для мобильных и десктопа
  dropZones.forEach(zone => {
    zone.addEventListener('click', (e) => {
      // Проверяем, что клик был именно по изображению, а не по placeholder
      if (zone.dataset.imageId && (e.target.tagName === 'IMG' || e.target.closest('img'))) {
        const imageId = zone.dataset.imageId;
        const imageItem = puzzle.querySelector(`.match-image-item[data-image-id="${imageId}"]`);
        
        if (imageItem) {
          // Возвращаем картинку обратно
          imageItem.style.opacity = '1';
          imageItem.style.pointerEvents = 'auto';
          
          // Очищаем зону
          zone.innerHTML = '<div class="drop-placeholder">Перетащи сюда</div>';
          delete zone.dataset.imageId;
        }
      }
    });
  });
}

// Проверка ответа для головоломки с сопоставлением
function checkMatchAnswer(dayId) {
  const puzzle = document.querySelector(`.match-puzzle[data-day-id="${dayId}"]`);
  if (!puzzle) return;
  
  const dropZones = puzzle.querySelectorAll('.match-image-drop');
  const answer = [];
  
  dropZones.forEach(zone => {
    const number = zone.dataset.number;
    const imageId = zone.dataset.imageId;
    if (imageId) {
      answer.push({ number: parseInt(number), imageId: parseInt(imageId) });
    }
  });
  
  if (answer.length === 0) {
    const feedback = document.getElementById('feedback');
    showFeedback(feedback, 'Сопоставь все картинки с цифрами', 'error');
    return;
  }
  
  // Отправляем ответ в формате JSON строки
  checkAnswer(dayId, JSON.stringify(answer));
}

// Проверка ответа через Edge Function
async function checkAnswer(dayId, customAnswer = null) {
  const input = document.getElementById('answer-input');
  const btn = document.getElementById('check-btn');
  const feedback = document.getElementById('feedback');
  const attemptsInfo = document.getElementById('attempts-info');

  if (!btn) return;

  let answer;
  if (customAnswer !== null) {
    answer = customAnswer;
  } else {
    if (!input) return;
    answer = input.value.trim();
  }
  
  if (!answer) {
    showFeedback(feedback, 'Введи ответ', 'error');
    return;
  }

  // Блокируем UI
  btn.disabled = true;
  if (input) input.disabled = true;
  if (feedback) feedback.innerHTML = '<div class="loading">Проверяю...</div>';

  try {
    const response = await fetch(`${getSupabaseFunctionsUrl()}/check_answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupabaseAnonKey()}`
      },
      body: JSON.stringify({
        day_id: dayId,
        answer: answer
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Ошибка проверки');
    }

    if (result.ok) {
      // Правильный ответ!
      showFeedback(feedback, '🎉 Правильно!', 'success');
      if (input) input.disabled = true;
      btn.disabled = true;

      console.log('Правильный ответ для дня', dayId, '- закрываю модалку и подсвечиваю карточку');
      
      // Сразу закрываем модалку и возвращаем на календарь
      closeModal();
      // ВАЖНО: подавляем "клик сквозь модалку" на мобильных/тач-устройствах.
      // Иначе тот же tap может мгновенно нажать на карточку под модалкой и открыть reward,
      // из-за чего тряска видна только на фоне.
      window.__suppressDayClicksUntil = Date.now() + 800;
      
      // Небольшая задержка для плавного перехода
      await new Promise(resolve => setTimeout(resolve, 40));
      
      // Обновляем список дней и подсвечиваем "ждёт забора"
      await loadDays();

      highlightSolvedDay(dayId);
    } else {
      // Неправильный ответ
      showFeedback(feedback, result.message || 'Неправильно, попробуй ещё', 'error');
      
      // Если это головоломка с сопоставлением, сбрасываем состояние
      const puzzle = document.querySelector(`.match-puzzle[data-day-id="${dayId}"]`);
      if (puzzle) {
        resetMatchPuzzle(dayId);
      }
      
      if (input) {
        input.disabled = false;
        input.focus();
        input.select();
      }
      btn.disabled = false;

      if (result.attempts_left !== undefined && attemptsInfo) {
        attemptsInfo.textContent = `Осталось попыток: ${result.attempts_left}`;
      }

      // Если попытки закончились и пришёл locked_until — подхватываем и показываем таймер
      if (result.attempts_left === 0 && result.locked_until && attemptsInfo) {
        attemptsInfo.innerHTML = `Попробуешь через <span class="day-countdown" data-countdown-to="${result.locked_until}">—</span>`;
        startPerCardTimers();
        // Перерисуем карточки, чтобы на календаре появился статус "провалил"
        loadDays().catch(() => {});
      }
    }
  } catch (error) {
    console.error('Ошибка проверки:', error);
    console.error('URL:', `${getSupabaseFunctionsUrl()}/check_answer`);
    
    let errorMessage = 'Ошибка соединения. Попробуй ещё раз.';
    
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = 'Edge Function не задеплоена. Выполни: supabase functions deploy check_answer';
    } else if (error.message.includes('404')) {
      errorMessage = 'Edge Function не найдена. Проверь деплой.';
    } else if (error.message.includes('CORS')) {
      errorMessage = 'Ошибка CORS. Проверь настройки функции.';
    }
    
    showFeedback(feedback, errorMessage, 'error');
    const inputEl = document.getElementById('answer-input');
    if (inputEl) inputEl.disabled = false;
    btn.disabled = false;
  }
}

// Показ фидбека
function showFeedback(container, message, type) {
  if (!container) return;
  container.innerHTML = `<div class="feedback feedback-${type}">${message}</div>`;
}

// Загрузка signed URL для картинки вопроса
async function loadPuzzleQuestionImage(dayId, puzzleData) {
  if (!puzzleData) return;

  const paths = Array.isArray(puzzleData.question_images)
    ? puzzleData.question_images.map(String)
    : (puzzleData.image ? [String(puzzleData.image)] : []);

  if (paths.length === 0) {
    return;
  }
  
  try {
    const url = `${getSupabaseFunctionsUrl()}/get_puzzle_images`;

    for (let idx = 0; idx < paths.length; idx++) {
      let imagePath = paths[idx];
      if (!imagePath) continue;

      // Full URL? nothing to do.
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('data:')) {
        continue;
      }

      // Find element: new multi-image selector (fallback to old single selector)
      const el = document.querySelector(`.puzzle-question-image[data-day-id="${dayId}"][data-question-idx="${idx}"]`)
        || document.querySelector(`.puzzle-image[data-day-id="${dayId}"]`);
      if (!el) continue;

      // Normalize path (edge fn also strips prefixes, but keep it consistent)
      if (imagePath.startsWith('rewards/')) {
        imagePath = imagePath.replace(/^rewards\//, '');
      } else if (imagePath.startsWith('puzzles/')) {
        imagePath = imagePath.replace(/^puzzles\//, '');
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getSupabaseAnonKey()}`
        },
        body: JSON.stringify({ day_id: dayId, image_path: imagePath })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Ошибка загрузки картинки вопроса (HTTP):', response.status, errorText);
        continue;
      }

      const result = await response.json();
      if (result.ok && result.questionImageUrl) {
        el.src = result.questionImageUrl;
      } else {
        console.error('Не удалось получить signed URL для картинки вопроса:', result);
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки картинки вопроса:', error);
  }
}

// Загрузка signed URLs для изображений головоломки
async function loadPuzzleImages(dayId) {
  const matchPuzzle = document.querySelector(`.match-puzzle[data-day-id="${dayId}"]`);
  const chronoPuzzle = document.querySelector(`.chrono-puzzle[data-day-id="${dayId}"]`);
  const puzzle = matchPuzzle || chronoPuzzle;
  if (!puzzle) {
    console.warn('Головоломка не найдена для загрузки изображений');
    return;
  }

  const imageItems = matchPuzzle
    ? matchPuzzle.querySelectorAll('.match-image-item img')
    : chronoPuzzle.querySelectorAll('.chrono-image-item img');
  if (imageItems.length === 0) return;

  try {
    const url = `${getSupabaseFunctionsUrl()}/get_puzzle_images`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupabaseAnonKey()}`
      },
      body: JSON.stringify({ day_id: dayId })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ошибка загрузки изображений головоломки:', errorText);
      return;
    }

    const result = await response.json();
    if (result.ok && result.images) {
      // Обновляем src всех изображений
      imageItems.forEach((img, idx) => {
        if (result.images[idx] && result.images[idx].signedUrl) {
          img.src = result.images[idx].signedUrl;
        } else if (result.images[idx] && result.images[idx].error) {
          console.error(`Ошибка загрузки изображения ${idx + 1}:`, result.images[idx].error);
        }
      });
    }
  } catch (error) {
    console.error('Ошибка загрузки изображений головоломки:', error);
  }
}

// Загрузка награды (для уже решённых дней)
async function loadReward(dayId) {
  const rewardContent = document.getElementById('reward-content');
  if (!rewardContent) {
    console.error('Элемент reward-content не найден');
    return;
  }

  console.log('Загружаю награду для дня:', dayId);

  try {
    const url = `${getSupabaseFunctionsUrl()}/get_reward`;
    console.log('Вызываю Edge Function:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupabaseAnonKey()}`
      },
      body: JSON.stringify({ day_id: dayId })
    });

    console.log('Ответ от get_reward:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ошибка ответа:', errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('Результат get_reward:', result);

    if (result.ok && result.reward) {
      const isFirstOpen = !!result.first_open;

      // Анимация “дверцы” теперь делается ДО модалки (на карточке) в startClaimRewardFlow().
      // Тут только показываем награду и синхронизируем состояние карточек.
      showReward(result.reward, { firstOpen: isFirstOpen });
      loadDays().catch(() => {});
    } else {
      console.error('Награда не найдена:', result);
      rewardContent.innerHTML = `<div class="loading">Ошибка: ${result.message || 'Награда не найдена'}</div>`;
    }
  } catch (error) {
    console.error('Ошибка загрузки награды:', error);
    let errorMessage = 'Ошибка загрузки награды';
    
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      errorMessage = 'Edge Function get_reward не задеплоена. Выполни: supabase functions deploy get_reward';
    } else if (error.message.includes('404')) {
      errorMessage = 'Edge Function не найдена. Проверь деплой.';
    }
    
    rewardContent.innerHTML = `<div class="loading">${errorMessage}</div>`;
  }
}

// Показ награды
function showReward(reward, opts = {}) {
  const rewardContent = document.getElementById('reward-content');
  if (!rewardContent) return;
  const firstOpen = !!opts.firstOpen;

  let html = `
    <div class="reward-content reward-reveal ${firstOpen ? 'reward-first-open' : ''}">
  `;

  if (reward.type === 'text') {
    html += `<p>${reward.data.text || ''}</p>`;
  } else if (reward.type === 'image') {
    html += `<img src="${reward.data.url}" alt="Награда" class="reward-image" />`;
    if (reward.data.caption) {
      html += `<p>${reward.data.caption}</p>`;
    }
  } else if (reward.type === 'link') {
    html += `<p>${reward.data.text || ''}</p>`;
    html += `<a href="${reward.data.url}" target="_blank" class="reward-link">${reward.data.label || 'Открыть'}</a>`;
  } else if (reward.type === 'video') {
    html += `<video controls class="reward-image"><source src="${reward.data.url}" type="video/mp4"></video>`;
    if (reward.data.caption) {
      html += `<p>${reward.data.caption}</p>`;
    }
  } else {
    html += `<p>${JSON.stringify(reward.data)}</p>`;
  }

  html += `
    </div>
    <button class="btn btn-secondary" onclick="closeModal(); loadDays();" style="margin-top: 16px; width: 100%;">
      Вернуться к календарю
    </button>
  `;
  rewardContent.innerHTML = html;
}

// Подсветка решенного дня
function highlightSolvedDay(dayId) {
  const dayElement = document.querySelector(`.day[data-day-id="${dayId}"]`);
  if (!dayElement) {
    // Если элемент еще не загружен, ждем немного
    setTimeout(() => highlightSolvedDay(dayId), 100);
    return;
  }
  
  console.log('highlightSolvedDay: добавляю класс day-awaiting-claim для дня', dayId);
  
  // Добавляем класс для анимации
  dayElement.classList.add('day-awaiting-claim');
  
  // Прокручиваем к элементу
  dayElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  
  // НЕ убираем класс автоматически - он будет убран при открытии модалки
}

// Закрытие модала по клику вне его
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });
  }
});

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM загружен, инициализирую приложение...');
  
  // Проверяем, что все зависимости загружены
  if (typeof window.supabase === 'undefined') {
    console.error('Supabase SDK не загружен! Проверь подключение скрипта.');
    document.getElementById('days').innerHTML = '<div class="loading">Ошибка: Supabase SDK не загружен 😢<br><small>Проверь подключение интернета</small></div>';
    return;
  }

  if (typeof window.supabaseClient === 'undefined') {
    console.error('supabaseClient не создан! Проверь supabase.js');
    document.getElementById('days').innerHTML = '<div class="loading">Ошибка: клиент не создан 😢<br><small>Проверь supabase.js</small></div>';
    return;
  }

  console.log('Все зависимости загружены, загружаю дни...');
  loadDays();
});

// Экспорт функций для глобального доступа
window.closeModal = closeModal;
window.checkAnswer = checkAnswer;

