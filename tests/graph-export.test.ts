import { describe, expect, it } from "vitest";
import { buildKnowledgeGraphExport, knowledgeGraphToCytoscape, knowledgeGraphToGraphMl } from "../src/export/graph.js";
import type { Entity, JobStatus } from "../src/types/schemas.js";

const job: JobStatus = {
  id: "job_123",
  rootUrl: "https://example.com",
  status: "completed",
  progress: 100,
  totalPages: 2,
  completedPages: 2,
  maxDepth: 2,
  maxPages: 10,
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:01:00.000Z",
  results: [
    {
      url: "https://example.com",
      statusCode: 200,
      title: "Home & Docs",
      links: ["https://example.com/docs", "https://external.example"],
      metadata: { crawledAt: "2026-05-03T00:00:00.000Z", elapsedMs: 10 },
    },
    {
      url: "https://example.com/docs",
      statusCode: 200,
      title: "Docs",
      links: [],
      metadata: { crawledAt: "2026-05-03T00:00:01.000Z", elapsedMs: 10 },
    },
  ],
};

const entities: Entity[] = [{
  id: "ent_1",
  jobId: "job_123",
  name: "Spidercrawl",
  type: "Technology",
  aliases: [],
  sourceUrls: ["https://example.com/docs"],
  metadata: {},
  createdAt: "2026-05-03T00:00:00.000Z",
}];

describe("graph exports", () => {
  it("builds page, entity, and internal link edges", () => {
    const graph = buildKnowledgeGraphExport(job, entities);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "https://example.com",
        target: "https://example.com/docs",
        type: "links_to",
      }),
      expect.objectContaining({
        source: "https://example.com/docs",
        target: "entity:ent_1",
        type: "mentions",
      }),
    ]));
  });

  it("exports Cytoscape elements", () => {
    const cytoscape = knowledgeGraphToCytoscape(buildKnowledgeGraphExport(job, entities));

    expect(cytoscape.elements.nodes[0]?.data.id).toBe("https://example.com");
    expect(cytoscape.elements.edges[0]?.data.type).toBe("links_to");
  });

  it("exports valid GraphML with escaped node labels", () => {
    const graphml = knowledgeGraphToGraphMl(buildKnowledgeGraphExport(job, entities));

    expect(graphml).toContain("<graphml");
    expect(graphml).toContain('<node id="n0">');
    expect(graphml).toContain('<edge id="e0" source="n0" target="n1">');
    expect(graphml).toContain("Home &amp; Docs");
    expect(graphml).toContain('edgedefault="directed"');
  });
});
