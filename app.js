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

// Проверка, доступен ли день
function isDayUnlocked(unlockAt) {
  if (!unlockAt) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const unlockDate = new Date(unlockAt);
  unlockDate.setHours(0, 0, 0, 0);
  return unlockDate <= today;
}

// Форматирование даты
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long'
  });
}

// Получение дня недели
function getWeekday(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('ru-RU', {
    weekday: 'short'
  });
}

// Получение числа дня
function getDayNumber(dateString) {
  const date = new Date(dateString);
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
      .select('id, unlock_at, puzzle_type, puzzle_data')
      .order('id');

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
    updateProgress(processedData);
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
  window.__cardTimersInterval = setInterval(() => {
    document.querySelectorAll('[data-countdown-to]').forEach((el) => {
      const to = el.getAttribute('data-countdown-to');
      if (!to) return;
      const ts = new Date(to).getTime();
      if (!Number.isFinite(ts)) return;
      const diff = ts - Date.now();
      el.textContent = diff <= 0 ? '0м 0с' : formatCountdownMs(diff);
    });
  }, 1000);
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
    const dayNumber = getDayNumber(day.unlock_at);
    
    // Обёртка для контента (для блюра)
    let content = '<div class="day-content">';
    content += `<div class="day-weekday">${weekday}</div>`;
    content += `<div class="day-number">${dayNumber}</div>`;
    let statusHtml = '';

    if (!isUnlockedByDate) {
      const unlockTo = new Date(day.unlock_at).toISOString();
      statusHtml = `
        <div class="day-status day-status-locked">
          Откроется через <span class="day-countdown" data-countdown-to="${unlockTo}">—</span>
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
      let questionHtml = '';
      
      if (puzzleData.image) {
        questionHtml += `<img src="${puzzleData.image}" alt="Загадка" class="day-question-image" />`;
      }
      
      if (puzzleData.question) {
        questionHtml += `<div class="day-question-text">${puzzleData.question}</div>`;
      } else {
        questionHtml += `<div class="day-question-text">Загадка</div>`;
      }
      
      content += `
        <div class="day-question">${questionHtml}</div>
      `;
      statusHtml = `<div class="day-status">Готово к решению</div>`;
    }

    content += '</div>'; // закрываем day-content
    content += statusHtml; // статус/таймер поверх, не под blur

    div.innerHTML = content;

    if (isUnlocked) {
      div.addEventListener('click', () => handleDayClick(day));
    } else if (isLockedByAttempts) {
      div.addEventListener('click', () => openDayModal(day));
    }

    container.appendChild(div);
    
    // (no inline style hacks here; animations are driven purely by CSS classes)
  });
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
    openDayModal(day);
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


// Обновление прогресса
function updateProgress(days) {
  const progressEl = document.getElementById('progress');
  if (!progressEl) return;

  const solved = days.filter(d => d.solved_at).length;
  const total = days.length;
  progressEl.textContent = `Открыто ${solved} из ${total}`;
}

// Открытие модала дня
function openDayModal(day) {
  const modal = document.getElementById('modal');
  const modalContent = document.getElementById('modal-content');
  
  if (!modal || !modalContent) return;

  const isUnlocked = isDayUnlocked(day.unlock_at);
  const isSolved = !!day.solved_at;
  const isLockedByAttempts = isAttemptsLocked(day);

  let html = `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-header">
      <div class="modal-title">День ${day.id}</div>
      <div class="modal-subtitle">${formatDate(day.unlock_at)}</div>
    </div>
    <div class="modal-body">
  `;

  if (!isUnlocked) {
    html += `
      <div class="question">🔒 Этот день ещё не открыт. Откроется ${formatDate(day.unlock_at)}.</div>
    `;
  } else if (isLockedByAttempts) {
    const retryTo = day.attempts_locked_until ? new Date(day.attempts_locked_until).toISOString() : null;
    html += `
      <div class="question">😵 Ты использовал(а) все попытки. Можно попробовать снова через ${retryTo ? `<span class="day-countdown" data-countdown-to="${retryTo}">—</span>` : '24 часа'}.</div>
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
    
    // Показываем вопрос/картинку
    let questionHtml = '';
    if (puzzleData.image) {
      // Всегда показываем placeholder для относительных путей, signed URL загрузится позже
      const originalPath = puzzleData.image;
      let imageUrl = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'400\' height=\'200\'%3E%3Crect fill=\'%23333\' width=\'400\' height=\'200\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\' fill=\'%23999\' font-size=\'16\'%3EЗагрузка...%3C/text%3E%3C/svg%3E';
      
      // Только если это уже полный URL (http/https), используем его напрямую
      if (originalPath.startsWith('http://') || originalPath.startsWith('https://')) {
        imageUrl = originalPath;
      }
      
      questionHtml += `<img src="${imageUrl}" alt="Загадка" class="puzzle-image" data-day-id="${day.id}" data-original-path="${escapeHtml(originalPath)}" />`;
    }
    if (puzzleData.question) {
      questionHtml += `<div class="question-text">${puzzleData.question}</div>`;
    }
    
    html += `<div class="question">${questionHtml || 'Загадка'}</div>`;
    
    // Разные типы головоломок
    if (puzzleType === 'match_images') {
      // Головоломка с сопоставлением картинок и цифр
      // Загружаем signed URLs для изображений
      html += renderMatchImagesPuzzle(day.id, puzzleData);
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
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Обновляем список дней и подсвечиваем "ждёт забора"
      await loadDays();
      
      // Даём DOM время на обновление
      await new Promise(resolve => setTimeout(resolve, 100));
      
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
  if (!puzzleData || !puzzleData.image) {
    console.log('loadPuzzleQuestionImage: нет puzzleData или image');
    return;
  }
  
  const questionImage = document.querySelector(`.puzzle-image[data-day-id="${dayId}"]`);
  if (!questionImage) {
    console.log('loadPuzzleQuestionImage: элемент не найден для dayId', dayId);
    return;
  }
  
  let imagePath = puzzleData.image;
  console.log('loadPuzzleQuestionImage: загружаю картинку вопроса:', imagePath);
  
  // Если это уже полный URL, не обрабатываем
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    console.log('loadPuzzleQuestionImage: это уже полный URL, пропускаю');
    return;
  }
  
  try {
    // Извлекаем путь к файлу
    if (imagePath.startsWith('rewards/')) {
      imagePath = imagePath.replace(/^rewards\//, '');
    } else if (imagePath.startsWith('puzzles/')) {
      imagePath = imagePath.replace(/^puzzles\//, '');
    }
    
    console.log('loadPuzzleQuestionImage: отправляю запрос с путем:', imagePath);
    
    // Используем Edge Function для получения signed URL
    const url = `${getSupabaseFunctionsUrl()}/get_puzzle_images`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupabaseAnonKey()}`
      },
      body: JSON.stringify({ 
        day_id: dayId,
        image_path: imagePath // Передаем путь к картинке вопроса
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ошибка загрузки картинки вопроса (HTTP):', response.status, errorText);
      return;
    }

    const result = await response.json();
    console.log('Результат загрузки картинки вопроса:', result);
    if (result.ok && result.questionImageUrl) {
      questionImage.src = result.questionImageUrl;
      console.log('Картинка вопроса обновлена:', result.questionImageUrl);
    } else {
      console.error('Не удалось получить signed URL для картинки вопроса:', result);
    }
  } catch (error) {
    console.error('Ошибка загрузки картинки вопроса:', error);
  }
}

// Загрузка signed URLs для изображений головоломки
async function loadPuzzleImages(dayId) {
  const puzzle = document.querySelector(`.match-puzzle[data-day-id="${dayId}"]`);
  if (!puzzle) {
    console.warn('Головоломка не найдена для загрузки изображений');
    return;
  }

  const imageItems = puzzle.querySelectorAll('.match-image-item img');
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

