import axios from 'axios';

const BASE = 'https://openrouter.ai/api/v1';

/**
 * Приводит сырую модель OpenRouter к единому виду.
 * Цены — USD за один токен (строки), храним как числа.
 */
export function normalizeModel(raw) {
  const displayName = raw.name || raw.id;
  const provider =
    displayName.includes(':')
      ? displayName.split(':')[0].trim()
      : (raw.id || '').split('/')[0] || 'unknown';

  const prompt = parseFloat(raw.pricing?.prompt) || 0;
  const completion = parseFloat(raw.pricing?.completion) || 0;

  return {
    id: raw.id,
    name: displayName,
    provider,
    context: raw.context_length || raw.top_provider?.context_length || 0,
    maxCompletion: raw.top_provider?.max_completion_tokens || null,
    modality: raw.architecture?.modality || null,
    prompt,
    completion,
    free: prompt === 0 && completion === 0,
    created: raw.created || null,
  };
}

/**
 * Список всех моделей каталога в нормализованном виде.
 * Публичный эндпоинт — ключ не обязателен, но с ним лимиты щедрее.
 */
export async function getModels() {
  const headers = {};
  if (process.env.OPENROUTER_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  }

  const { data } = await axios.get(`${BASE}/models`, {
    headers,
    timeout: 20000,
  });

  const list = Array.isArray(data) ? data : data.data || [];
  return list.map(normalizeModel);
}
