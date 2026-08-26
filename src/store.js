import fs from 'node:fs';
import path from 'node:path';

/**
 * JSON-кэш известных моделей: что уже видели, о чём уже сообщили.
 * Хранит id -> метаданные и флаги уведомлений.
 */
export class Store {
  constructor(cacheDir) {
    this.file = path.join(cacheDir, 'models.json');
    this.models = new Map();
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.models = new Map(Object.entries(parsed.models || {}));
    } catch {
      this.models = new Map();
    }
    this.loaded = true;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const payload = { models: Object.fromEntries(this.models) };
    fs.writeFileSync(this.file, JSON.stringify(payload, null, 2), 'utf8');
  }

  get(id) {
    return this.models.get(id);
  }

  set(id, entry) {
    this.models.set(id, entry);
  }

  get size() {
    return this.models.size;
  }

  /** Удалить записи, которые не встречались в каталоге дольше maxAgeMs. */
  prune(maxAgeMs) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, entry] of this.models) {
      if ((entry.lastSeen || 0) < cutoff) this.models.delete(id);
    }
  }
}
