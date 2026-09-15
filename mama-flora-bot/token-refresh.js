const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ENV_PATH = path.join(__dirname, '.env');

const REFRESH_EVERY_MS = 45 * 24 * 60 * 60 * 1000; // обновляем раз в 45 дней (токен живёт 60)
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // проверяем раз в сутки, не пришло ли время обновиться

function stateFilePath(brandId) {
  return path.join(DATA_DIR, `token-refresh-${brandId}.json`);
}

function loadState(brandId) {
  const filePath = stateFilePath(brandId);
  if (!fs.existsSync(filePath)) return { lastRefreshedAt: null };
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { lastRefreshedAt: null };
  }
}

function saveState(brandId, state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(stateFilePath(brandId), JSON.stringify(state, null, 2), 'utf8');
}

function updateEnvFile(envVarName, newValue) {
  if (!fs.existsSync(ENV_PATH)) return;
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const lineRegex = new RegExp(`^${envVarName}=.*$`, 'm');
  let updated;
  if (lineRegex.test(content)) {
    updated = content.replace(lineRegex, `${envVarName}=${newValue}`);
  } else {
    updated = `${content.trimEnd()}\n${envVarName}=${newValue}\n`;
  }
  fs.writeFileSync(ENV_PATH, updated, 'utf8');
}

async function refreshToken(brand) {
  const envVarName = brand.instagram.accessTokenEnvVar;
  const currentToken = process.env[envVarName];
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!currentToken || !appId || !appSecret) {
    throw new Error('Не хватает META_APP_ID / META_APP_SECRET / текущего токена для обновления');
  }

  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: currentToken
  });

  const response = await fetch(`https://graph.facebook.com/v26.0/oauth/access_token?${params.toString()}`);
  const data = await response.json();

  if (data.error || !data.access_token) {
    throw new Error(data.error?.message || 'Meta не вернул новый токен');
  }

  process.env[envVarName] = data.access_token;
  updateEnvFile(envVarName, data.access_token);

  return data.access_token;
}

function startTokenAutoRefresh(brand, notifyAllFn) {
  const state = loadState(brand.id);
  if (!state.lastRefreshedAt) {
    // Первый запуск после установки — считаем точкой отсчёта "сейчас",
    // раз токен уже был вручную обновлён при настройке бота.
    state.lastRefreshedAt = new Date().toISOString();
    saveState(brand.id, state);
  }

  async function checkAndRefreshIfDue() {
    const elapsedMs = Date.now() - new Date(state.lastRefreshedAt).getTime();
    if (elapsedMs < REFRESH_EVERY_MS) return;

    try {
      await refreshToken(brand);
      state.lastRefreshedAt = new Date().toISOString();
      saveState(brand.id, state);
      console.log(`Токен Instagram для "${brand.displayName}" успешно автообновлён.`);
      if (notifyAllFn) {
        await notifyAllFn(`🔑 Токен доступа к Instagram (${brand.displayName}) автоматически продлён ещё на 60 дней. Ничего делать не нужно.`);
      }
    } catch (err) {
      console.error('Не удалось автоматически обновить токен Instagram:', err);
      if (notifyAllFn) {
        await notifyAllFn(`⚠️ Не получилось автоматически продлить токен Instagram (${brand.displayName}): ${err.message}. Нужно обновить вручную, иначе публикация скоро перестанет работать.`);
      }
    }
  }

  // Проверяем сразу при запуске (на случай, если бот долго не работал), и затем раз в сутки
  checkAndRefreshIfDue();
  setInterval(checkAndRefreshIfDue, CHECK_INTERVAL_MS);
}

module.exports = { startTokenAutoRefresh };
