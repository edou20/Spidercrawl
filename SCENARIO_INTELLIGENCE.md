# Scenario: Stealth Market Intelligence Engine

This scenario demonstrates how a professional uses Spidercrawl to gain a competitive advantage without manual labor.

## 👤 The Persona: Sarah, Product Strategy Lead
Sarah works at a SaaS company. Her goal is to ensure her product remains competitive in a fast-moving market.

## 🚩 The Problem
- **Competitors move fast**: They update pricing, landing page copy, and feature sets weekly.
- **Manual checks are slow**: It takes Sarah's intern 4 hours every Monday to check 10 competitor sites.
- **Anti-Scraping**: Competitors use sophisticated bot detection to block basic scraping tools.

## 🕷️ The Spidercrawl Solution

### 1. The "Goal-Oriented" Setup
Sarah sets up a recurring crawl in Spidercrawl with this natural language goal:
> *"Crawl the site. Identify the pricing page. Extract the 'Enterprise' plan features and the names of any new product integrations mentioned on the homepage."*

### 2. Intelligent Execution
- **Stealth Mode**: Spidercrawl uses residential proxies and Playwright's stealth plugin to look like a real browser, bypassing "Access Denied" screens.
- **Vision AI**: One competitor uses a graphic for their pricing table. Spidercrawl's vision model "sees" the image and transcribes the text perfectly.
- **Adaptive Budgeting**: The crawler identifies that the `/blog` and `/careers` folders aren't relevant to the goal and skips them entirely, saving compute time.

### 3. The "Work" it Produces
Every Monday, Sarah receives a structured JSON or CSV file (or a webhook alert) containing:
- **Pricing Delta**: "Enterprise plan increased from $499 to $550."
- **Feature Gap**: "Competitor A launched 'AI-Summary' integration. We don't have this yet."
- **Knowledge Graph**: A map showing which partners the competitor is working with based on logo extractions.

## 📈 The Value Created
- **Time Saved**: 4 hours/week $\rightarrow$ 0 hours.
- **Accuracy**: AI extraction doesn't "miss" a line in a table like a tired intern might.
- **Strategy**: Sarah can present a "Competitive Landscape" slide to her CEO every Tuesday morning with 100% confidence in the data.

---

### *Try this scenario yourself:*
```bash
# Run a targeted "Intelligence" crawl
node sdk/typescript/dist/cli.js crawl https://competitor-example.com \
  --goal "Find enterprise pricing and AI features" \
  --pages 10 \
  --apiKey YOUR_API_KEY
```
