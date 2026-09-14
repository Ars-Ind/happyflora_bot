const { Telegraf } = require('telegraf');
const { getBrandById } = require('./brands');
const { handleIncomingMessage, setPendingPhoto, setPendingCarousel, setPendingVideo, setNotifier } = require('./claude');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

function isAuthorized(userId) {
  const allowed = (process.env.ALLOWED_TELEGRAM_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(String(userId));
}

// Неавторизованных пользователей тихо игнорируем — не раскрываем, что бот вообще что-то делает
bot.use(async (ctx, next) => {
  if (ctx.from && isAuthorized(ctx.from.id)) {
    return next();
  }
});

async function downloadFileAsBase64(fileId) {
  const link = await bot.telegram.getFileLink(fileId);
  const url = typeof link === 'string' ? link : link.href;
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

// Буферизация фото, приходящих группой (альбомом) — Telegram присылает их как
// отдельные сообщения с общим media_group_id, нужно собрать их в одну карусель.
const mediaGroupBuffers = new Map();

function bufferPhoto(mediaGroupId, chatId, item, caption) {
  if (!mediaGroupBuffers.has(mediaGroupId)) {
    mediaGroupBuffers.set(mediaGroupId, { items: [], caption: '', chatId, timer: null });
  }
  const buf = mediaGroupBuffers.get(mediaGroupId);
  buf.items.push(item);
  if (caption) buf.caption = caption;
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => {
    mediaGroupBuffers.delete(mediaGroupId);
    processPhotos(buf.chatId, buf.items, buf.caption).catch((err) => {
      console.error('Ошибка обработки альбома фото:', err);
    });
  }, 1200);
}

async function processPhotos(chatId, images, captionText) {
  const brand = getBrandById('happyflora');

  if (images.length > 1) {
    setPendingCarousel(chatId, images);
  } else {
    setPendingPhoto(chatId, images[0].base64, images[0].mimetype);
  }

  const contentBlocks = images.slice(0, 5).map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mimetype, data: img.base64 }
  }));
  contentBlocks.push({
    type: 'text',
    text: captionText || (images.length > 1 ? 'Вот карусель фото для поста.' : 'Вот фото для поста.')
  });

  await bot.telegram.sendChatAction(chatId, 'typing');
  try {
    const reply = await handleIncomingMessage(brand, chatId, contentBlocks);
    await bot.telegram.sendMessage(chatId, reply);
  } catch (err) {
    console.error('Ошибка обработки фото:', err);
    await bot.telegram.sendMessage(chatId, 'Не получилось обработать фото, попробуй ещё раз 🙏');
  }
}

bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  const photoSizes = ctx.message.photo;
  const largest = photoSizes[photoSizes.length - 1];
  const caption = ctx.message.caption || '';

  try {
    const base64 = await downloadFileAsBase64(largest.file_id);
    const item = { base64, mimetype: 'image/jpeg' };

    if (ctx.message.media_group_id) {
      bufferPhoto(ctx.message.media_group_id, chatId, item, caption);
    } else {
      await processPhotos(chatId, [item], caption);
    }
  } catch (err) {
    console.error('Ошибка скачивания фото из Telegram:', err);
    await ctx.reply('Не получилось скачать фото, попробуй ещё раз 🙏');
  }
});

bot.on('video', async (ctx) => {
  const chatId = ctx.chat.id;
  const video = ctx.message.video;
  const caption = ctx.message.caption || '';
  const brand = getBrandById('happyflora');

  await ctx.sendChatAction('typing');

  try {
    const base64 = await downloadFileAsBase64(video.file_id);
    const mimetype = video.mime_type || 'video/mp4';
    setPendingVideo(chatId, base64, mimetype);

    const contentBlocks = [{
      type: 'text',
      text: caption
        ? `Пользователь прислал видео для Reels. Его описание/подпись к видео: "${caption}"`
        : 'Пользователь прислал видео для Reels, но не описал, что на нём. Уточни у него, что происходит в видео, прежде чем предлагать подпись.'
    }];

    const reply = await handleIncomingMessage(brand, chatId, contentBlocks);
    await ctx.reply(reply);
  } catch (err) {
    console.error('Ошибка обработки видео:', err);
    await ctx.reply('Не получилось обработать видео, попробуй ещё раз 🙏');
  }
});

bot.command('start', async (ctx) => {
  await ctx.reply('Привет! Я помогу вести Instagram HappyFlora — просто присылай фото, видео или пиши, что нужно 🌸');
});

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const chatId = ctx.chat.id;
  const brand = getBrandById('happyflora');

  await ctx.sendChatAction('typing');

  try {
    const contentBlocks = [{ type: 'text', text: ctx.message.text }];
    const reply = await handleIncomingMessage(brand, chatId, contentBlocks);
    await ctx.reply(reply);
  } catch (err) {
    console.error('Ошибка обработки текстового сообщения:', err);
    await ctx.reply('Что-то пошло не так, попробуй ещё раз 🙏');
  }
});

setNotifier(async (chatId, text) => {
  await bot.telegram.sendMessage(chatId, text);
});

async function startBot() {
  await bot.launch();
  console.log('⚡️ Telegram-бот запущен и слушает сообщения!');
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { startBot };
