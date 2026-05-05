# API Reference

Spidercrawl provides a RESTful API for all its intelligence operations. All endpoints return a standard JSON response.

## Base URL
`http://localhost:3200/v1`

## Authentication
If `REQUIRE_API_KEY=true` is set, provide your key in the header:
`Authorization: Bearer sk-sc-...`

## Endpoints

### POST `/scrape`
Scrape a single URL into multiple formats.

**Payload:**
| Field | Type | Description |
| --- | --- | --- |
| `url` | string | Target URL |
| `formats` | array | `markdown`, `html`, `json`, `screenshot` |
| `useBrowser` | boolean | Force Playwright rendering |
| `extractSchema`| object | JSON Schema for data extraction |

### POST `/crawl`
Start an asynchronous crawl job.

**Payload:**
| Field | Type | Description |
| --- | --- | --- |
| `url` | string | Entry point URL |
| `maxDepth` | number | Maximum crawl depth |
| `maxPages` | number | Stop after N pages |
| `goal` | string | Natural language crawl goal |

### GET `/crawl/:id`
Check the status and statistics of a crawl job.

### POST `/map`
Generate a site topology map without full content scraping.
