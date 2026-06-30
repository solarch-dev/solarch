import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// Giriş üst sınırları — DoS + maliyet + prompt-injection yüzeyini daraltır.
export const MAX_MESSAGE_CHARS = 8000;
export const MAX_HISTORY_ITEMS = 50;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
}).strict();

export const ChatSchema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(ChatMessageSchema).max(MAX_HISTORY_ITEMS).default([]),
  tabId: z.string().uuid().optional(), // üretilen node'ların ev sekmesi
  /** agent: tool calling ile mimari üretir; instruct: sadece açıklama (text stream + [[node:ID|name]] markup). */
  mode: z.enum(["agent", "instruct"]).default("agent"),
  /** "Devam et": önceki üretim adım limitine (MAX_TURNS) takılıp duraklatıldı →
   *  agent mevcut grafı görüp eksikleri tamamlar, var olanı TEKRAR YARATMAZ. */
  continueRun: z.boolean().default(false),
}).strict();

export type ChatInput = z.infer<typeof ChatSchema>;

export class ChatDto extends createZodDto(ChatSchema) {}
