const { loadHistory, saveHistory, getShopFacts, addShopFact } = require('./memory');
const {
  publishPhoto,
  publishCarousel,
  publishReel,
  publishStory,
  getAccountInsights,
  getRecentMediaWithInsights,
  searchAudio
} = require('./instagram');
const { uploadImageAndGetPublicUrl, uploadVideoAndGetPublicUrl } = require('./cloudinary-upload');

// Медиа (фото/видео/карусель), ожидающее публикации — по одному "слоту" на чат.
const pendingMediaByChat = new Map();

// Функция уведомления чата (устанавливается telegram-bot.js), нужна для отложенных постов.
let notifier = null;
function setNotifier(fn) {
  notifier = fn;
}

function setPendingPhoto(chatId, base64, mimetype) {
  pendingMediaByChat.set(chatId, { type: 'photo', base64, mimetype });
}
function setPendingCarousel(chatId, images) {
  pendingMediaByChat.set(chatId, { type: 'carousel', images });
}
function setPendingVideo(chatId, base64, mimetype) {
  pendingMediaByChat.set(chatId, { type: 'video', base64, mimetype });
}

const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000; // Минск: UTC+3 круглый год

function getMinskNowIso() {
  const d = new Date(Date.now() + MINSK_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+03:00`;
}

function formatMinsk(date) {
  return date.toLocaleString('ru-RU', {
    timeZone: 'Europe/Minsk',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  }) + ' (время Минска)';
}

function describePendingMedia(chatId) {
  const pending = pendingMediaByChat.get(chatId);
  if (!pending) return 'Сейчас нет ожидающего фото/видео — если нужно действие с медиа, попроси прислать.';
  if (pending.type === 'carousel') return `Сейчас есть карусель из ${pending.images.length} фото, ожидающая публикации.`;
  if (pending.type === 'video') return 'Сейчас есть видео, ожидающее публикации.';
  return 'Сейчас есть одно фото, ожидающее публикации.';
}

function buildSystemPrompt(brand, chatId) {
  const facts = getShopFacts(brand.id);
  const factsBlock = facts.length
    ? `\n\nДолгосрочные факты о магазине:\n${facts.map((f) => `- ${f.fact}`).join('\n')}`
    : '';
  const doNotMentionBlock = brand.profile.doNotMention?.length
    ? `\nНе упоминай: ${brand.profile.doNotMention.join(', ')}`
    : '';

  return `Ты — умный ассистент по ведению Instagram для цветочного магазина "${brand.displayName}". Общайся с владельцем живо и по-человечески, как в обычном чате, и помни весь предыдущий разговор.

Описание бизнеса: ${brand.profile.description}
Целевая аудитория: ${brand.profile.targetAudience}
Тон общения в постах: ${brand.profile.tone}
Цель: ${brand.profile.goals}${doNotMentionBlock}${factsBlock}

Текущее время в Минске: ${getMinskNowIso()}
${describePendingMedia(chatId)}

Как себя вести:
- Когда пришло фото или видео — предложи живую подпись для Instagram-поста на русском языке с эмодзи, и спроси, нравится ли, или предложи опубликовать.
- Если пользователь просит что-то поправить в подписи (короче, добавить деталь, убрать эмодзи и т.д.) — просто предложи новый вариант текстом в ответе, инструменты для этого не нужны.
- Публикуй (вызывай publish_post) только когда пользователь явно подтвердил, что готов опубликовать именно сейчас, используя ПОСЛЕДНИЙ согласованный вариант подписи.
- Если пользователь просит опубликовать позже ("через N часов", "завтра в HH:MM" и т.п.) — вызови schedule_post, сам вычислив точное время в ISO 8601 (с суффиксом +03:00) на основе текущего времени, указанного выше.
- Если пользователь спрашивает про статистику, подписчиков, охваты — вызови get_instagram_stats и перескажи результат живым языком, не просто цифрами.
- Если пользователь сообщает важный долгосрочный факт о магазине (новый адрес, акция, изменение цен, новая услуга) — вызови remember_shop_fact.
- Если для действия (публикации) нет ожидающего фото/видео — прямо скажи об этом и попроси прислать медиа, никогда не выдумывай, что медиа нет, если оно указано как ожидающее выше.
- Если публикуешь видео как Reels (не Stories) — можешь указать music_query: если пользователь описал настроение/жанр/артиста для музыки, передай эти ключевые слова; если ничего не просил про музыку — оставь music_query пустым, тогда будет автоматически подобрана трендовая музыка. Оригинальный звук видео при этом всегда убирается, чтобы не было двух наложенных звуков.
- Никогда не публикуй без явного подтверждения пользователя в этом разговоре.`;
}

const tools = [
  {
    name: 'publish_post',
    description: 'Опубликовать текущее ожидающее фото/видео/карусель в Instagram прямо сейчас — как обычный пост в ленте, Reels или как историю (Stories).',
    input_schema: {
      type: 'object',
      properties: {
        caption: { type: 'string', description: 'Финальный текст подписи для публикации. Для историй (is_story=true) можно передать пустую строку.' },
        is_story: { type: 'boolean', description: 'true — опубликовать как историю (Stories), false — как обычный пост в ленте/Reels.' },
        music_query: { type: 'string', description: 'Только для видео (Reels): ключевые слова настроения/жанра музыки, если пользователь их указал. Если не указал — не передавай это поле, будет подобрана трендовая музыка автоматически.' }
      },
      required: ['caption', 'is_story']
    }
  },
  {
    name: 'schedule_post',
    description: 'Запланировать публикацию на будущее время, если пользователь просит опубликовать не прямо сейчас, а позже.',
    input_schema: {
      type: 'object',
      properties: {
        caption: { type: 'string', description: 'Финальный текст подписи.' },
        is_story: { type: 'boolean' },
        scheduled_time_minsk: { type: 'string', description: 'Точное время публикации в ISO 8601 со смещением +03:00, например 2026-09-15T10:00:00+03:00.' },
        music_query: { type: 'string', description: 'Только для видео (Reels): ключевые слова настроения/жанра музыки, если пользователь их указал.' }
      },
      required: ['caption', 'is_story', 'scheduled_time_minsk']
    }
  },
  {
    name: 'get_instagram_stats',
    description: 'Получить статистику аккаунта Instagram: число подписчиков и метрики последних постов (охват, лайки, комментарии, сохранения).',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'remember_shop_fact',
    description: 'Сохранить важный факт о магазине на длительный срок (новый адрес, акция, изменение цен и т.п.), чтобы он учитывался даже после перезапуска бота.',
    input_schema: {
      type: 'object',
      properties: { fact: { type: 'string', description: 'Краткая формулировка факта.' } },
      required: ['fact']
    }
  }
];

async function executePublishAction(brand, chatId, { caption, is_story, music_query }) {
  const pending = pendingMediaByChat.get(chatId);
  if (!pending) {
    return { success: false, message: 'Нет ожидающего фото или видео для публикации. Нужно сначала прислать медиа.' };
  }

  try {
    if (pending.type === 'carousel') {
      if (is_story) {
        return { success: false, message: 'Карусель нельзя опубликовать как историю — нужно одно фото или видео.' };
      }
      const imageUrls = [];
      for (const img of pending.images) {
        // eslint-disable-next-line no-await-in-loop
        const url = await uploadImageAndGetPublicUrl(img.base64, img.mimetype, 'feed');
        imageUrls.push(url);
      }
      const result = await publishCarousel(brand, { imageUrls, caption });
      pendingMediaByChat.delete(chatId);
      return { success: true, message: `Карусель опубликована: ${result.permalink}` };
    }

    if (pending.type === 'video') {
      if (is_story) {
        const videoUrl = await uploadVideoAndGetPublicUrl(pending.base64, pending.mimetype, 'full');
        await publishStory(brand, { videoUrl });
        pendingMediaByChat.delete(chatId);
        return { success: true, message: 'Видео опубликовано в Stories.' };
      }

      // Reels: убираем родной звук и подбираем музыку (по запросу или трендовую)
      const audioResults = await searchAudio(brand, { audioType: 'music', searchQuery: music_query || undefined });
      const audioId = audioResults[0]?.id || null;

      const videoUrl = await uploadVideoAndGetPublicUrl(pending.base64, pending.mimetype, 'full', { muteAudio: true });
      const result = await publishReel(brand, { videoUrl, caption, audioId });
      pendingMediaByChat.delete(chatId);
      const musicNote = audioId ? '' : ' (не удалось подобрать музыку — Reels опубликован без звука)';
      return { success: true, message: `Reels опубликован: ${result.permalink}${musicNote}` };
    }

    // одиночное фото
    const imageUrl = await uploadImageAndGetPublicUrl(pending.base64, pending.mimetype, is_story ? 'full' : 'feed');
    if (is_story) {
      await publishStory(brand, { imageUrl });
      pendingMediaByChat.delete(chatId);
      return { success: true, message: 'Фото опубликовано в Stories.' };
    }
    const result = await publishPhoto(brand, { imageUrl, caption });
    pendingMediaByChat.delete(chatId);
    return { success: true, message: `Опубликовано: ${result.permalink}` };
  } catch (err) {
    console.error('Ошибка публикации:', err);
    return { success: false, message: `Ошибка публикации: ${err.message}` };
  }
}

function executeScheduleAction(brand, chatId, { caption, is_story, scheduled_time_minsk, music_query }) {
  const targetDate = new Date(scheduled_time_minsk);
  if (Number.isNaN(targetDate.getTime())) {
    return { success: false, message: 'Не удалось распознать дату/время. Нужен ISO 8601, например 2026-09-15T10:00:00+03:00.' };
  }

  const delayMs = targetDate.getTime() - Date.now();
  if (delayMs <= 0) {
    return { success: false, message: 'Указанное время уже в прошлом.' };
  }

  const pending = pendingMediaByChat.get(chatId);
  if (!pending) {
    return { success: false, message: 'Нет ожидающего фото или видео для планирования.' };
  }
  // Снимаем медиа с активного "слота", чтобы новое фото до срока публикации его не перезаписало
  pendingMediaByChat.delete(chatId);

  setTimeout(async () => {
    pendingMediaByChat.set(chatId, pending);
    const result = await executePublishAction(brand, chatId, { caption, is_story, music_query });
    if (notifier) {
      const text = result.success
        ? `✅ Запланированный пост опубликован!\n${result.message}`
        : `⚠️ Не удалось опубликовать запланированный пост: ${result.message}`;
      await notifier(chatId, text);
    }
  }, delayMs);

  return { success: true, message: `Запланировано на ${formatMinsk(targetDate)}` };
}

async function executeTool(brand, chatId, name, input) {
  switch (name) {
    case 'publish_post':
      return executePublishAction(brand, chatId, input);
    case 'schedule_post':
      return executeScheduleAction(brand, chatId, input);
    case 'get_instagram_stats':
      try {
        const account = await getAccountInsights(brand);
        const media = await getRecentMediaWithInsights(brand, 5);
        return { success: true, account, media };
      } catch (err) {
        return { success: false, message: err.message };
      }
    case 'remember_shop_fact':
      addShopFact(brand.id, input.fact);
      return { success: true, message: 'Факт сохранён.' };
    default:
      return { success: false, message: `Неизвестный инструмент: ${name}` };
  }
}

async function callClaude(system, messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      tools,
      messages
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Ошибка Claude API:', errText.slice(0, 800));
    throw new Error(`Claude API вернул статус ${response.status}`);
  }

  return response.json();
}

// Главная функция — вызывается для КАЖДОГО входящего сообщения (текст, фото, видео).
// userContentBlocks — массив content-блоков в формате Anthropic API (text/image).
async function handleIncomingMessage(brand, chatId, userContentBlocks) {
  let history = loadHistory(chatId);
  history.push({ role: 'user', content: userContentBlocks });

  let response = await callClaude(buildSystemPrompt(brand, chatId), history);

  const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
  let replyText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');

  history.push({ role: 'assistant', content: response.content });

  if (toolUseBlocks.length > 0) {
    const toolResultBlocks = [];
    for (const toolUse of toolUseBlocks) {
      // eslint-disable-next-line no-await-in-loop
      const result = await executeTool(brand, chatId, toolUse.name, toolUse.input);
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result)
      });
    }
    history.push({ role: 'user', content: toolResultBlocks });

    const followUp = await callClaude(buildSystemPrompt(brand, chatId), history);
    const followUpText = followUp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
    history.push({ role: 'assistant', content: followUp.content });
    replyText = followUpText || replyText || 'Готово.';
  }

  saveHistory(chatId, history);
  return replyText || '...';
}

module.exports = {
  handleIncomingMessage,
  setPendingPhoto,
  setPendingCarousel,
  setPendingVideo,
  setNotifier
};
