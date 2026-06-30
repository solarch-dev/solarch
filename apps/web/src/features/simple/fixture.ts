/** Phase 1 — hand-written messaging fixture (VISUAL concept proof ONLY).
 *
 *  In Phase 2 this is generated from the real CodeGraph via the pure `systemMap(graph)`
 *  function; components stay unchanged since they read the same `SystemMap` shape. This
 *  example mirrors the messaging backend mockup in the design proposal (Auth/Messaging/Notification).
 *
 *  Each feature has ONE consolidated flowchart: a single shared "Signed in?" gate +
 *  each operation as a leaf (no per-operation repetition, no Start/End). */

import type { SystemMap } from "./types";

export const messagingFixture: SystemMap = {
  shared: { items: ["Logging", "Configuration"] },
  arrows: [
    { from: "messaging", to: "authentication", label: "uses" },
    { from: "messaging", to: "notification", label: "triggers" },
  ],
  features: [
    {
      slug: "authentication",
      title: "Authentication",
      tier: 0,
      capabilityCount: 1,
      dataLabels: ["Users"],
      capabilities: [
        {
          actor: "Any user",
          action: "Creates an account",
          data: [{ access: "writes", label: "Users" }],
          hidden: 1,
        },
      ],
      // Public operation — no gate, standalone.
      flowGraph: {
        nodes: [{ id: "p0", kind: "process", label: "Creates an account" }],
        edges: [],
      },
    },
    {
      slug: "messaging",
      title: "Messaging",
      tier: 1,
      capabilityCount: 3,
      dataLabels: ["Messages", "Conversations"],
      capabilities: [
        {
          actor: "Signed-in user",
          action: "Sends a message",
          data: [{ access: "writes", label: "Messages" }],
          triggers: ["Notification"],
          hidden: 2,
        },
        {
          actor: "Signed-in user",
          action: "Views conversations",
          data: [{ access: "reads", label: "Conversations" }],
          hidden: 1,
        },
        {
          actor: "Signed-in user",
          action: "Views message history",
          data: [{ access: "reads", label: "Messages" }],
          hidden: 1,
        },
      ],
      // One shared sign-in gate; the three operations hang off it (no repetition).
      flowGraph: {
        nodes: [
          { id: "gate", kind: "decision", label: "Signed in?" },
          { id: "a0", kind: "process", label: "Sends a message" },
          { id: "a1", kind: "process", label: "Views conversations" },
          { id: "a2", kind: "process", label: "Views message history" },
        ],
        edges: [
          { from: "gate", to: "a0" },
          { from: "gate", to: "a1" },
          { from: "gate", to: "a2" },
        ],
      },
    },
    {
      slug: "notification",
      title: "Notification",
      tier: 2,
      capabilityCount: 1,
      dataLabels: [],
      external: ["SendGrid"],
      capabilities: [
        {
          actor: "System",
          action: "Sends a notification",
          data: [],
          external: ["SendGrid"],
          hidden: 1,
        },
      ],
      flowGraph: {
        nodes: [{ id: "p0", kind: "process", label: "Sends a notification" }],
        edges: [],
      },
    },
  ],
};
