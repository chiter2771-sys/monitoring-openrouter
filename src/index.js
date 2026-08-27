import 'dotenv/config';
import axios from 'axios';
import cron from 'node-cron';
import { getModels } from './openrouter.js';
import { runCheck } from './monitor.js';
import { handleCommand } from './commands.js';
import { sendMessage, formatNewModel, formatNewFreeModel } from './telegram.js';

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
const test = args.includes('--test');
const dryRun = args.includes('--dry') || !process.env.TELEGRAM_BOT_TOKEN;

/* ============================ Telegram Polling ============================ */

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
let pollOffset = 0;
let pollRunning = false;

async function pollOnce() {
  if (pollRunning) return; // не запускать параллельно
  pollRunning = true;
  try {
    const { data } = await axios.get(`${TELEGRAM_API}/getUpdates`, {
      params: { offset: pollOffset, allowed_updates: ['message'] },
      timeout: 10000,
    });

    if (!data.ok) {
      logger.error(`getUpdates вернул не ok: ${JSON.stringify(data)}`);
      return;
    }

    for (const update of data.result) {
      pollOffset = update.update_id + 1;

      const msg = update.message;
      if (!msg || !msg.text) continue;
      if (msg.chat.type !== 'private') continue;

      logger.info(`DM от ${msg.from?.username || msg.from?.id}: ${msg.text}`);

      // Команда /test — отправляет примеры моделей
      if (msg.text === '/test') {
        await sendMessage(msg.chat.id, formatNewModel({
          id: 'anthropic/claude-sonnet-4',
          name: 'Anthropic: Claude Sonnet 4',
          provider: 'Anthropic',
          context: 200000,
          maxCompletion: 16384,
          modality: 'text->text',
          prompt: 0.003,
          completion: 0.015,
          free: false,
          created: Date.now() / 1000,
        }));
        await sendMessage(msg.chat.id, formatNewFreeModel({
          id: 'google/gemini-flash-2.0:free',
          name: 'Google: Gemini Flash 2.0 (Free)',
          provider: 'Google',
          context: 1048576,
          maxCompletion: 8192,
          modality: 'text->text',
          prompt: 0,
          completion: 0,
          free: true,
          created: Date.now() / 1000,
        }));
        continue;
      }

      // Обработка команд
      const response = await handleCommand(msg.text, getModels);
      if (response) {
        await sendMessage(msg.chat.id, response);
      }
    }
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    logger.error(`Polling error: ${status} ${JSON.stringify(body)} ${err.message}`);
    if (status === 409) {
      logger.warn('Конфликт (409). Ждём 5 сек...');
      await sleep(5000);
    } else if (status === 400) {
      // Возможно offset стал невалидным — сбрасываем
      logger.warn('Сбрасываю offset и продолжаю.');
      pollOffset = 0;
    }
  } finally {
    pollRunning = false;
  }
}

async function startPolling() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN не задан — polling ЛС не запущен');
    return;
  }
  logger.info('Telegram polling запущен (ЛС команды)...');

  // Удаляем webhook на всякий случай
  try {
    const r = await axios.get(`${TELEGRAM_API}/deleteWebhook`, { timeout: 5000 });
    logger.info(`deleteWebhook: ${r.data.description}`);
  } catch (e) {
    logger.warn(`deleteWebhook не удался: ${e.message}`);
  }

  while (true) {
    await pollOnce();
    await sleep(1500);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ============================ Check Logic ============================ */

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

/* ============================ Main ============================ */

async function main() {
  if (dryRun) {
    logger.warn('DRY-RUN: сообщения печатаются в консоль, в Telegram не отправляются');
  } else if (!process.env.TELEGRAM_NEW_MODELS_CHAT_ID) {
    logger.error('Не задан TELEGRAM_NEW_MODELS_CHAT_ID в .env — добавлять модели некуда.');
    process.exit(1);
  }

  if (test && !dryRun) {
    const chatId = process.env.TELEGRAM_NEW_MODELS_CHAT_ID;
    try {
      await sendMessage(chatId, formatNewModel({
        id: 'anthropic/claude-sonnet-4',
        name: 'Anthropic: Claude Sonnet 4',
        provider: 'Anthropic',
        context: 200000,
        maxCompletion: 16384,
        modality: 'text->text',
        prompt: 0.003,
        completion: 0.015,
        free: false,
        created: Date.now() / 1000,
      }));
      await sendMessage(chatId, formatNewFreeModel({
        id: 'google/gemini-flash-2.0:free',
        name: 'Google: Gemini Flash 2.0 (Free)',
        provider: 'Google',
        context: 1048576,
        maxCompletion: 8192,
        modality: 'text->text',
        prompt: 0,
        completion: 0,
        free: true,
        created: Date.now() / 1000,
      }));
      logger.info('Тестовые сообщения отправлены!');
    } catch (err) {
      logger.error(`Не удалось: ${err.message}`);
    }
    return;
  }

  // Polling только в режиме демона
  if (!once) startPolling();

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
