# Real‑World Usage Example for Spidercrawl

## 1️⃣ Start a Crawl Job (CLI)
```bash
# Install the CLI (if not already installed)
npm i -g @spidercrawl/cli

# Launch a new crawl with a natural‑language goal
spidercrawl crawl \
  --url https://example.com/products \
  --goal "Extract all product specifications and prices" \
  --output jsonl
```

The command spins up a managed job that:
- **Ingests** pages using Cheerio for static content and falls back to Playwright when JavaScript is required.
- **Applies** the goal‑aware scoring model to prioritize product pages.
- **Stores** results in PostgreSQL + pgvector for downstream semantic search.

## 2️⃣ Monitor Progress (SSE Event Stream)
```bash
# Open a live event stream (optional for debugging)
spidercrawl events --job-id <JOB_ID>
```
Or via HTTP:
```http
GET /v1/jobs/<JOB_ID>/events
Accept: text/event-stream
```

You’ll see events like:
```
event: crawl_started
 data: {"jobId":"abc123","timestamp":...}

event: page_crawled
 data: {"url":"https://example.com/product/42","score":0.93}

event: extraction_completed
 data: {"url":"...","extracted":{...}}
```

## 3️⃣ Retrieve Structured Results (REST API)
```http
GET /v1/jobs/<JOB_ID>/results?format=jsonl
Authorization: Bearer <API_KEY>
```
Response (truncated):
```json
{ "url": "https://example.com/product/42", "metadata": {"title":"SuperWidget"}, "content": {"specs": {"weight":"1kg","color":"red"}, "price":"$19.99"} }
```

## 4️⃣ Ask a RAG Question (SDK Example – Python)
```python
from spidercrawl import SpidercrawlClient

client = SpidercrawlClient(api_key="YOUR_API_KEY")

answer = client.ask(
    job_id="<JOB_ID>",
    question="What is the price of the SuperWidget?",
    top_k=5,
)
print(answer)
```
Output:
```
The SuperWidget is priced at $19.99. (Source: https://example.com/product/42)
```

## 5️⃣ Export Knowledge Graph (JSON‑LD)
```http
GET /v1/jobs/<JOB_ID>/knowledge-graph?format=jsonld
Authorization: Bearer <API_KEY>
```
You can load the exported graph into Neo4j, GraphDB, or a vector store for advanced analytics.

---

These steps demonstrate a typical end‑to‑end workflow: **launch → monitor → retrieve → query → export**. Adjust the `--goal` and output format to fit your own use‑case, such as building a product catalogue, summarising legal documents, or feeding data into a downstream LLM.
