import 'dotenv/config';
import cron from 'node-cron';
import { getModels } from './openrouter.js';
import { runCheck } from './monitor.js';

const logger = {
  info: (...a) => console.log(`[${ts()}]`, ...a),
  warn: (...a) => console.warn(`[${ts()}] WARN`, ...a),
  error: (...a) => console.error(`[${ts()}] ERROR`, ...a),
};

function ts() {
  return new Date().toLocaleString('ru-RU');
}

const args = process.argv.slice(2);
const once = args.includes('--once');
const dryRun = args.includes('--dry') || !process.env.TELEGRAM_BOT_TOKEN;

async function check(label) {
  logger.info(`--- Проверка ${label} ---`);
  try {
    await runCheck({ getModels, logger, dryRun });
  } catch (err) {
    const detail = err.response ? `${err.response.status} ${err.response.statusText}` : err.message;
    logger.error(`Проверка не удалась: ${detail}`);
    if (!once) return;
    process.exitCode = 1;
  }
}

async function main() {
  if (dryRun) {
    logger.warn('DRY-RUN: сообщения печатаются в консоль, в Telegram не отправляются');
    logger.warn('(задай TELEGRAM_BOT_TOKEN в .env, чтобы включить реальную отправку)');
  } else if (!process.env.TELEGRAM_NEW_MODELS_CHAT_ID) {
    logger.error('Не задан TELEGRAM_NEW_MODELS_CHAT_ID в .env — добавлять модели некуда.');
    process.exit(1);
  }

  await check('при запуске');

  if (once) return;

  const schedule = process.env.CRON_SCHEDULE || '*/30 * * * *';
  if (!cron.validate(schedule)) {
    logger.error(`Некорректный CRON_SCHEDULE: "${schedule}"`);
    process.exit(1);
  }
  cron.schedule(schedule, () => check(`по расписанию "${schedule}"`));
  logger.info(`Демон запущен, расписание: "${schedule}". Ctrl+C — остановить.`);
}

main();
