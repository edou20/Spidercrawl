import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Settings, Key, Plus, Trash2, Copy, CheckCheck, Code2, Terminal, Globe, Zap, Eye, EyeOff, AlertTriangle, Bell, Share2, Bot, Wrench, CreditCard, TrendingUp } from "lucide-react";
import { listApiKeys, createApiKey, revokeApiKey, ApiKey, listWebhooks, createWebhook, deleteWebhook, WebhookRow, CreatedWebhookRow, getOrgBilling, startCheckout, getBillingPortalUrl, OrgBilling } from "../api";
import { resolveApiBaseUrl } from "../api-base";

const API_BASE = resolveApiBaseUrl(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3200",
  import.meta.env.VITE_BACKEND_URL
);

const CODE_SNIPPETS: Record<"curl" | "python" | "agent", (key: string) => string> = {
  curl: (key: string) => `# Scrape a single page
curl -X POST ${API_BASE}/v1/scrape \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com","formats":["markdown"]}'

# Start a crawl job
curl -X POST ${API_BASE}/v1/crawl \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://docs.example.com","maxDepth":3,"maxPages":100,"goal":"Find all API docs"}'

# List your crawl jobs
curl ${API_BASE}/v1/jobs \\
  -H "Authorization: Bearer ${key}"`,

  python: (key: string) => `import httpx

client = httpx.Client(
    base_url="${API_BASE}",
    headers={"Authorization": f"Bearer ${key}"},
    timeout=60,
)

# Scrape a page
resp = client.post("/v1/scrape", json={
    "url": "https://example.com",
    "formats": ["markdown"],
})
data = resp.json()["data"]
print(data["markdown"])

# Start a crawl
resp = client.post("/v1/crawl", json={
    "url": "https://docs.example.com",
    "maxDepth": 3,
    "maxPages": 100,
    "goal": "Extract all API documentation",
})
job_id = resp.json()["data"]["id"]

# Poll for completion
import time
while True:
    status = client.get(f"/v1/crawl/{job_id}").json()["data"]
    print(f"Progress: {status['progress']}%")
    if status["status"] in ("completed", "failed"):
        break
    time.sleep(2)

# Search the crawled content
results = client.post(f"/v1/export/rag/{job_id}/search", json={
    "query": "authentication API",
    "limit": 5,
}).json()["data"]
for r in results:
    print(f"{r['title']} ({r['similarity']*100:.0f}%) — {r['url']}")`,

  agent: (key: string) => `// Hermes / LangChain / any agent integration
// Use Spidercrawl as a tool to fetch and search web content

const SPIDERCRAWL_KEY = "${key}";
const BASE = "${API_BASE}";

async function spiderScrape(url: string): Promise<string> {
  const res = await fetch(\`\${BASE}/v1/scrape\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${SPIDERCRAWL_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });
  const { data } = await res.json();
  return data.markdown;
}

async function spiderCrawlAndSearch(url: string, query: string): Promise<any[]> {
  // 1. Start a crawl
  const crawlRes = await fetch(\`\${BASE}/v1/crawl\`, {
    method: "POST",
    headers: { "Authorization": \`Bearer \${SPIDERCRAWL_KEY}\`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, maxDepth: 2, maxPages: 50, goal: query }),
  });
  const crawlPayload = await crawlRes.json();
  const id = crawlPayload.data.id;

  // 2. Poll until done
  while (true) {
    const s = await (await fetch(\`\${BASE}/v1/crawl/\${id}\`, {
      headers: { "Authorization": \`Bearer \${SPIDERCRAWL_KEY}\` },
    })).json();
    if (s.data.status === "completed") break;
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3. Semantic search over results
  const searchRes = await fetch(\`\${BASE}/v1/export/rag/\${id}/search\`, {
    method: "POST",
    headers: { "Authorization": \`Bearer \${SPIDERCRAWL_KEY}\`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 5 }),
  });
  return (await searchRes.json()).data;
}

// Register as agent tool
const tools = [
  {
    name: "web_scrape",
    description: "Scrape a URL and return clean markdown content",
    execute: ({ url }: { url: string }) => spiderScrape(url),
  },
  {
    name: "web_crawl_search",
    description: "Crawl a website and semantically search its content",
    execute: ({ url, query }: { url: string; query: string }) => spiderCrawlAndSearch(url, query),
  },
];`,
};

export default function SettingsPage() {
  const location = useLocation();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<ApiKey | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);
  const [tab, setTab] = useState<"keys" | "integration" | "webhooks" | "mcp" | "billing">("keys");
  const [billing, setBilling] = useState<OrgBilling | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [lang, setLang] = useState<"curl" | "python" | "agent">("agent");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [newWebhook, setNewWebhook] = useState<CreatedWebhookRow | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvent, setWebhookEvent] = useState("job.completed");

  const demoKey = newKey?.key ?? (keys[0] ? `sk-sc-${"•".repeat(36)}` : "YOUR_API_KEY");
  const snippet = CODE_SNIPPETS[lang](demoKey);

  useEffect(() => {
    setTab(location.pathname.endsWith("/config") ? "integration" : "keys");
  }, [location.pathname]);

  useEffect(() => {
    if (tab === "keys" || tab === "integration") loadKeys();
    if (tab === "webhooks") loadWebhooks();
    if (tab === "billing") loadBilling();
  }, [tab]);

  async function loadBilling() {
    try {
      setBilling(await getOrgBilling());
    } catch {
      // silently fail — billing info not critical
    }
  }

  async function handleCheckout(plan: "starter" | "pro") {
    setBillingBusy(true);
    try {
      const url = await startCheckout(plan);
      window.location.href = url;
    } catch (e: any) {
      setError(`Checkout failed: ${e.message}`);
      setBillingBusy(false);
    }
  }

  async function handlePortal() {
    setBillingBusy(true);
    try {
      const url = await getBillingPortalUrl();
      window.location.href = url;
    } catch (e: any) {
      setError(`Could not open billing portal: ${e.message}`);
      setBillingBusy(false);
    }
  }

  async function loadKeys() {
    try {
      setKeys(await listApiKeys());
      setError(null);
    } catch (e: any) {
      setError(`Failed to load API keys: ${e.message}`);
    }
  }

  async function loadWebhooks() {
    try {
      setWebhooks(await listWebhooks());
      setError(null);
    } catch (e: any) {
      setError(`Failed to load webhooks: ${e.message}`);
    }
  }
  async function handleCreate() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const k = await createApiKey(newName.trim());
      setNewKey(k);
      setNewName("");
      await loadKeys();
      setError(null);
    } catch (e: any) {
      setError(`Failed to create API key: ${e.message}`);
    }
    finally { setBusy(false); }
  }
  async function handleRevoke(id: string) {
    try {
      await revokeApiKey(id);
      setRevokeConfirm(null);
      setKeys(k => k.filter(x => x.id !== id));
      setError(null);
    } catch (e: any) {
      setError(`Failed to revoke API key: ${e.message}`);
    }
  }
  async function handleCreateWebhook() {
    if (!webhookUrl.trim()) return;
    setBusy(true);
    try {
      const created = await createWebhook({ url: webhookUrl.trim(), event: webhookEvent });
      setNewWebhook(created);
      setWebhookUrl("");
      await loadWebhooks();
    } catch (e: any) {
      alert("Failed to create webhook: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteWebhook(id: string) {
    if (!confirm("Are you sure?")) return;
    await deleteWebhook(id);
    setWebhooks(w => w.filter(x => x.id !== id));
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="stack-lg anim-up" style={{ maxWidth: 1040 }}>
      <div className="page-header">
        <h1><Settings size={18} style={{ display: "inline", marginRight: 8, verticalAlign: "middle", color: "var(--text-tertiary)" }} />Settings</h1>
        <p>Manage API keys and integrate Spidercrawl with your AI agents and workflows.</p>
      </div>

      {error && (
        <div className="msg-banner err">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs" style={{ display: "inline-flex" }}>
        <button className={`tab-btn ${tab === "keys" ? "active" : ""}`} onClick={() => setTab("keys")}>
          <Key size={12} /> API Keys
        </button>
        <button className={`tab-btn ${tab === "webhooks" ? "active" : ""}`} onClick={() => setTab("webhooks")}>
          <Bell size={12} /> Webhooks
        </button>
        <button className={`tab-btn ${tab === "integration" ? "active" : ""}`} onClick={() => setTab("integration")}>
          <Code2 size={12} /> Agent Integration
        </button>
        <button className={`tab-btn ${tab === "mcp" ? "active" : ""}`} onClick={() => setTab("mcp")}>
          <Bot size={12} /> MCP Server
        </button>
        <button className={`tab-btn ${tab === "billing" ? "active" : ""}`} onClick={() => setTab("billing")}>
          <CreditCard size={12} /> Billing
        </button>
      </div>

      {/* ── API Keys Tab ──────────────────────────────── */}
      {tab === "keys" && (
        <div className="stack">

          {/* New key created banner */}
          {newKey && (
            <div className="card anim-up" style={{ borderColor: "rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.06)" }}>
              <div className="card-body stack-sm">
                <div className="flex items-center gap-2" style={{ color: "var(--brand)" }}>
                  <CheckCheck size={15} />
                  <span className="font-semibold" style={{ fontSize: 14 }}>API key created — copy it now, it won't be shown again.</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{
                    flex: 1, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(34,197,94,0.2)",
                    borderRadius: 6, padding: "10px 14px", fontFamily: "var(--font-mono)",
                    fontSize: 13, color: "#86efac", letterSpacing: "0.5px",
                    overflow: "hidden", textOverflow: showKey ? "clip" : "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {showKey ? newKey.key : newKey.key?.replace(/(?<=.{16}).+(?=.{4})/, "•".repeat(24))}
                  </code>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setShowKey(s => !s)} title={showKey ? "Hide" : "Reveal"}>
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => copy(newKey.key!, "newkey")}>
                    {copied === "newkey" ? <><CheckCheck size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
                  </button>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setNewKey(null)} title="Dismiss">×</button>
                </div>
              </div>
            </div>
          )}

          {/* Create key */}
          <div className="card">
            <div className="card-header"><span className="card-title"><Plus size={14} /> Create API Key</span></div>
            <div className="card-body">
              <div style={{ display: "flex", gap: 10 }}>
                <div className="input-wrap" style={{ flex: 1, marginBottom: 0 }}>
                  <input
                    placeholder="Key name (e.g. Hermes Agent, Production)"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <button className="btn btn-primary" onClick={handleCreate} disabled={busy || !newName.trim()}>
                  {busy ? <span className="spinner" /> : <><Key size={13} /> Generate</>}
                </button>
              </div>
            </div>
          </div>

          {/* Keys list */}
          <div className="card">
            <div className="card-header">
              <span className="card-title"><Key size={14} /> Your Keys</span>
              <span className="text-xs text-tertiary">{keys.length} key{keys.length !== 1 ? "s" : ""}</span>
            </div>
            {keys.length === 0 ? (
              <div className="empty-state" style={{ padding: "48px 20px" }}>
                <Key size={32} />
                <h3>No API keys yet</h3>
                <p>Create a key above to connect Spidercrawl to your agents and workflows.</p>
              </div>
            ) : (
              <div style={{ padding: "4px 0" }}>
                {keys.map(k => (
                  <div key={k.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)",
                  }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: 8,
                      background: "var(--bg-elevated)", border: "1px solid var(--border-default)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <Key size={14} style={{ color: "var(--brand)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="font-semibold" style={{ fontSize: 13 }}>{k.name}</div>
                      <div className="font-mono text-xs text-tertiary" style={{ marginTop: 2 }}>
                        {k.key ? k.key.slice(0, 12) + "..." : k.prefix ? `${k.prefix}...` : "sk-sc-••••••••••••"}
                      </div>
                    </div>
                    <div className="text-xs text-tertiary" style={{ flexShrink: 0 }}>
                      {new Date(k.createdAt).toLocaleDateString()}
                    </div>
                    {revokeConfirm === k.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: "var(--red)" }}>Revoke this key?</span>
                        <button className="btn btn-danger btn-sm" onClick={() => handleRevoke(k.id)}>Revoke</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setRevokeConfirm(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setRevokeConfirm(k.id)} title="Revoke key">
                        <Trash2 size={13} style={{ color: "var(--red)" }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Env vars info */}
          <div className="card" style={{ borderColor: "rgba(245,158,11,0.2)", background: "rgba(245,158,11,0.04)" }}>
            <div className="card-body" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <AlertTriangle size={15} style={{ color: "var(--amber)", flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  AI features (vision, goal scoring, extraction) require API keys set in the <code className="font-mono" style={{ fontSize: 12, background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4 }}>.env</code> file on the server:
                </p>
                <pre style={{ marginTop: 10, background: "rgba(0,0,0,0.35)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#a5d6ff", fontFamily: "var(--font-mono)", lineHeight: 1.7 }}>
{`GOOGLE_AI_API_KEY=your-gemini-key
OPENAI_API_KEY=your-openai-key`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Integration Tab ───────────────────────────── */}
      {tab === "integration" && (
        <div className="stack">
          <div className="card" style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.06) 0%, rgba(59,130,246,0.04) 100%)", borderColor: "rgba(34,197,94,0.2)" }}>
            <div className="card-body" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--brand-dim)", border: "1px solid rgba(34,197,94,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Zap size={18} style={{ color: "var(--brand)" }} />
              </div>
              <div>
                <div className="font-semibold" style={{ fontSize: 14, color: "var(--text-primary)" }}>Connect Spidercrawl to Your AI Agent</div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.6 }}>
                  Spidercrawl exposes a clean REST API your agent can call as a tool — scrape pages, crawl entire sites, and semantically search the extracted content. Works with any agent framework: Hermes, LangChain, AutoGPT, CrewAI, or raw API calls.
                </p>
              </div>
            </div>
          </div>

          {/* Quick reference */}
          <div className="card">
            <div className="card-header"><span className="card-title"><Globe size={14} /> API Endpoints</span></div>
            <div style={{ padding: "4px 0" }}>
              {[
                { method: "POST", path: "/v1/scrape", desc: "Scrape a single URL → markdown, HTML, JSON" },
                { method: "POST", path: "/v1/crawl", desc: "Start an async crawl job with optional AI goal" },
                { method: "GET",  path: "/v1/crawl/:id", desc: "Poll job status and progress" },
                { method: "GET",  path: "/v1/jobs", desc: "List all recent crawl jobs" },
                { method: "POST", path: "/v1/search", desc: "Keyword search across all persisted crawl pages" },
                { method: "POST", path: "/v1/export/rag/:id/search", desc: "Keyword search over crawled content" },
                { method: "GET",  path: "/v1/export/jsonl/:id", desc: "Export one JSON object per page (JSONL / NDJSON)" },
                { method: "GET",  path: "/v1/export/fine-tune-jsonl/:id", desc: "Export OpenAI-style fine-tuning chat records as JSONL" },
                { method: "GET",  path: "/v1/export/jsonld/:id", desc: "Export knowledge graph as JSON-LD" },
                { method: "GET",  path: "/v1/export/graphml/:id", desc: "Export page and entity graph as GraphML" },
                { method: "GET",  path: "/v1/export/cytoscape/:id", desc: "Export page and entity graph for Cytoscape" },
                { method: "GET",  path: "/v1/webhooks", desc: "List webhook subscriptions" },
                { method: "POST", path: "/v1/webhooks", desc: "Create a signed job.completed or job.failed webhook" },
                { method: "DELETE", path: "/v1/webhooks/:id", desc: "Delete a webhook subscription" },
                { method: "POST", path: "/v1/map", desc: "Map site topology without scraping content" },
                { method: "POST", path: "/v1/extract", desc: "AI-powered structured data extraction" },
              ].map(e => (
                <div key={`${e.method}:${e.path}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
                    padding: "3px 7px", borderRadius: 4,
                    background: e.method === "GET" ? "rgba(59,130,246,0.12)" : "rgba(34,197,94,0.1)",
                    color: e.method === "GET" ? "#60a5fa" : "var(--brand)",
                    border: `1px solid ${e.method === "GET" ? "rgba(59,130,246,0.2)" : "rgba(34,197,94,0.2)"}`,
                    flexShrink: 0, minWidth: 42, textAlign: "center",
                  }}>{e.method}</span>
                  <code className="font-mono" style={{ fontSize: 12.5, color: "#e2e8f0", flexShrink: 0 }}>{e.path}</code>
                  <span className="text-xs text-tertiary" style={{ flex: 1 }}>{e.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Code examples */}
          <div className="card">
            <div className="card-header">
              <span className="card-title"><Terminal size={14} /> Code Examples</span>
              <div className="tabs" style={{ display: "inline-flex" }}>
                {(["agent", "python", "curl"] as const).map(l => (
                  <button key={l} className={`tab-btn ${lang === l ? "active" : ""}`} onClick={() => setLang(l)}>
                    {l === "agent" ? "Agent (TS)" : l === "python" ? "Python" : "cURL"}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ position: "relative" }}>
              <button
                className="btn btn-ghost btn-sm"
                style={{ position: "absolute", top: 10, right: 12, zIndex: 2, fontSize: 11 }}
                onClick={() => copy(snippet, "snippet")}
              >
                {copied === "snippet" ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
              <pre className="code-block" style={{ borderRadius: "0 0 var(--r-lg) var(--r-lg)", border: "none", borderTop: "1px solid var(--border-subtle)", maxHeight: 520, fontSize: 12.5 }}>
                {snippet}
              </pre>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title"><Key size={14} /> Authentication</span></div>
            <div className="card-body stack-sm">
              <p className="text-sm text-secondary" style={{ lineHeight: 1.65 }}>
                Pass your API key in the <code className="font-mono" style={{ fontSize: 12, background: "rgba(255,255,255,0.06)", padding: "1px 5px", borderRadius: 4 }}>Authorization</code> header as a Bearer token:
              </p>
              <pre className="code-block" style={{ fontSize: 12.5 }}>Authorization: Bearer sk-sc-…your-key…</pre>
              <p className="text-xs text-tertiary" style={{ lineHeight: 1.6 }}>
                For local dev, authentication is optional by default. Set <code className="font-mono" style={{ fontSize: 11 }}>REQUIRE_API_KEY=true</code> on the server to enforce bearer-key access.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Webhooks Tab ─────────────────────────────── */}
      {tab === "webhooks" && (
        <div className="stack">
          {newWebhook?.secret && (
            <div className="card anim-up" style={{ borderColor: "rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.06)" }}>
              <div className="card-body stack-sm">
                <div className="flex items-center gap-2" style={{ color: "var(--brand)" }}>
                  <CheckCheck size={15} />
                  <span className="font-semibold" style={{ fontSize: 14 }}>Webhook created — copy this signing secret now.</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code style={{
                    flex: 1, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(34,197,94,0.2)",
                    borderRadius: 6, padding: "10px 14px", fontFamily: "var(--font-mono)",
                    fontSize: 13, color: "#86efac", letterSpacing: "0.5px",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {newWebhook.secret}
                  </code>
                  <button className="btn btn-secondary btn-sm" onClick={() => copy(newWebhook.secret!, "newwebhook")}>
                    {copied === "newwebhook" ? <><CheckCheck size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
                  </button>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setNewWebhook(null)} title="Dismiss">x</button>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header"><span className="card-title"><Plus size={14} /> Add Webhook Subscription</span></div>
            <div className="card-body">
              <div className="stack" style={{ gap: 12 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div className="input-wrap" style={{ flex: 1, marginBottom: 0 }}>
                    <input
                      placeholder="https://your-app.com/webhook"
                      value={webhookUrl}
                      onChange={e => setWebhookUrl(e.target.value)}
                    />
                  </div>
                  <select 
                    className="select-custom"
                    style={{ width: 160 }}
                    value={webhookEvent}
                    onChange={e => setWebhookEvent(e.target.value)}
                  >
                    <option value="job.completed">Job Completed</option>
                    <option value="job.failed">Job Failed</option>
                  </select>
                  <button className="btn btn-primary" onClick={handleCreateWebhook} disabled={busy || !webhookUrl.trim()}>
                    {busy ? <span className="spinner" /> : <><Bell size={13} /> Subscribe</>}
                  </button>
                </div>
                <p className="text-xs text-tertiary" style={{ lineHeight: 1.5 }}>
                  Use a real HTTPS endpoint. Delivery payloads include <code className="font-mono">x-spidercrawl-event</code> and a signed body header.
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title"><Bell size={14} /> Active Subscriptions</span>
              <span className="text-xs text-tertiary">{webhooks.length} active</span>
            </div>
            {webhooks.length === 0 ? (
              <div className="empty-state" style={{ padding: "48px 20px" }}>
                <Bell size={32} />
                <h3>No webhooks yet</h3>
                <p>Subscribe to events to receive real-time notifications in your apps.</p>
              </div>
            ) : (
              <div style={{ padding: "4px 0" }}>
                {webhooks.map((w: WebhookRow) => (
                  <div key={w.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)",
                  }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: 8,
                      background: "var(--bg-elevated)", border: "1px solid var(--border-default)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <Share2 size={14} style={{ color: "var(--brand)" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="font-semibold" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                        {w.url}
                        <span className="badge badge-sm">{w.event}</span>
                      </div>
                      <div className="font-mono text-xs text-tertiary" style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                        {w.hasSecret ? "Signed deliveries enabled" : "Unsigned deliveries"}
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleDeleteWebhook(w.id)} title="Delete webhook">
                      <Trash2 size={13} style={{ color: "var(--red)" }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ background: "rgba(34,197,94,0.03)", borderColor: "rgba(34,197,94,0.15)" }}>
            <div className="card-body">
              <h4 className="text-sm font-semibold text-primary">Webhook Security</h4>
              <p className="text-xs text-secondary mt-2" style={{ lineHeight: 1.6 }}>
                All webhook payloads are signed with your subscription's <b>Secret</b>. 
                Verify the signature in the <code className="font-mono">x-spidercrawl-signature</code> header using HMAC-SHA256 to ensure authenticity.
              </p>
            </div>
          </div>
        </div>
      )}
      {/* ── MCP Tab ──────────────────────────────────── */}
      {tab === "mcp" && (
        <div className="stack">
          {/* Hero */}
          <div className="card" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(34,197,94,0.05) 100%)", borderColor: "rgba(139,92,246,0.25)" }}>
            <div className="card-body" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Bot size={18} style={{ color: "#a78bfa" }} />
              </div>
              <div>
                <div className="font-semibold" style={{ fontSize: 14, color: "var(--text-primary)" }}>Model Context Protocol (MCP) Server</div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.6 }}>
                  Connect Claude Code, Cursor, or any MCP-compatible AI assistant directly to Spidercrawl.
                  Run crawls, search knowledge, and ask questions about crawled sites — all from within your AI tools.
                </p>
              </div>
            </div>
          </div>

          {/* Connection snippets */}
          <div className="card">
            <div className="card-header"><span className="card-title"><Terminal size={14} /> Connect via stdio</span></div>
            <div className="card-body stack">
              <p className="text-sm text-secondary" style={{ lineHeight: 1.6 }}>
                Add Spidercrawl to your MCP client config. The server runs as a child process over stdio — no port needed.
              </p>

              <div>
                <div className="text-xs text-tertiary" style={{ marginBottom: 6, fontWeight: 600 }}>Claude Code (<code className="font-mono" style={{ fontSize: 11 }}>~/.claude.json</code> or <code className="font-mono" style={{ fontSize: 11 }}>project/.claude/mcp.json</code>)</div>
                <div style={{ position: "relative" }}>
                  <button className="btn btn-ghost btn-sm" style={{ position: "absolute", top: 8, right: 8, zIndex: 2, fontSize: 11 }}
                    onClick={() => copy(`{\n  "mcpServers": {\n    "spidercrawl": {\n      "command": "node",\n      "args": ["/path/to/spidercrawl/dist/mcp/index.js"]\n    }\n  }\n}`, "mcp-claude")}>
                    {copied === "mcp-claude" ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                  </button>
                  <pre className="code-block" style={{ fontSize: 12 }}>{`{
  "mcpServers": {
    "spidercrawl": {
      "command": "node",
      "args": ["/path/to/spidercrawl/dist/mcp/index.js"]
    }
  }
}`}</pre>
                </div>
              </div>

              <div>
                <div className="text-xs text-tertiary" style={{ marginBottom: 6, fontWeight: 600 }}>Cursor (<code className="font-mono" style={{ fontSize: 11 }}>.cursor/mcp.json</code>)</div>
                <div style={{ position: "relative" }}>
                  <button className="btn btn-ghost btn-sm" style={{ position: "absolute", top: 8, right: 8, zIndex: 2, fontSize: 11 }}
                    onClick={() => copy(`{\n  "mcpServers": {\n    "spidercrawl": {\n      "command": "node",\n      "args": ["/path/to/spidercrawl/dist/mcp/index.js"]\n    }\n  }\n}`, "mcp-cursor")}>
                    {copied === "mcp-cursor" ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                  </button>
                  <pre className="code-block" style={{ fontSize: 12 }}>{`{
  "mcpServers": {
    "spidercrawl": {
      "command": "node",
      "args": ["/path/to/spidercrawl/dist/mcp/index.js"]
    }
  }
}`}</pre>
                </div>
              </div>

              <p className="text-xs text-tertiary" style={{ lineHeight: 1.6 }}>
                Build first: <code className="font-mono" style={{ fontSize: 11 }}>npm run build</code> in the Spidercrawl root. The entry point is <code className="font-mono" style={{ fontSize: 11 }}>dist/mcp/index.js</code>.
              </p>
            </div>
          </div>

          {/* Tool list */}
          <div className="card">
            <div className="card-header">
              <span className="card-title"><Wrench size={14} /> Available Tools ({MCP_TOOLS.length})</span>
            </div>
            <div style={{ padding: "4px 0" }}>
              {MCP_TOOLS.map(tool => (
                <div key={tool.name} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                    <tool.Icon size={13} style={{ color: "#a78bfa" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <code className="font-mono" style={{ fontSize: 12.5, color: "#e2e8f0" }}>{tool.name}</code>
                      {tool.params.map(p => (
                        <span key={p} className="badge badge-sm badge-ghost" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>{p}</span>
                      ))}
                    </div>
                    <p className="text-xs text-secondary" style={{ marginTop: 4, lineHeight: 1.5 }}>{tool.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Example usage */}
          <div className="card">
            <div className="card-header"><span className="card-title"><Bot size={14} /> Example Prompts</span></div>
            <div className="card-body stack-sm">
              {[
                `"Crawl https://docs.stripe.com with the goal 'find all webhook events' and summarize what you find"`,
                `"Ask the last Spidercrawl job what pricing tiers were mentioned"`,
                `"List my recent crawl jobs and show me the extracted data from the most recent one"`,
                `"Search the knowledge base for anything related to authentication"`,
              ].map((prompt, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ color: "var(--brand)", fontWeight: 700, fontSize: 13, flexShrink: 0, marginTop: 1 }}>›</span>
                  <p className="text-sm text-secondary" style={{ lineHeight: 1.55, fontStyle: "italic" }}>{prompt}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Billing Tab ────────────────────────────────── */}
      {tab === "billing" && (
        <div className="stack">
          {/* Current plan */}
          <div className="card">
            <div className="card-header">
              <span className="card-title"><TrendingUp size={14} /> Current Plan</span>
              {billing && (
                <span className="badge badge-sm" style={{ textTransform: "capitalize", background: billing.plan === "free" ? "rgba(100,100,100,0.2)" : "rgba(139,92,246,0.15)", color: billing.plan === "free" ? "var(--text-secondary)" : "#a78bfa" }}>
                  {billing.plan}
                </span>
              )}
            </div>
            <div className="card-body stack-sm">
              {billing ? (
                <>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span className="text-sm text-secondary">Pages used this period</span>
                      <span className="text-sm font-semibold">{billing.pagesUsed.toLocaleString()} / {billing.pagesQuota.toLocaleString()}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: "var(--bg-elevated)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        width: `${Math.min(100, Math.round(billing.pagesUsed / billing.pagesQuota * 100))}%`,
                        background: billing.pagesUsed / billing.pagesQuota >= 0.9 ? "#f87171" : billing.pagesUsed / billing.pagesQuota >= 0.8 ? "#fbbf24" : "var(--brand)",
                        borderRadius: 999,
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                  </div>
                  {billing.stripeCustomerId && (
                    <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} onClick={handlePortal} disabled={billingBusy}>
                      {billingBusy ? <span className="spinner" /> : <><CreditCard size={12} /> Manage subscription</>}
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-secondary">Loading billing info…</p>
              )}
            </div>
          </div>

          {/* Upgrade plans */}
          {billing?.plan === "free" && (
            <div className="card">
              <div className="card-header"><span className="card-title"><Zap size={14} /> Upgrade Plan</span></div>
              <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {([
                  { id: "starter" as const, name: "Starter", pages: "100,000 pages/mo", price: "$29/mo", desc: "Perfect for small teams and projects." },
                  { id: "pro" as const, name: "Pro", pages: "500,000 pages/mo", price: "$99/mo", desc: "For power users and production pipelines." },
                ] as const).map(plan => (
                  <div key={plan.id} style={{ border: "1px solid var(--border-default)", borderRadius: 10, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{plan.name}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--brand)", margin: "4px 0" }}>{plan.price}</div>
                      <div className="text-sm text-secondary">{plan.pages}</div>
                      <div className="text-xs text-tertiary" style={{ marginTop: 4 }}>{plan.desc}</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => handleCheckout(plan.id)} disabled={billingBusy} style={{ marginTop: "auto" }}>
                      {billingBusy ? <span className="spinner" /> : <>Upgrade to {plan.name} →</>}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MCP_TOOLS: Array<{ name: string; desc: string; params: string[]; Icon: any }> = [
  { name: "start_crawl", desc: "Start an async crawl job for a URL with an optional natural-language goal.", params: ["url", "goal?", "maxDepth?", "maxPages?"], Icon: Zap },
  { name: "get_job_status", desc: "Get current status, progress, and page count for a crawl job.", params: ["jobId"], Icon: Globe },
  { name: "search_knowledge", desc: "Semantic or keyword search across all crawled content. Scoped to one job or across all.", params: ["query", "jobId?", "limit?"], Icon: Terminal },
  { name: "get_entities", desc: "Get structured entities (people, organizations, products) extracted during a crawl.", params: ["jobId", "type?"], Icon: Key },
  { name: "list_jobs", desc: "List recent crawl jobs with their status, progress, and root URL.", params: ["limit?"], Icon: Code2 },
  { name: "get_extracted_data", desc: "Return JSON-structured data extracted from pages in a job — requires extraction prompt or schema.", params: ["jobId", "limit?"], Icon: Wrench },
  { name: "ask_job", desc: "Ask a natural-language question about a crawl job's content. Returns a synthesized answer with sources.", params: ["jobId", "question", "limit?"], Icon: Bot },
  { name: "get_job_summary", desc: "Get a concise AI-generated summary of what was found in a crawl. Generated once and cached.", params: ["jobId"], Icon: Share2 },
];
