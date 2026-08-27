import 'dotenv/config';
import axios from 'axios';
import cron from 'node-cron';
import { getModels } from './openrouter.js';
import { runCheck } from './monitor.js';
import { handleCommand } from './commands.js';

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

/* ============================ Telegram Polling (DM commands) ============================ */

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
let pollOffset = 0;

async function pollOnce() {
  try {
    const { data } = await axios.get(`${TELEGRAM_API}/getUpdates`, {
      params: { offset: pollOffset, timeout: 10 },
      timeout: 15000,
    });

    if (!data.ok) return;

    for (const update of data.result) {
      pollOffset = update.update_id + 1;

      if (!update.message || !update.message.text) continue;
      if (update.message.chat.type !== 'private') continue; // только ЛС

      const chatId = update.message.chat.id;
      const text = update.message.text;

      // Тестовое сообщение (флаг --test)
      if (text === '/test') {
        const { sendMessage, formatNewModel, formatNewFreeModel } = await import('./telegram.js');
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
        continue;
      }

      // Обработка команд
      const response = await handleCommand(text, getModels);
      if (response) {
        const { sendMessage } = await import('./telegram.js');
        await sendMessage(chatId, response);
      }
    }
  } catch (err) {
    if (err.code === 'ECONNABORTED') return; // timeout — нормально
    logger.error(`Polling error: ${err.message}`);
  }
}

async function startPolling() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN не задан — polling ЛС не запущен');
    return;
  }

  logger.info('Telegram polling запущен (ЛС команды)...');

  // Первый вызов сбрасывает offset до последних обновлений
  try {
    const { data } = await axios.get(`${TELEGRAM_API}/getUpdates`, {
      params: { offset: pollOffset, timeout: 1 },
      timeout: 5000,
    });
    if (data.ok && data.result.length > 0) {
      pollOffset = data.result[data.result.length - 1].update_id + 1;
    }
  } catch { /* ignore */ }

  // Цикл опроса
  while (true) {
    await pollOnce();
    await sleep(1000);
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
    logger.warn('(задай TELEGRAM_BOT_TOKEN в .env, чтобы включить реальную отправку)');
  } else if (!process.env.TELEGRAM_NEW_MODELS_CHAT_ID) {
    logger.error('Не задан TELEGRAM_NEW_MODELS_CHAT_ID в .env — добавлять модели некуда.');
    process.exit(1);
  }

  // Тестовое сообщение
  if (test && !dryRun) {
    const chatId = process.env.TELEGRAM_NEW_MODELS_CHAT_ID;
    try {
      const { sendMessage, formatNewModel, formatNewFreeModel } = await import('./telegram.js');
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
      logger.info('Тестовые сообщения (реальный формат) отправлены!');
    } catch (err) {
      logger.error(`Не удалось отправить тестовые сообщения: ${err.message}`);
    }
    return;
  }

  // Запускаем polling бота для ЛС (фоновый)
  startPolling();

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
