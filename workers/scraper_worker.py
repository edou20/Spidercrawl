"""
Spidercrawl — Python Scraper Worker (Phase 3)
=============================================

A high-performance headless browser worker using Playwright, aiohttp, and stealth plugins.
Handles JavaScript-heavy pages, anti-bot bypass, and concurrent requests.

Features added in Phase 3:
- aiohttp for true asynchronous concurrency
- playwright-stealth to bypass Cloudflare/Akamai
- Persistent browser instance to optimize memory and startup time
- Proxy rotation support

Usage:
    python workers/scraper_worker.py
"""

import asyncio
import os
import time
import base64
from aiohttp import web
from typing import Optional

HAS_PLAYWRIGHT = False
_stealth_async = None

try:
    from playwright.async_api import async_playwright, Browser
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

if HAS_PLAYWRIGHT:
    try:
        # playwright-stealth <=1.x API
        from playwright_stealth import stealth_async as _stealth_async
    except ImportError:
        try:
            # playwright-stealth >=2.x API
            from playwright_stealth import Stealth
            _stealth_engine = Stealth()
            _stealth_async = _stealth_engine.apply_stealth_async
        except ImportError:
            _stealth_async = None

WORKER_PORT = 8400

# Maximum number of browser contexts allowed to run simultaneously.
# Each context consumes ~150–300 MB of RAM. Set lower on constrained hosts.
MAX_CONCURRENT_CONTEXTS = int(os.environ.get("PLAYWRIGHT_MAX_CONTEXTS", "4"))

# Global state for the persistent browser
_playwright_context = None
_browser: Browser = None
_semaphore: asyncio.Semaphore = None  # guards concurrent context creation

async def init_browser():
    """Initializes the persistent browser instance and concurrency semaphore."""
    global _playwright_context, _browser, _semaphore
    if not HAS_PLAYWRIGHT:
        return
    _semaphore = asyncio.Semaphore(MAX_CONCURRENT_CONTEXTS)
    print(f"🚀 Initializing Playwright browser (max {MAX_CONCURRENT_CONTEXTS} concurrent contexts)...")
    _playwright_context = await async_playwright().start()
    _browser = await _playwright_context.chromium.launch(
        headless=True,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--no-sandbox",
            "--disable-setuid-sandbox",
        ]
    )
    print("✅ Browser ready.")

async def close_browser():
    """Cleans up the browser instance."""
    global _playwright_context, _browser
    if _browser:
        await _browser.close()
    if _playwright_context:
        await _playwright_context.stop()
    print("🛑 Browser stopped.")

async def scrape_with_browser(url: str, wait_for: int = 2000, timeout: int = 30000, proxy_url: str = None) -> dict:
    """
    Renders a page using the persistent browser.
    Applies stealth scripts and handles proxies.
    Concurrency is capped by _semaphore (MAX_CONCURRENT_CONTEXTS) to prevent OOM.
    """
    if not HAS_PLAYWRIGHT or not _browser:
        raise RuntimeError("Playwright is not running.")

    # Acquire semaphore before creating a new context.
    # This prevents unbounded memory growth under parallel load.
    async with _semaphore:
        return await _do_scrape(url, wait_for, timeout, proxy_url)


async def _do_scrape(url: str, wait_for: int, timeout: int, proxy_url: Optional[str]) -> dict:
    """Internal scrape logic — called with semaphore already held."""
    start = time.time()

    # Create an isolated context for this scrape
    context_args = {
        "viewport": {"width": 1440, "height": 900},
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    }
    if proxy_url:
        context_args["proxy"] = {"server": proxy_url}

    context = await _browser.new_context(**context_args)
    page = await context.new_page()

    # Apply stealth when available (bypasses many bot-detection scripts)
    if _stealth_async is not None:
        await _stealth_async(page)

    try:
        await page.goto(url, wait_until="networkidle", timeout=timeout)

        # Extra wait for dynamic content (SPA hydration)
        if wait_for > 0:
            await page.wait_for_timeout(wait_for)

        # Auto-scroll to trigger lazy-loaded content (Phase 1 feature)
        await page.evaluate("""
            async () => {
                await new Promise(resolve => {
                    let totalHeight = 0;
                    const distance = 300;
                    const timer = setInterval(() => {
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= document.body.scrollHeight) {
                            clearInterval(timer);
                            window.scrollTo(0, 0);
                            resolve();
                        }
                    }, 100);
                });
            }
        """)

        html = await page.content()
        title = await page.title()

        # Capture screenshot
        screenshot_bytes = await page.screenshot(full_page=True, type="png")
        screenshot_b64 = base64.b64encode(screenshot_bytes).decode("utf-8")

        elapsed_ms = int((time.time() - start) * 1000)

        return {
            "url": url,
            "title": title,
            "html": html,
            "screenshot": screenshot_b64,
            "elapsedMs": elapsed_ms,
        }
    finally:
        await context.close()

# ─── HTTP Handlers ────────────────────────────────────────────────────────

async def handle_scrape(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    url = body.get("url")
    wait_for = body.get("waitFor", 2000)
    timeout = body.get("timeout", 30000)
    proxy_url = body.get("proxyUrl")

    if not url:
        return web.json_response({"error": "url is required"}, status=400)

    try:
        result = await scrape_with_browser(url, wait_for, timeout, proxy_url)
        return web.json_response(result)
    except Exception as e:
        print(f"Scrape error for {url}: {e}")
        return web.json_response({"error": str(e)}, status=500)

async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok",
        "service": "spidercrawl-worker",
        "playwright": HAS_PLAYWRIGHT,
        "browserReady": _browser is not None
    })

# ─── App Setup ────────────────────────────────────────────────────────────

async def init_app() -> web.Application:
    app = web.Application()
    app.router.add_post('/scrape', handle_scrape)
    app.router.add_get('/health', handle_health)
    
    # Manage browser lifecycle
    app.on_startup.append(lambda _: init_browser())
    app.on_cleanup.append(lambda _: close_browser())
    return app

def main():
    print(f"🕷️  Spidercrawl Worker (Phase 3) starting on port {WORKER_PORT}")
    app = asyncio.run(init_app())
    web.run_app(app, host="0.0.0.0", port=WORKER_PORT, print=None)

if __name__ == "__main__":
    main()
