import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ApiKeysRepository, type StoredApiKey } from "./api-keys.repository";

export const API_KEY_PREFIX = "slk_";
const MAX_KEYS_PER_USER = 10;
/** lastUsedAt'i her istekte değil, en erken 5 dakikada bir güncelle (yazma gürültüsü). */
const TOUCH_INTERVAL_MS = 5 * 60_000;

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

@Injectable()
export class ApiKeysService {
  /** keyId → son touch zamanı (process-içi; çok instance'ta en kötü durumda birkaç fazla yazma). */
  private readonly lastTouch = new Map<string, number>();

  constructor(private readonly repo: ApiKeysRepository) {}

  /** Yeni anahtar üret — düz anahtar YALNIZ bu yanıtla döner, bir daha gösterilmez. */
  async create(userId: string, name: string): Promise<{ key: string; record: StoredApiKey }> {
    const existing = await this.repo.listByUser(userId);
    if (existing.length >= MAX_KEYS_PER_USER) {
      throw new BadRequestException({
        code: "ERR_API_KEY_LIMIT",
        message: `You can create at most ${MAX_KEYS_PER_USER} API keys. Delete unused ones.`,
      });
    }

    const rawKey = `${API_KEY_PREFIX}${randomBytes(24).toString("hex")}`; // slk_ + 48 hex
    const record: StoredApiKey = {
      id: randomUUID(),
      userId,
      name: name.trim() || "unnamed",
      prefix: rawKey.slice(0, API_KEY_PREFIX.length + 6),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    await this.repo.create({ ...record, hash: hashKey(rawKey) });
    return { key: rawKey, record };
  }

  list(userId: string): Promise<StoredApiKey[]> {
    return this.repo.listByUser(userId);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    return this.repo.deleteOwned(id, userId);
  }

  /** Bearer slk_... doğrulaması — geçerliyse anahtar sahibinin kimliği döner. */
  async verify(rawKey: string): Promise<{ userId: string } | null> {
    if (!rawKey.startsWith(API_KEY_PREFIX)) return null;
    const found = await this.repo.findByHash(hashKey(rawKey));
    if (!found) return null;

    const last = this.lastTouch.get(found.id) ?? 0;
    if (Date.now() - last > TOUCH_INTERVAL_MS) {
      this.lastTouch.set(found.id, Date.now());
      void this.repo.touchLastUsed(found.id).catch(() => undefined);
    }
    return { userId: found.userId };
  }
}
