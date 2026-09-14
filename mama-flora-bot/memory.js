const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function shopFactsPath(brandId) {
  return path.join(DATA_DIR, `shop-facts-${brandId}.json`);
}

function historyPath(chatId) {
  return path.join(DATA_DIR, `history-${chatId}.json`);
}

// --- Долгосрочные факты о магазине (новый адрес, акции и т.д.) ---
// Хранятся отдельно от истории разговора и переживают перезапуск бота и любые сессии.

function getShopFacts(brandId) {
  const filePath = shopFactsPath(brandId);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error('Не удалось прочитать факты о магазине:', err);
    return [];
  }
}

function addShopFact(brandId, fact) {
  const facts = getShopFacts(brandId);
  facts.push({ fact, addedAt: new Date().toISOString() });
  fs.writeFileSync(shopFactsPath(brandId), JSON.stringify(facts, null, 2), 'utf8');
}

// --- История разговора (по каждому чату отдельно) ---
// Переживает перезапуск бота (pm2 restart), чтобы не терять контекст.

function loadHistory(chatId) {
  const filePath = historyPath(chatId);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error('Не удалось прочитать историю разговора:', err);
    return [];
  }
}

function saveHistory(chatId, history) {
  // Ограничиваем размер истории, чтобы не раздувать запросы к Claude бесконечно
  const MAX_MESSAGES = 40;
  const trimmed = history.length > MAX_MESSAGES ? history.slice(history.length - MAX_MESSAGES) : history;
  fs.writeFileSync(historyPath(chatId), JSON.stringify(trimmed, null, 2), 'utf8');
  return trimmed;
}

module.exports = {
  getShopFacts,
  addShopFact,
  loadHistory,
  saveHistory
};
