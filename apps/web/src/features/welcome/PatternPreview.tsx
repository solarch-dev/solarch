/** PatternPreview — a tidy, deterministic mini-diagram of a pattern's graph.
 *  Nodes are bucketed into architecture layers (Client → Access → Business →
 *  Infra → Data) as columns, coloured by node family, with thin edges between
 *  them. No layout engine — column-by-layer keeps it always-tidy and renders the
 *  same every time. */

import { useMemo } from "react";
import { familyOf, colorOfFamily } from "../../canvas/families";
import type { PatternGraph } from "../../api/patterns";

/** Node family → column (left-to-right request flow). */
const FAMILY_LAYER: Record<string, number> = {
  client: 0,
  security: 0,
  access: 1,
  business: 2,
  structure: 2,
  configuration: 2,
  infrastructure: 3,
  data: 4,
};

const ABBR: Record<string, string> = {
  Controller: "Ctrl", APIGateway: "Gw", MessageQueue: "MQ",
  Service: "Svc", Worker: "Wrk", EventHandler: "Evt", Orchestrator: "Orch",
  Repository: "Repo", Cache: "Cache", ExternalService: "Ext",
  Table: "Tbl", DTO: "DTO", Enum: "Enum", Model: "Model", View: "View",
  FrontendApp: "App", UIComponent: "UI",
  Middleware: "Mw", Exception: "Exc", EnvironmentVariable: "Env",
  Module: "Mod",
};

const NODE_W = 46;
const NODE_H = 16;
const COL_GAP = 78;
const ROW_GAP = 26;
const PAD = 8;

interface Placed {
  tempId: string;
  abbr: string;
  color: string;
  x: number; // top-left
  y: number;
}

export function PatternPreview({ graph }: { graph: PatternGraph }) {
  const { placed, edges, width, height } = useMemo(() => {
    // 1. Bucket nodes into columns by family layer.
    const byCol = new Map<number, typeof graph.nodes>();
    for (const n of graph.nodes) {
      const col = FAMILY_LAYER[familyOf(n.type)] ?? 2;
      const arr = byCol.get(col) ?? [];
      arr.push(n);
      byCol.set(col, arr);
    }
    const usedCols = [...byCol.keys()].sort((a, b) => a - b);
    const maxRows = Math.max(1, ...usedCols.map((c) => byCol.get(c)!.length));

    // 2. Place each node; shorter columns are vertically centred.
    const pos = new Map<string, Placed>();
    usedCols.forEach((col, ci) => {
      const nodes = byCol.get(col)!;
      const startY = PAD + ((maxRows - nodes.length) * ROW_GAP) / 2;
      nodes.forEach((n, ri) => {
        const color = colorOfFamily(familyOf(n.type));
        pos.set(n.tempId, {
          tempId: n.tempId,
          abbr: ABBR[n.type] ?? n.type.slice(0, 4),
          color,
          x: PAD + ci * COL_GAP,
          y: startY + ri * ROW_GAP,
        });
      });
    });

    // 3. Edges — anchored at box BOUNDARIES (not centres) and curved through the
    //    column gaps, so a line never cuts through a node box.
    const e = graph.edges
      .map((ed) => {
        const a = pos.get(ed.sourceTempId);
        const b = pos.get(ed.targetTempId);
        if (!a || !b) return null;
        const ay = a.y + NODE_H / 2;
        const by = b.y + NODE_H / 2;
        if (b.x > a.x) {
          // forward (left → right): right edge of a → left edge of b
          const sx = a.x + NODE_W, tx = b.x;
          const dx = Math.max(10, (tx - sx) * 0.5);
          return { d: `M ${sx} ${ay} C ${sx + dx} ${ay} ${tx - dx} ${by} ${tx} ${by}` };
        }
        if (b.x < a.x) {
          // backward: left edge of a → right edge of b
          const sx = a.x, tx = b.x + NODE_W;
          const dx = Math.max(10, (sx - tx) * 0.5);
          return { d: `M ${sx} ${ay} C ${sx - dx} ${ay} ${tx + dx} ${by} ${tx} ${by}` };
        }
        // same column → bow out to the right so it skirts the stacked nodes
        const sx = a.x + NODE_W, tx = b.x + NODE_W, bow = 16;
        return { d: `M ${sx} ${ay} C ${sx + bow} ${ay} ${tx + bow} ${by} ${tx} ${by}` };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const width = PAD * 2 + Math.max(0, usedCols.length - 1) * COL_GAP + NODE_W;
    const height = PAD * 2 + Math.max(0, maxRows - 1) * ROW_GAP + NODE_H;
    return { placed: [...pos.values()], edges: e, width, height };
  }, [graph]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label="Architecture preview"
    >
      {edges.map((ed, i) => (
        <path
          key={i}
          d={ed.d}
          fill="none"
          stroke="var(--hairline-strong, rgba(15,15,14,0.22))"
          strokeWidth={1}
        />
      ))}
      {placed.map((n) => (
        <g key={n.tempId}>
          <rect
            x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={4}
            fill={`${n.color}1f`} stroke={n.color} strokeWidth={1}
          />
          <text
            x={n.x + NODE_W / 2} y={n.y + NODE_H / 2 + 2.5}
            textAnchor="middle" fontSize={7.5} fontWeight={600} fill={n.color}
          >
            {n.abbr}
          </text>
        </g>
      ))}
    </svg>
  );
}
