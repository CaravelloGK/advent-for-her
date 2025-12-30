# Логика работы puzzle type "match_images"

## Общее описание
Головоломка типа `match_images` позволяет пользователю сопоставить 4 изображения с 4 цифрами путем drag-and-drop (на десктопе) или touch drag-and-drop (на мобильных устройствах).

## Структура данных в БД

### Таблица `days`:
- `puzzle_type`: `'match_images'`
- `puzzle_data` (JSONB):
  ```json
  {
    "image": "rewards/day2.jpg",  // Картинка вопроса (главная картинка)
    "question": "Текст вопроса",
    "images": ["rewards/img1.jpg", "rewards/img2.jpg", "rewards/img3.jpg", "rewards/img4.jpg"],  // 4 картинки для сопоставления
    "numbers": [1, 2, 3, 4]  // Цифры (опционально, по умолчанию [1,2,3,4])
  }
  ```
- `correct_answer` (JSONB или TEXT):
  ```json
  [
    {"number": 1, "imageId": 0},
    {"number": 2, "imageId": 1},
    {"number": 3, "imageId": 2},
    {"number": 4, "imageId": 3}
  ]
  ```
  Где `imageId` - это индекс изображения в массиве `puzzle_data.images` (начинается с 0).

## Поток работы

### 1. Открытие модального окна (`openDayModal`)

**Файл:** `app.js`, функция `openDayModal(day)`

**Шаги:**
1. Проверяется тип головоломки: `if (day.puzzle_type === 'match_images')`
2. Генерируется HTML для модального окна:
   - Картинка вопроса (`puzzle_data.image`) вставляется с placeholder'ом
   - Вызывается `renderMatchImagesPuzzle(day.id, puzzleData)` для генерации HTML головоломки
3. HTML вставляется в DOM
4. После вставки (через `setTimeout` 100ms):
   - Параллельно загружаются signed URLs:
     - `loadPuzzleQuestionImage(day.id, day.puzzle_data)` - для картинки вопроса
     - `loadPuzzleImages(day.id)` - для 4 картинок головоломки
   - После загрузки вызывается `initMatchImagesPuzzle(day.id)` для инициализации drag-and-drop

### 2. Рендеринг головоломки (`renderMatchImagesPuzzle`)

**Файл:** `app.js`, функция `renderMatchImagesPuzzle(dayId, puzzleData)`

**Генерирует HTML:**
- Контейнер `.match-puzzle[data-day-id="${dayId}"]`
- 4 зоны для цифр (`.match-number-slot`):
  - Каждая содержит цифру (`.match-number-label`)
  - И зону для drop (`.match-image-drop[data-number="${num}"]`)
- 4 картинки для перетаскивания (`.match-image-item[data-image-id="${idx}"]`)
- Кнопка "Проверить"
- Контейнеры для feedback и attempts info

**Важно:**
- Картинки изначально показываются с placeholder'ом (SVG "Загрузка...")
- В атрибуте `data-original-path` сохраняется оригинальный путь для последующей загрузки signed URL

### 3. Загрузка signed URLs

#### 3.1. Картинка вопроса (`loadPuzzleQuestionImage`)

**Файл:** `app.js`, функция `loadPuzzleQuestionImage(dayId, puzzleData)`

**Логика:**
1. Проверяет наличие `puzzleData.image`
2. Ищет элемент `.puzzle-image[data-day-id="${dayId}"]` в DOM
3. Если путь относительный (не `http://` или `https://`), отправляет запрос к Edge Function `get_puzzle_images` с параметром `image_path`
4. Получает signed URL и обновляет `src` элемента

**Edge Function:** `supabase/functions/get_puzzle_images/index.ts`
- Принимает `{ day_id, image_path }`
- Генерирует signed URL для файла из bucket `rewards`
- Возвращает `{ ok: true, questionImageUrl: "..." }`

#### 3.2. Картинки головоломки (`loadPuzzleImages`)

**Файл:** `app.js`, функция `loadPuzzleImages(dayId)`

**Логика:**
1. Находит все `.match-image-item img` в головоломке
2. Собирает пути из `data-original-path`
3. Отправляет запрос к Edge Function `get_puzzle_images` с `day_id` (без `image_path`)
4. Edge Function получает `puzzle_data.images` из БД и генерирует signed URLs для всех
5. Обновляет `src` всех изображений

**Edge Function:** `supabase/functions/get_puzzle_images/index.ts`
- Принимает только `{ day_id }`
- Получает `puzzle_data.images` из БД
- Генерирует signed URLs для каждого изображения
- Возвращает `{ ok: true, images: [{ original, signedUrl }, ...] }`

### 4. Инициализация drag-and-drop (`initMatchImagesPuzzle`)

**Файл:** `app.js`, функция `initMatchImagesPuzzle(dayId)`

#### 4.1. Desktop (Drag & Drop API)

**События:**
- `dragstart` на `.match-image-item`:
  - Сохраняет `imageId` в `dataTransfer`
  - Добавляет класс `dragging`
- `dragover` на `.match-image-drop`:
  - `preventDefault()`
  - Добавляет класс `drag-over` (подсветка)
- `dragleave` на `.match-image-drop`:
  - Убирает класс `drag-over`
- `drop` на `.match-image-drop`:
  - Получает `imageId` из `dataTransfer`
  - Если в зоне уже есть картинка, возвращает её обратно в pool
  - Клонирует `<img>` из `.match-image-item` и вставляет в зону
  - Сохраняет `imageId` в `zone.dataset.imageId`
  - Скрывает оригинальную картинку (opacity: 0.3, pointer-events: none)

#### 4.2. Mobile (Touch Events)

**События:**
- `touchstart` на `.match-image-item`:
  - Создает визуальный "ghost" элемент (клонированная картинка, position: fixed)
  - Сохраняет элемент в `draggedElement`
  - Добавляет класс `dragging`
- `touchmove`:
  - Обновляет позицию ghost элемента
  - Определяет, над какой зоной находится палец (`elementFromPoint`)
  - Подсвечивает зону (класс `drag-over`)
- `touchend`:
  - Определяет финальную зону drop
  - Выполняет ту же логику, что и desktop `drop`
  - Удаляет ghost элемент

#### 4.3. Удаление картинки из зоны (клик)

**Событие:** `click` на `.match-image-drop`
- Если в зоне есть картинка (`zone.dataset.imageId`), возвращает её в pool
- Очищает зону

### 5. Проверка ответа (`checkMatchAnswer`)

**Файл:** `app.js`, функция `checkMatchAnswer(dayId)`

**Логика:**
1. Собирает все `.match-image-drop` зоны
2. Для каждой зоны извлекает:
   - `number` из `zone.dataset.number`
   - `imageId` из `zone.dataset.imageId`
3. Формирует массив ответа:
   ```javascript
   [
     { number: 1, imageId: 0 },
     { number: 2, imageId: 1 },
     ...
   ]
   ```
4. Вызывает `checkAnswer(dayId, JSON.stringify(answer))`

### 6. Серверная проверка (`check_answer` Edge Function)

**Файл:** `supabase/functions/check_answer/index.ts`

**Логика для `match_images`:**
1. Парсит `answer` (JSON строка) в массив
2. Парсит `day.correct_answer` (может быть JSONB или строка)
3. Сортирует оба массива по `number`
4. Сравнивает поэлементно:
   ```typescript
   userAnswer.every((ua, index) =>
     ua.number === correctAnswer[index].number && 
     ua.imageId === correctAnswer[index].imageId
   )
   ```
5. Если правильно:
   - Записывает в `solves`
   - Возвращает `reward_data` (с signed URL для изображений)
6. Если неправильно:
   - Записывает попытку в `attempts`
   - Возвращает `{ ok: false, message: "...", attempts_left: ... }`

### 7. Сброс головоломки (`resetMatchPuzzle`)

**Файл:** `app.js`, функция `resetMatchPuzzle(dayId)`

Вызывается при неправильном ответе:
- Возвращает все картинки в pool (opacity: 1, pointer-events: auto)
- Очищает все зоны (удаляет `dataset.imageId`, показывает placeholder)

## Проблемы и оптимизации

### Текущие проблемы:

1. **Картинка вопроса открывается в гигантском размере**
   - Стили `.puzzle-image` добавлены в `styles.css`:
     ```css
     .puzzle-image {
       max-width: 100%;
       max-height: 400px;
       width: auto;
       height: auto;
       object-fit: contain;
       ...
     }
     ```
   - Но картинка все равно отображается в полном размере
   - Возможные причины:
     - Стили не применяются (специфичность CSS)
     - Картинка вставляется в `.question`, который может иметь свои стили
     - Нужно проверить, что селектор `.puzzle-image` правильно применяется

2. **Неоптимизированный код:**
   - Множественные `setTimeout` с задержками
   - Дублирование логики для desktop и mobile drag-and-drop
   - Множественные `querySelector` в циклах
   - Нет обработки ошибок загрузки изображений
   - Нет debounce для touch events

3. **Потенциальные улучшения:**
   - Использовать `MutationObserver` вместо `setTimeout` для ожидания DOM
   - Объединить логику desktop/mobile drag-and-drop
   - Кэшировать `querySelector` результаты
   - Добавить loading states для всех изображений
   - Оптимизировать touch events (throttle вместо множественных обновлений)

## CSS структура

### Селекторы:
- `.match-puzzle` - контейнер головоломки
- `.match-number-slot` - слот для цифры и зоны drop
- `.match-image-drop` - зона для drop картинки
- `.match-image-item` - картинка для перетаскивания
- `.puzzle-image` - картинка вопроса (должна быть ограничена размерами)
- `.question` - контейнер вопроса (может влиять на размер картинки)

### Проблема с размером картинки вопроса:
Картинка вставляется в `.question`, который имеет:
- `padding: 20px`
- `background: rgba(0, 0, 0, 0.2)`
- `border-radius: 12px`

Возможно, нужно:
- Убедиться, что `.puzzle-image` имеет `display: block`
- Добавить `overflow: hidden` в `.question` если картинка выходит за границы
- Проверить, что `max-width: 100%` учитывает padding родителя



