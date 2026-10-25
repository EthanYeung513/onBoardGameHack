// GEXF 1.3 export of the brain graph for offline Gephi review (PRD "Brain API", F18).
// Pure: takes the `brain.graph` payload, returns the XML document.

export type GexfNode = { id: string; label: string; x: number; y: number; size: number; color: string; cluster: string; type: string };
export type GexfEdge = { source: string; target: string; relation: string };

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** Escape for XML text and attribute values; drops characters XML 1.0 forbids. */
export function xmlEscape(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/[&<>"']/g, (c) => ESC[c]);
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x8a8a94;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const num = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "0");

export function toGexf(graph: { nodes: GexfNode[]; edges: GexfEdge[] }, meta: { title: string; date?: Date }): string {
  const date = (meta.date ?? new Date()).toISOString().slice(0, 10);
  const a = xmlEscape;
  const nodes = graph.nodes.map((n) => {
    const [r, g, b] = rgb(n.color);
    return [
      `      <node id="${a(n.id)}" label="${a(n.label)}">`,
      `        <attvalues>`,
      `          <attvalue for="cluster" value="${a(n.cluster)}"/>`,
      `          <attvalue for="type" value="${a(n.type)}"/>`,
      `          <attvalue for="size" value="${num(n.size)}"/>`,
      `        </attvalues>`,
      `        <viz:color r="${r}" g="${g}" b="${b}"/>`,
      // Gephi's y axis points up; the brain layout's points down.
      `        <viz:position x="${num(n.x * 1000)}" y="${num(-n.y * 1000)}" z="0"/>`,
      `        <viz:size value="${num(4 + Math.sqrt(n.size) * 3)}"/>`,
      `      </node>`,
    ].join("\n");
  });
  const edges = graph.edges.map(
    (e, i) =>
      `      <edge id="e${i}" source="${a(e.source)}" target="${a(e.target)}" label="${a(e.relation)}">\n` +
      `        <attvalues><attvalue for="relation" value="${a(e.relation)}"/></attvalues>\n` +
      `      </edge>`,
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gexf xmlns="http://gexf.net/1.3" xmlns:viz="http://gexf.net/1.3/viz" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://gexf.net/1.3 http://gexf.net/1.3/gexf.xsd" version="1.3">`,
    `  <meta lastmodifieddate="${date}">`,
    `    <creator>Orthogonal</creator>`,
    `    <description>${a(meta.title)}</description>`,
    `  </meta>`,
    `  <graph mode="static" defaultedgetype="directed">`,
    `    <attributes class="node">`,
    `      <attribute id="cluster" title="cluster" type="string"/>`,
    `      <attribute id="type" title="type" type="string"/>`,
    `      <attribute id="size" title="size" type="float"/>`,
    `    </attributes>`,
    `    <attributes class="edge">`,
    `      <attribute id="relation" title="relation" type="string"/>`,
    `    </attributes>`,
    `    <nodes>`,
    ...nodes,
    `    </nodes>`,
    `    <edges>`,
    ...edges,
    `    </edges>`,
    `  </graph>`,
    `</gexf>`,
    ``,
  ].join("\n");
}
