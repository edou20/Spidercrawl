import type { Entity, JobStatus } from "../types/schemas.js";

export interface GraphNode {
  id: string;
  label: string;
  type: "page" | "entity";
  url?: string;
  entityType?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: "links_to" | "mentions";
  confidence?: number;
  provenance?: string;
}

export interface KnowledgeGraphExport {
  jobId: string;
  rootUrl: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function entityNodeId(id: string): string {
  return `entity:${id}`;
}

export function buildKnowledgeGraphExport(job: JobStatus, entities: Entity[] = []): KnowledgeGraphExport {
  const pageUrls = new Set(job.results.map((page) => page.url));
  const nodes: GraphNode[] = job.results.map((page) => ({
    id: page.url,
    label: page.title || page.url,
    type: "page",
    url: page.url,
  }));

  const edges: GraphEdge[] = [];
  job.results.forEach((page) => {
    page.links
      .filter((link) => pageUrls.has(link))
      .forEach((link, index) => {
        edges.push({
          id: `page:${page.url}->${link}:${index}`,
          source: page.url,
          target: link,
          type: "links_to",
        });
      });
  });

  entities.forEach((entity) => {
    const nodeId = entityNodeId(entity.id);
    nodes.push({
      id: nodeId,
      label: entity.name,
      type: "entity",
      entityType: entity.type,
    });

    entity.sourceUrls
      .filter((url) => pageUrls.has(url))
      .forEach((url, index) => {
        edges.push({
          id: `mention:${url}->${nodeId}:${index}`,
          source: url,
          target: nodeId,
          type: "mentions",
          confidence: typeof (entity.metadata as any)?.confidence === "number" ? (entity.metadata as any).confidence : undefined,
          provenance: Array.isArray((entity.metadata as any)?.provenance)
            ? JSON.stringify((entity.metadata as any).provenance)
            : undefined,
        });
      });
  });

  return {
    jobId: job.id,
    rootUrl: job.rootUrl,
    nodes,
    edges,
  };
}

export function knowledgeGraphToCytoscape(graph: KnowledgeGraphExport) {
  return {
    jobId: graph.jobId,
    rootUrl: graph.rootUrl,
    elements: {
      nodes: graph.nodes.map((node) => ({ data: node })),
      edges: graph.edges.map((edge) => ({ data: edge })),
    },
  };
}

export function knowledgeGraphToGraphMl(graph: KnowledgeGraphExport): string {
  const nodeIdByOriginalId = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));

  const nodes = graph.nodes.map((node) => [
    `    <node id="${nodeIdByOriginalId.get(node.id)}">`,
    `      <data key="originalId">${escapeXml(node.id)}</data>`,
    `      <data key="label">${escapeXml(node.label)}</data>`,
    `      <data key="type">${escapeXml(node.type)}</data>`,
    node.url ? `      <data key="url">${escapeXml(node.url)}</data>` : undefined,
    node.entityType ? `      <data key="entityType">${escapeXml(node.entityType)}</data>` : undefined,
    "    </node>",
  ].filter(Boolean).join("\n"));

  const edges = graph.edges.map((edge, index) => [
    `    <edge id="e${index}" source="${nodeIdByOriginalId.get(edge.source)}" target="${nodeIdByOriginalId.get(edge.target)}">`,
    `      <data key="originalId">${escapeXml(edge.id)}</data>`,
    `      <data key="type">${escapeXml(edge.type)}</data>`,
    typeof edge.confidence === "number" ? `      <data key="confidence">${edge.confidence}</data>` : undefined,
    edge.provenance ? `      <data key="provenance">${escapeXml(edge.provenance)}</data>` : undefined,
    "    </edge>",
  ].filter(Boolean).join("\n"));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="originalId" for="all" attr.name="originalId" attr.type="string" />',
    '  <key id="label" for="node" attr.name="label" attr.type="string" />',
    '  <key id="type" for="all" attr.name="type" attr.type="string" />',
    '  <key id="confidence" for="edge" attr.name="confidence" attr.type="double" />',
    '  <key id="provenance" for="edge" attr.name="provenance" attr.type="string" />',
    '  <key id="url" for="node" attr.name="url" attr.type="string" />',
    '  <key id="entityType" for="node" attr.name="entityType" attr.type="string" />',
    `  <graph id="${escapeXml(graph.jobId)}" edgedefault="directed">`,
    ...nodes,
    ...edges,
    "  </graph>",
    "</graphml>",
  ].join("\n");
}
