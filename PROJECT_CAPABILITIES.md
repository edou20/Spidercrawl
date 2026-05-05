# Spidercrawl Project Capabilities & Audit Report

This document identifies the current capabilities of Spidercrawl and provides a strategic audit for future direction, focusing on stabilizing and enhancing existing features rather than adding new ones.

---

## 🕷️ What Spidercrawl Can Do Today

Spidercrawl is a comprehensive, AI-native web intelligence platform. Its capabilities are divided into four main pillars:

### 1. Intelligent Data Ingestion
- **Multi-Tier Scraping**: Automatically selects the most efficient engine:
  - **Cheerio**: Fast, lightweight HTML parsing for static pages.
  - **Playwright Worker**: Full browser rendering for JS-heavy or protected sites.
  - **Stealth Integration**: Built-in mechanisms to bypass bot detection (Cloudflare, Akamai).
- **High-Fidelity Markdown**: Converts complex HTML into clean, LLM-ready Markdown, preserving tables, code blocks, and semantic structure.
- **Vision-Augmented Extraction**: Uses Vision LLMs to describe significant images and incorporate descriptions into the text.
- **Standalone Extraction**: A dedicated `/v1/extract` endpoint for ad-hoc structured data extraction from any URL or raw content.

### 2. Goal-Oriented Orchestration
- **Smart Crawling**: Uses AI to score and prioritize discovered links based on a natural language goal (e.g., "Find all product specifications").
- **Adaptive Budgeting**: Automatically stops crawling once the defined goal is "satisfied," saving tokens and time.
- **URL Deduplication**: Persistent visited-URL tracking ensures jobs can survive restarts without re-crawling.
- **Change Detection**: Computes content hashes to perform incremental crawls, only processing pages that have changed since the last run.

### 3. Knowledge Transformation & Storage
- **Structured Extraction**: Extracts complex JSON data from every page using user-defined schemas or natural language prompts.
- **Knowledge Graph Generation**: Resolves entities (Organizations, People, Products) across different pages and maps their relationships.
- **Hybrid Storage**:
  - **Redis**: Fast job queuing and real-time status caching.
  - **PostgreSQL**: Durable persistence for all crawl data and metadata.
  - **pgvector**: Vector embeddings storage for semantic retrieval.

### 4. Developer & Enterprise Experience
- **Semantic Search**: Job-scoped and cross-job search using hybrid (keyword + vector) ranking.
- **RAG-Ready Q&A**: "Ask a question" feature that synthesizes answers from crawled data with source citations.
- **Automated Scheduling**: Cron-based recurring crawls with history tracking.
- **Webhooks & Events**: Signed HMAC webhooks and real-time SSE event streaming for integration.
- **Multi-Format Export**: CSV, JSON, JSONL (NDJSON), JSON-LD (Knowledge Graph), GraphML, Cytoscape, and OpenAI-style Fine-tuning JSONL.
- **Ecosystem Tools**: Official TypeScript/Python SDKs, a CLI tool, and an MCP Server for native AI assistant integration.

---

## 🔍 Serious Audit: Current State & Fix Direction

To give the project a "fixed direction" as requested, we should focus on the following stabilization and refinement areas:

### 1. API Consistency & Normalization (Highest Priority)
- **Problem**: Some endpoints return snake_case (from DB) while others return camelCase. Some status fields are inconsistent between Redis cache and DB records.
- **Fix**: Implement a strict serialization layer that ensures all v1 API responses are normalized to camelCase and adhere to a unified schema.

### 2. Robust Real-time Monitoring
- **Problem**: The SSE stream is "stateless." If a dashboard user refreshes during a crawl, they lose the event history.
- **Fix**: Modify the SSE endpoint to "replay" the last N events from the `crawl_events` table before piping new live events.

### 3. Extraction Reliability & Fallbacks
- **Problem**: If an LLM extraction fails or returns a "hallucination," the job continues but the data is lost.
- **Fix**: Implement a "Self-Healing" retry logic that falls back to a different model (e.g., Gemini to GPT-4o) or a "deep inspect" mode (Playwright + larger context) on extraction failure.

### 4. Advanced Entity Resolution
- **Problem**: Entity resolution is currently a post-crawl batch job. It's opaque and hard to debug if matches are incorrect.
- **Fix**: Move to an incremental entity resolution process. Add a "Confidence Score" to relationships in the Knowledge Graph and allow manual "merge/split" actions in the dashboard.

### 5. RAG Retrieval Quality
- **Problem**: Cross-job search is currently keyword-based (`ILIKE`). Job-scoped search is vector-based but doesn't use re-ranking.
- **Fix**: Implement full hybrid search (keyword + vector) for all search endpoints. Add a secondary re-ranking step using a Cross-Encoder to ensure the top-3 results are highly relevant.

### 6. Dashboard Polish
- **Problem**: The dashboard is feature-rich but can feel "heavy." Error reporting for worker failures is often buried in logs.
- **Fix**: Surface worker health and "last error" snippets directly in the Job Detail view. Add a "Re-run Extraction" button to existing jobs to allow schema adjustments without re-crawling.

---

## 🎯 The "Fix Direction" Summary
**Stop building new features.** Instead, transform Spidercrawl into the most *reliable* and *accurate* engine in its class. Success should be measured by **Extraction Accuracy** and **System Stability** under load, not by the number of supported formats or integrations.
