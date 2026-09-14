require('dotenv').config();
const { startBot } = require('./telegram-bot');

startBot().catch((err) => {
  console.error('Не удалось запустить бота:', err);
  process.exit(1);
});
