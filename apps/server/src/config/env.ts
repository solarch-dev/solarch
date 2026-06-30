import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // Bind address. Default 127.0.0.1 (single-box: only the local reverse proxy reaches
  // the backend). In Docker each service is its own container, so the proxy container
  // cannot reach loopback — set HOST=0.0.0.0 there (the port is not published to the host).
  HOST: z.string().default("127.0.0.1"),
  NEO4J_URI: z.string().url(),
  NEO4J_USER: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  // Connection pool / timeout — yük altında "connection not available"a karşı.
  // Tek-kutu launch için makul; gerekirse artır.
  NEO4J_MAX_POOL_SIZE: z.coerce.number().int().positive().default(50),
  NEO4J_CONNECTION_ACQUISITION_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  NEO4J_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  NEO4J_MAX_TX_RETRY_TIME_MS: z.coerce.number().int().positive().default(30_000),
  NEO4J_MAX_CONNECTION_LIFETIME_MS: z.coerce.number().int().positive().default(3_600_000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // ── Auth (Clerk) ──
  // default("") → boot/test parse'ı kırılmasın; boşsa uygulama kimlik doğrulayamaz
  // (main.ts başlangıçta uyarır). Üretimde gerçek anahtarlar zorunludur.
  CLERK_SECRET_KEY: z.string().default(""),
  CLERK_PUBLISHABLE_KEY: z.string().default(""),
  // Virgülle ayrılmış izinli origin listesi (CSRF koruması — clerkMiddleware authorizedParties)
  CLERK_AUTHORIZED_PARTIES: z.string().optional(),

  // ── Guest mode (login'siz 1 projelik deneme) ──
  // Misafir biletlerini imzalayan HMAC sırrı (openssl rand -hex 32). Boşsa misafir
  // modu KAPALI: POST /auth/guest 503 döner, X-Guest-Token doğrulanmaz.
  GUEST_TOKEN_SECRET: z.string().default(""),

  // ── Billing (Polar — Merchant of Record) ── default("") → boşken boot kırılmaz; runtime'da gerekir
  POLAR_ACCESS_TOKEN: z.string().default(""),
  POLAR_WEBHOOK_SECRET: z.string().default(""),
  POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
  POLAR_PRODUCT_DRAW: z.string().default(""),
  POLAR_PRODUCT_BUILD: z.string().default(""),
  POLAR_PRODUCT_CODE: z.string().default(""),

  // ── AI agent (Phase 3B) — opsiyonel; key yoksa /ai/chat 503 döner ──
  // generation → mimari üretim + tool calling (Bedrock/Claude)
  // chat → genel diyalog (DeepSeek)
  // generation default = deepseek: Kimi K2.5 (bedrock) büyük tool-call çıktısında
  // aralıklı JSON bozulması yaşıyordu; DeepSeek v4-pro (thinking:disabled) güvenilir.
  LLM_GENERATION_PROVIDER: z.enum(["bedrock", "deepseek"]).default("deepseek"),
  LLM_CHAT_PROVIDER: z.enum(["bedrock", "deepseek"]).default("deepseek"),
  // Bedrock — bedrock-mantle (OpenAI-uyumlu) endpoint + long-term bearer API key
  // (AWS Kimi K2.5 için bedrock-mantle öneriyor; native Converse IAM-yetkisizdi)
  BEDROCK_API_KEY: z.string().optional(),
  BEDROCK_BASE_URL: z.string().url().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  BEDROCK_MODEL: z.string().default("moonshotai.kimi-k2.5"),
  // DeepSeek
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com/v1"),
  // Legacy default — yeni kod DEEPSEEK_MODEL_AGENT / DEEPSEEK_MODEL_INSTRUCT kullanır.
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-flash"),
  // Agent mode (mimari üretimi, tool calling) — v4-pro reasoning tier.
  // Mimari kararlar verirken kapasitesi yüksek model gerek.
  DEEPSEEK_MODEL_AGENT: z.string().default("deepseek-v4-pro"),
  // Instruct mode (sohbet, açıklama) — v4-flash hızlı tier.
  // TTFT 300-500ms, sohbet anlık görünüm için ideal.
  DEEPSEEK_MODEL_INSTRUCT: z.string().default("deepseek-v4-flash"),

  // Agent loop tur tavanı (1 tur = 1 LLM çağrısı; bir tur ÇOKLU tool call dönebilir).
  // Tavan dolunca üretim DURMAZ-ÖLMEZ: 'paused' event + kullanıcı "Devam et" ile
  // kaldığı yerden sürer (agent mevcut grafı görür, tekrar yaratmaz). 120 = makul
  // tek-seferlik adım; büyük mimari birkaç "Devam et" ile tamamlanır.
  AI_MAX_TURNS: z.coerce.number().int().positive().default(120),

  // ── Embeddings (Phase 4 GraphRAG) ──
  // bedrock-mantle embedding modeli sunmuyor (sadece chat LLM'ler) → lokal default.
  // local = @xenova/transformers (ONNX, offline, CPU). bedrock = ileride embed
  // modeli gelirse OpenAIEmbeddings ile (kod hazır, env ile geçilir).
  EMBED_PROVIDER: z.enum(["local", "bedrock"]).default("local"),
  // Çok dilli (Türkçe dahil 50+ dil), 384 dim — Türkçe-öncelikli ürün için
  // all-MiniLM-L6-v2'den (ağırlıklı İngilizce) daha isabetli. Aynı boyut → index değişmez.
  EMBED_MODEL: z.string().default("Xenova/paraphrase-multilingual-MiniLM-L12-v2"),
  EMBED_DIM: z.coerce.number().int().positive().default(384),
  EMBED_TOP_K: z.coerce.number().int().positive().default(3),
  EMBED_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.7),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return EnvSchema.parse(source);
}

export const env = parseEnv(process.env);
