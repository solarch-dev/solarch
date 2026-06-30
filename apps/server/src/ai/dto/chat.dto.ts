import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// Input upper bounds — narrows DoS + cost + prompt-injection surface.
export const MAX_MESSAGE_CHARS = 8000;
export const MAX_HISTORY_ITEMS = 50;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
}).strict();

export const ChatSchema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(ChatMessageSchema).max(MAX_HISTORY_ITEMS).default([]),
  tabId: z.string().uuid().optional(), // home tab for generated nodes
  /** agent: produces architecture via tool calling; instruct: explanation only (text stream + [[node:ID|name]] markup). */
  mode: z.enum(["agent", "instruct"]).default("agent"),
  /** "Continue": previous run paused at step limit (MAX_TURNS) →
   *  agent sees current graph and fills gaps, does NOT recreate existing nodes. */
  continueRun: z.boolean().default(false),
}).strict();

export type ChatInput = z.infer<typeof ChatSchema>;

export class ChatDto extends createZodDto(ChatSchema) {}
