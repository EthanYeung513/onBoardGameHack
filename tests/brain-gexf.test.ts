// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { toGexf, xmlEscape } from "@/lib/brain/gexf";

describe("GEXF export", () => {
  const graph = {
    nodes: [
      { id: "a", label: `R&D <"core"> 'team'`, x: 0.3, y: 0.3, size: 4, color: "#5b8cff", cluster: "People", type: "org_unit" },
      { id: "b", label: "Slack\u0001", x: 0.7, y: 0.7, size: 0, color: "#34c98e", cluster: "Docs & History", type: "tool" },
    ],
    edges: [{ source: "a", target: "b", relation: "uses" }],
  };

  it("is well-formed GEXF 1.3 with node and edge attributes, escaped", () => {
    const xml = toGexf(graph, { title: "Acme & Co brain", date: new Date("2026-10-25T00:00:00Z") });
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.namespaceURI).toBe("http://gexf.net/1.3");
    expect(root.getAttribute("version")).toBe("1.3");
    const nodes = doc.getElementsByTagName("node");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].getAttribute("label")).toBe(`R&D <"core"> 'team'`);
    expect(nodes[1].getAttribute("label")).toBe("Slack");
    const values = (el: Element) =>
      Object.fromEntries([...el.getElementsByTagName("attvalue")].map((v) => [v.getAttribute("for"), v.getAttribute("value")]));
    expect(values(nodes[1])).toEqual({ cluster: "Docs & History", type: "tool", size: "0" });
    const edge = doc.getElementsByTagName("edge")[0];
    expect([edge.getAttribute("source"), edge.getAttribute("target"), values(edge).relation]).toEqual(["a", "b", "uses"]);
    expect(doc.getElementsByTagName("description")[0].textContent).toBe("Acme & Co brain");
  });

  it("escapes every XML special character", () => {
    expect(xmlEscape(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });
});
