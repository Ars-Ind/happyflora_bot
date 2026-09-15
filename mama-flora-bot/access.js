const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_PATH = path.join(DATA_DIR, 'allowed-users.json');
const INVITES_PATH = path.join(DATA_DIR, 'invites.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAllowedUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_PATH)) {
    // Первый запуск — сидируем список из старой переменной ALLOWED_TELEGRAM_USER_IDS в .env,
    // чтобы никто не потерял доступ при переходе на этот механизм.
    const seed = (process.env.ALLOWED_TELEGRAM_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => ({ id, name: null, addedAt: new Date().toISOString() }));
    fs.writeFileSync(USERS_PATH, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveAllowedUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf8');
}

function isAuthorized(userId) {
  return loadAllowedUsers().some((u) => String(u.id) === String(userId));
}

function addAuthorizedUser(userId, name) {
  const users = loadAllowedUsers();
  if (users.some((u) => String(u.id) === String(userId))) return;
  users.push({ id: String(userId), name: name || null, addedAt: new Date().toISOString() });
  saveAllowedUsers(users);
}

function removeAuthorizedUser(userId) {
  const users = loadAllowedUsers().filter((u) => String(u.id) !== String(userId));
  saveAllowedUsers(users);
}

function listAuthorizedUsers() {
  return loadAllowedUsers();
}

// --- Одноразовые пригласительные ссылки (живут 24 часа) ---

function loadInvites() {
  ensureDataDir();
  if (!fs.existsSync(INVITES_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(INVITES_PATH, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveInvites(invites) {
  ensureDataDir();
  fs.writeFileSync(INVITES_PATH, JSON.stringify(invites, null, 2), 'utf8');
}

function createInvite(createdByUserId) {
  const code = Math.random().toString(36).slice(2, 10);
  const invites = loadInvites();
  invites.push({
    code,
    createdBy: String(createdByUserId),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    usedBy: null
  });
  saveInvites(invites);
  return code;
}

function redeemInvite(code, userId, userName) {
  const invites = loadInvites();
  const invite = invites.find((i) => i.code === code);
  if (!invite) return { success: false, reason: 'not_found' };
  if (invite.usedBy) return { success: false, reason: 'used' };
  if (new Date(invite.expiresAt).getTime() < Date.now()) return { success: false, reason: 'expired' };

  invite.usedBy = String(userId);
  invite.usedAt = new Date().toISOString();
  saveInvites(invites);

  addAuthorizedUser(userId, userName);
  return { success: true };
}

module.exports = {
  isAuthorized,
  addAuthorizedUser,
  removeAuthorizedUser,
  listAuthorizedUsers,
  createInvite,
  redeemInvite
};
