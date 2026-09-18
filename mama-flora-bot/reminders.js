const { loadActivity, markReminderSent } = require('./memory');

const REMIND_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // напоминаем, если тишина 2+ дня
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // проверяем каждые 6 часов

function startInactivityReminders(brand, notifyAllFn) {
  async function checkAndRemindIfDue() {
    const activity = loadActivity(brand.id);
    const now = Date.now();

    // Точка отсчёта — либо последний пост, либо последнее напоминание (что позже),
    // чтобы напоминания повторялись раз в 2 дня, а не только один раз.
    const lastPostMs = activity.lastPostAt ? new Date(activity.lastPostAt).getTime() : null;
    const lastReminderMs = activity.lastReminderAt ? new Date(activity.lastReminderAt).getTime() : null;
    const baseline = Math.max(lastPostMs || 0, lastReminderMs || 0);

    // Если вообще ещё не было ни одного поста и бот только что запущен — не спамим сразу
    if (!lastPostMs && !lastReminderMs) {
      markReminderSent(brand.id); // используем как точку отсчёта "бот запущен"
      return;
    }

    if (now - baseline >= REMIND_AFTER_MS) {
      const daysSince = Math.floor((now - (lastPostMs || baseline)) / (24 * 60 * 60 * 1000));
      markReminderSent(brand.id);
      if (notifyAllFn) {
        await notifyAllFn(`🌸 Давно не публиковали в Instagram HappyFlora (${daysSince} дн.) — есть что выложить?`);
      }
    }
  }

  checkAndRemindIfDue();
  setInterval(checkAndRemindIfDue, CHECK_INTERVAL_MS);
}

module.exports = { startInactivityReminders };
