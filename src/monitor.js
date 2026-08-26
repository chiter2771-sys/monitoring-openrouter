import { Store } from './store.js';
import {
  formatNewModel,
  formatNewFreeModel,
  formatBecameFree,
  sendMany,
} from './telegram.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_AFTER_DAYS = 30;

/**
 * Один цикл проверки.
 *
 * События:
 *  - NEW        — модель, которой не было в кэше (→ группа «новые»);
 *  - NEW_FREE   — новая модель, сразу бесплатная (→ обе группы);
 *  - BECAME_FREE — известная платная модель стала бесплатной (→ «бесплатные»).
 *
 * Первый запуск по пустому кэшу — baseline: кэш наполняется без рассылки.
 */
export async function runCheck({ getModels, logger = console, dryRun = false }) {
  const cacheDir = process.env.CACHE_DIR || 'cache';
  const maxPerGroup = Number(process.env.MAX_MESSAGES_PER_GROUP || 15);

  const store = new Store(cacheDir);
  store.load();

  const models = await getModels();
  const now = Date.now();

  const newModels = [];
  const newFreeModels = [];
  const becameFree = [];

  for (const model of models) {
    const known = store.get(model.id);

    if (!known) {
      newModels.push(model);
      if (model.free) newFreeModels.push(model);
      store.set(model.id, {
        firstSeen: now,
        lastSeen: now,
        free: model.free,
        prompt: model.prompt,
        completion: model.completion,
      });
      continue;
    }

    if (model.free && !known.free) {
      becameFree.push(model);
    }

    store.set(model.id, {
      ...known,
      lastSeen: now,
      free: model.free,
      prompt: model.prompt,
      completion: model.completion,
    });
  }

  store.prune(PRUNE_AFTER_DAYS * DAY_MS);
  store.save();

  const isBaseline = store.size === models.length && newModels.length === models.length;
  const results = { newModels, newFreeModels, becameFree, baseline: isBaseline, total: models.length };

  logger.info(
    `Каталог: ${models.length} моделей | новых: ${newModels.length} | из них бесплатных: ${newFreeModels.length} | стали бесплатными: ${becameFree.length}`
  );

  if (isBaseline) {
    logger.info('Первый запуск — baseline. Кэш заполнен, рассылка не выполняется.');
    return results;
  }

  if (dryRun) {
    const preview = [...newModels, ...becameFree];
    preview
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .slice(0, 10)
      .forEach((m) => logger.info(`  [DRY] ${m.id} — ${m.free ? 'бесплатная' : 'новая'}`));
    return results;
  }

  await notify(results, { maxPerGroup, logger });
  return results;
}

async function notify(results, { maxPerGroup, logger }) {
  const { newModels, newFreeModels, becameFree } = results;

  const newChat = process.env.TELEGRAM_NEW_MODELS_CHAT_ID;
  const freeChat = process.env.TELEGRAM_FREE_MODELS_CHAT_ID || newChat;

  const take = (arr, label) => {
    const limited = arr.slice(0, maxPerGroup);
    if (arr.length > maxPerGroup) {
      logger.warn(`  ⚠ ${label}: ${arr.length} событий, отправляю первые ${maxPerGroup}`);
    }
    return limited;
  };

  if (newChat && newModels.length) {
    const messages = take(newModels, 'Новые').map(formatNewModel);
    logger.info(`→ Группа «новые»: ${messages.length} сообщений`);
    await sendMany(newChat, messages, logger);
  }

  if (freeChat && (newFreeModels.length || becameFree.length)) {
    const messages = [
      ...take(newFreeModels, 'Новые бесплатные').map(formatNewFreeModel),
      ...becameFree.map(formatBecameFree),
    ];
    logger.info(`→ Группа «бесплатные»: ${messages.length} сообщений`);
    await sendMany(freeChat, messages, logger);
  }
}
