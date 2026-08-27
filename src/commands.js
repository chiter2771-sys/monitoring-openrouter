/**
 * Обработчик команд Telegram-бота в ЛС.
 * Возвращает HTML-строку для отправки или null если команда не наша.
 */

export const COMMANDS = [
  { cmd: '/start',  desc: 'Приветствие и список команд' },
  { cmd: '/free',   desc: 'Список бесплатных моделей' },
  { cmd: '/paid',   desc: 'Список платных моделей' },
  { cmd: '/all',    desc: 'Список всех моделей' },
  { cmd: '/search', desc: 'Поиск: /search <название>' },
];

export async function handleCommand(text, getModels) {
  const trimmed = text.trim();

  if (trimmed === '/start')  return cmdStart();
  if (trimmed === '/free')   return cmdFree(getModels);
  if (trimmed === '/paid')   return cmdPaid(getModels);
  if (trimmed === '/all')    return cmdAll(getModels);

  if (trimmed === '/search') return '🔍 Использование: /search <название>

Пример: /search claude';
  const searchMatch = trimmed.match(/^\/search\s+(.+)$/);
  if (searchMatch) return cmdSearch(searchMatch[1], getModels);

  return null;
}

function cmdStart() {
  const lines = [
    '🤖 <b>OpenRouter Model Bot</b>',
    '',
    'Доступные команды:',
    ...COMMANDS.map(c => `  ${esc(c.cmd)} — ${esc(c.desc)}`),
    '',
    'Примеры:',
    '  /free — показать бесплатные модели',
    '  /search claude — найти модель',
  ];
  return lines.join('\n');
}

async function cmdFree(getModels) {
  const models = (await getModels()).filter(m => m.free);
  return formatList(models, '🆓 Бесплатные модели', models.length);
}

async function cmdPaid(getModels) {
  const models = (await getModels()).filter(m => !m.free);
  return formatList(models, '💰 Платные модели', models.length);
}

async function cmdAll(getModels) {
  const models = await getModels();
  return formatList(models, '📋 Все модели', models.length);
}

async function cmdSearch(query, getModels) {
  const models = (await getModels()).filter(m =>
    m.name.toLowerCase().includes(query.toLowerCase()) ||
    m.provider.toLowerCase().includes(query.toLowerCase()) ||
    m.id.toLowerCase().includes(query.toLowerCase())
  );
  if (models.length === 0) {
    return `😕 Ничего не найдено по запросу "<b>${esc(query)}</b>"`;
  }
  return formatList(models, `🔍 Результаты по "${esc(query)}" (${models.length})`, models.length);
}

function formatList(models, title, total) {
  const PAGE_SIZE = 10;
  const limited = models.slice(0, PAGE_SIZE);
  const lines = [title];

  if (total > PAGE_SIZE) {
    lines.push(`(показано ${PAGE_SIZE} из ${total})`);
  }

  lines.push('');

  for (const m of limited) {
    const price = m.free ? '🎁 бесплатно' : fmtPrice(m);
    lines.push(
      `<b>${esc(m.name)}</b>`,
      `🏭 ${esc(m.provider)}`,
      `📏 ${m.context.toLocaleString('ru-RU')} ток.`,
      `💵 ${price}`,
      `🔗 ${modelLink(m.id)}`,
      ''
    );
  }

  return lines.join('\n');
}

function fmtPrice(model) {
  const inP = model.prompt * 1e6;
  const outP = model.completion * 1e6;
  const fmt = (v) => `$${v.toLocaleString('en-US', { maximumFractionDigits: v >= 1 ? 2 : 4 })}`;
  return `${fmt(inP)} / 1M вх · ${fmt(outP)} / 1M вых`;
}

function modelLink(id) {
  return `https://openrouter.ai/${id.replace(/:free$/, '')}`;
}

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
