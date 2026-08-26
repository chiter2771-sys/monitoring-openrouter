import axios from 'axios';

const SEND_DELAY_MS = 1200;

/**
 * Отправить HTML-сообщение в чат Telegram.
 */
export async function sendMessage(chatId, html) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN не задан в .env');
  if (!chatId) throw new Error('Не задан ID чата для отправки');

  const { data } = await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    },
    { timeout: 15000 }
  );

  if (!data.ok) throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
  return data;
}

/**
 * Отправить несколько сообщений с паузой между ними (антиспам Telegram).
 */
export async function sendMany(chatId, htmlMessages, logger = console) {
  let sent = 0;
  for (const html of htmlMessages) {
    try {
      await sendMessage(chatId, html);
      sent++;
    } catch (err) {
      const status = err.response?.status;
      const description = err.response?.data?.description || err.message;
      logger.error(`  ✗ Telegram [${chatId}]: ${status ?? ''} ${description}`);
      if (status === 429) {
        const retryAfter = (err.response.data?.parameters?.retry_after || 3) * 1000;
        await sleep(retryAfter);
        try {
          await sendMessage(chatId, html);
          sent++;
        } catch (retryErr) {
          logger.error(`  ✗ повтор после 429 не удался: ${retryErr.message}`);
        }
      }
    }
    await sleep(SEND_DELAY_MS);
  }
  return sent;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ============================ Форматирование ============================ */

function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtContext(n) {
  if (!n) return '—';
  return `${n.toLocaleString('ru-RU')} ток.`;
}

/** Цена за 1M токенов; у OpenRouter цены указаны за один токен. */
function fmtPrice(model) {
  if (model.free) return '🎁 Бесплатно';
  const inP = model.prompt * 1e6;
  const outP = model.completion * 1e6;
  const fmt = (v) =>
    `$${v.toLocaleString('en-US', { maximumFractionDigits: v >= 1 ? 2 : 4 })}`;
  return `${fmt(inP)} / 1M вх · ${fmt(outP)} / 1M вых`;
}

function fmtDate(unixSeconds) {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleDateString('ru-RU');
}

function modelLink(id) {
  return `https://openrouter.ai/${id.replace(/:free$/, '')}`;
}

function modelBlock(model) {
  const lines = [
    `<b>${esc(model.name)}</b>`,
    `🏭 Провайдер: ${esc(model.provider)}`,
    `🔧 ID: <code>${esc(model.id)}</code>`,
    `📏 Контекст: ${fmtContext(model.context)}`,
    model.maxCompletion ? `📤 Макс. ответ: ${model.maxCompletion.toLocaleString('ru-RU')} ток.` : null,
    model.modality ? `🧩 Модальность: ${esc(model.modality)}` : null,
    `💵 Цена: ${fmtPrice(model)}`,
    `📅 В каталоге с: ${fmtDate(model.created)}`,
    `🔗 ${modelLink(model.id)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatNewModel(model) {
  return `🆕 <b>Новая модель в каталоге OpenRouter</b>\n\n${modelBlock(model)}`;
}

export function formatNewFreeModel(model) {
  return `🆓 <b>Новая бесплатная модель</b>\n\n${modelBlock(model)}`;
}

export function formatBecameFree(model) {
  return `💰➡️🆓 <b>Модель стала бесплатной</b>\n\n${modelBlock(model)}`;
}
