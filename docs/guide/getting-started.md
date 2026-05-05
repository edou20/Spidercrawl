# Getting Started

Spidercrawl is a production-grade web intelligence engine. This guide will help you get it running locally or via Docker.

## Installation

### Prerequisites
- Node.js 18+
- Redis (for job queuing)
- PostgreSQL (for persistence)
- Docker (optional, but recommended)

### Local Setup

1. **Clone and Install**
   ```bash
   git clone https://github.com/edou20/Spidercrawl.git
   cd Spidercrawl
   npm install
   npm run dashboard:install
   ```

2. **Environment Configuration**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to add your `OPENAI_API_KEY` or `GOOGLE_AI_API_KEY`.

3. **Start Services**
   ```bash
   docker compose up -d redis postgres
   ```

4. **Run the API**
   ```bash
   npm run dev
   ```

## Your First Scrape

Once the API is running, you can perform your first intelligent scrape:

```bash
curl -X POST http://localhost:3200/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "json"],
    "extractPrompt": "Extract the main title and any key highlights."
  }'
```

## Running with Docker

For the easiest experience, use the pre-configured Docker Compose stack:

```bash
docker compose up --build
```

This will start:
- **API** at `http://localhost:3200`
- **Dashboard** at `http://localhost:3200/app/`
- **Scraper Worker** (Playwright-backed)
- **Redis & Postgres**
