import React, { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Rocket, BookOpen, ShoppingBag, Newspaper, SlidersHorizontal,
  ArrowLeft, Globe, Target, Layers, Plus, Calendar,
  FileText, Braces, MessageSquare, FlaskConical, Copy, CheckCheck, Trash2,
} from "lucide-react";
import { startCrawl, createSchedule, testExtraction } from "../api";
import LoadingSpinner from "../components/LoadingSpinner";

// ── Types ────────────────────────────────────────────────────

type ExtractionMode = "none" | "prompt" | "schema";
type SchemaField = { key: string; type: string; description: string };

interface Preset {
  key: string;
  label: string;
  icon: any;
  desc: string;
  goal: string;
  depth: number;
  pages: number;
  extractionMode: ExtractionMode;
  extractionPrompt: string;
  extractionSchema: SchemaField[] | null;
}

// ── Presets with extraction defaults ────────────────────────

const PRESETS: Preset[] = [
  {
    key: "docs",
    label: "Documentation",
    icon: BookOpen,
    desc: "Index technical docs, API refs, code examples",
    goal: "Find all technical documentation, API references, and code examples",
    depth: 4,
    pages: 100,
    extractionMode: "prompt",
    extractionPrompt: "Extract: page title, section headings, any code examples with their language, API endpoints and HTTP methods, function/method signatures with parameters, and key technical concepts defined on this page.",
    extractionSchema: null,
  },
  {
    key: "shop",
    label: "E-Commerce",
    icon: ShoppingBag,
    desc: "Extract products, prices, and specs",
    goal: "Find product pages with prices, descriptions, and specifications",
    depth: 3,
    pages: 200,
    extractionMode: "schema",
    extractionPrompt: "",
    extractionSchema: [
      { key: "name",         type: "string",  description: "Full product name" },
      { key: "price",        type: "string",  description: "Price including currency symbol" },
      { key: "description",  type: "string",  description: "Short product description or tagline" },
      { key: "availability", type: "string",  description: "In stock / Out of stock / Pre-order" },
      { key: "sku",          type: "string",  description: "Product SKU or identifier" },
    ],
  },
  {
    key: "news",
    label: "News / Blog",
    icon: Newspaper,
    desc: "Collect articles, posts, and stories",
    goal: "Collect articles, blog posts, and news stories",
    depth: 2,
    pages: 50,
    extractionMode: "schema",
    extractionPrompt: "",
    extractionSchema: [
      { key: "headline",    type: "string", description: "Article headline or title" },
      { key: "author",      type: "string", description: "Author full name(s)" },
      { key: "publishDate", type: "string", description: "Publication date in ISO 8601 format" },
      { key: "summary",     type: "string", description: "2–3 sentence summary of the article" },
      { key: "tags",        type: "array",  description: "Topic tags or content categories" },
    ],
  },
  {
    key: "custom",
    label: "Custom",
    icon: SlidersHorizontal,
    desc: "Define your own extraction objective",
    goal: "",
    depth: 2,
    pages: 30,
    extractionMode: "none",
    extractionPrompt: "",
    extractionSchema: null,
  },
];

// ── Extraction mode options ──────────────────────────────────

const EXTRACTION_MODES = [
  {
    id: "none" as ExtractionMode,
    icon: FileText,
    label: "Markdown Only",
    desc: "Clean text, no structured fields",
  },
  {
    id: "prompt" as ExtractionMode,
    icon: MessageSquare,
    label: "Natural Language",
    desc: "Describe what to extract",
  },
  {
    id: "schema" as ExtractionMode,
    icon: Braces,
    label: "JSON Schema",
    desc: "Define exact fields + types",
  },
];

// ── Component ────────────────────────────────────────────────

export default function NewCrawlPage() {
  const nav = useNavigate();

  const [preset,    setPreset]    = useState(PRESETS[0].key);
  const [url,       setUrl]       = useState("");
  const [goal,      setGoal]      = useState(PRESETS[0].goal);
  const [maxDepth,  setDepth]     = useState(PRESETS[0].depth);
  const [maxPages,  setPages]     = useState(PRESETS[0].pages);
  const [formats,   setFormats]   = useState<string[]>(["markdown"]);
  const [adaptiveBudget,        setAdaptiveBudget]        = useState(false);
  const [satisfactionThreshold, setSatisfactionThreshold] = useState(0.3);

  const [extractionMode,   setExtractionMode]   = useState<ExtractionMode>(PRESETS[0].extractionMode);
  const [extractionPrompt, setExtractionPrompt] = useState(PRESETS[0].extractionPrompt);
  const [schemaFields,     setSchemaFields]     = useState<SchemaField[]>(PRESETS[0].extractionSchema ?? []);
  const [enableEntities,   setEnableEntities]   = useState(false);

  const [testBusy,   setTestBusy]   = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [testError,  setTestError]  = useState<string | null>(null);
  const [testCopied, setTestCopied] = useState(false);

  const [isScheduled,   setIsScheduled]   = useState(false);
  const [scheduleName,  setScheduleName]  = useState("");
  const [scheduleCron,  setScheduleCron]  = useState("0 0 * * *");

  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  // ── Helpers ────────────────────────────────────────────────

  function pickPreset(key: string) {
    const p = PRESETS.find(x => x.key === key)!;
    setPreset(key);
    setGoal(p.goal);
    setDepth(p.depth);
    setPages(p.pages);
    setExtractionMode(p.extractionMode);
    setExtractionPrompt(p.extractionPrompt);
    setSchemaFields(p.extractionSchema ?? []);
    setTestResult(null);
    setTestError(null);
  }

  function addField() {
    setSchemaFields(c => [...c, { key: "", type: "string", description: "" }]);
  }
  function updateField(i: number, patch: Partial<SchemaField>) {
    setSchemaFields(c => c.map((f, idx) => idx === i ? { ...f, ...patch } : f));
  }
  function removeField(i: number) {
    setSchemaFields(c => c.filter((_, idx) => idx !== i));
  }

  function toggleFormat(f: string) {
    setFormats(c => c.includes(f) ? c.filter(x => x !== f) : [...c, f]);
  }

  function normalizeUrlInput(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }

  function buildSchemaObject() {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const f of schemaFields) {
      if (!f.key.trim()) continue;
      properties[f.key.trim()] = {
        type: f.type,
        ...(f.description.trim() ? { description: f.description.trim() } : {}),
      };
      required.push(f.key.trim());
    }
    return { type: "object", properties, required };
  }

  const canTest = url.length > 0 && extractionMode !== "none" && (
    (extractionMode === "prompt" && extractionPrompt.trim().length > 0) ||
    (extractionMode === "schema" && schemaFields.filter(f => f.key.trim()).length > 0)
  );
  const activePreset = useMemo(() => PRESETS.find((entry) => entry.key === preset) ?? PRESETS[0], [preset]);
  const namedSchemaFields = schemaFields.filter((f) => f.key.trim()).length;
  const canSubmit = url.trim().length > 0 && formats.length > 0;

  async function runTest() {
    if (!canTest) return;
    const normalizedUrl = normalizeUrlInput(url);
    if (!normalizedUrl) return;
    setTestBusy(true);
    setTestResult(null);
    setTestError(null);
    try {
      let schema: Record<string, unknown> | undefined;
      let prompt: string | undefined;
      if (extractionMode === "schema") schema = buildSchemaObject();
      else prompt = extractionPrompt;
      const result = await testExtraction(normalizedUrl, schema, prompt);
      setTestResult(result);
    } catch (e: any) {
      setTestError(e.message);
    } finally {
      setTestBusy(false);
    }
  }

  async function copyTest() {
    if (!testResult) return;
    await navigator.clipboard.writeText(JSON.stringify(testResult, null, 2));
    setTestCopied(true);
    setTimeout(() => setTestCopied(false), 1800);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedUrl = normalizeUrlInput(url);
    if (!normalizedUrl) {
      setErr("A valid crawl URL is required.");
      return;
    }
    if (!formats.length) {
      setErr("Choose at least one output format.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const extractionSchema =
        extractionMode === "schema" && schemaFields.filter(f => f.key.trim()).length > 0
          ? buildSchemaObject()
          : undefined;
      const extractionPromptVal =
        extractionMode === "prompt" && extractionPrompt.trim()
          ? extractionPrompt.trim()
          : undefined;

      if (isScheduled) {
        if (!scheduleName.trim()) throw new Error("Schedule name is required");
        await createSchedule({
          name: scheduleName,
          cron: scheduleCron,
          active: true,
          crawlRequest: {
            url: normalizedUrl, maxDepth, maxPages, formats,
            goal: goal || undefined,
            adaptiveBudget, satisfactionThreshold,
            extractionPrompt: extractionPromptVal,
            extractionSchema,
            enableEntities,
          },
        });
        nav("/schedules");
      } else {
        const { id } = await startCrawl({
          url: normalizedUrl, maxDepth, maxPages, formats,
          ...(goal ? { goal } : {}),
          adaptiveBudget, satisfactionThreshold,
          ...(extractionPromptVal ? { extractionPrompt: extractionPromptVal } : {}),
          ...(extractionSchema   ? { extractionSchema }                       : {}),
          enableEntities,
        });
        nav(`/jobs/${id}`);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="new-crawl-page stack-lg anim-up">

      {/* Header */}
      <div>
        <Link to="/" className="back-link"><ArrowLeft size={13} /> Back to Dashboard</Link>
        <div className="page-header new-crawl-hero" style={{ marginBottom: 0 }}>
          <h1><Rocket size={18} style={{ color: "var(--brand)", flexShrink: 0 }} /> New Crawl</h1>
          <p>Shape the crawl before it runs: target, extraction, crawl budget, and delivery mode in one place.</p>
        </div>
      </div>

      <div className="new-crawl-summary">
        <div className="new-crawl-summary-copy">
          <div className="page-eyebrow">Studio</div>
          <h2>{activePreset.label} configuration</h2>
          <p>{activePreset.desc}. Tune the crawl and preview extraction before you spend crawl budget.</p>
        </div>
        <div className="new-crawl-summary-grid">
          <div className="new-crawl-summary-card">
            <span className="new-crawl-summary-label">Target depth</span>
            <strong>{maxDepth} levels</strong>
            <span>{maxPages} pages max</span>
          </div>
          <div className="new-crawl-summary-card">
            <span className="new-crawl-summary-label">Extraction mode</span>
            <strong>{EXTRACTION_MODES.find((mode) => mode.id === extractionMode)?.label ?? "Markdown Only"}</strong>
            <span>
              {extractionMode === "schema"
                ? `${namedSchemaFields} field${namedSchemaFields === 1 ? "" : "s"} defined`
                : extractionMode === "prompt"
                  ? (extractionPrompt.trim() ? "Prompt ready" : "Prompt needed")
                  : "No structured fields"}
            </span>
          </div>
          <div className="new-crawl-summary-card">
            <span className="new-crawl-summary-label">Delivery</span>
            <strong>{isScheduled ? "Recurring schedule" : "Run now"}</strong>
            <span>{formats.length} format{formats.length === 1 ? "" : "s"} selected</span>
          </div>
        </div>
      </div>

      {/* ── STEP 1: Template ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Layers size={13} /> Template</span>
        </div>
        <div className="card-body new-crawl-card-body">
          <div className="preset-grid">
            {PRESETS.map(p => {
              const Icon = p.icon;
              return (
                <button
                  key={p.key}
                  type="button"
                  className={`preset-btn ${preset === p.key ? "selected" : ""}`}
                  onClick={() => pickPreset(p.key)}
                >
                  <span className="pi"><Icon size={18} /></span>
                  <div className="pt">{p.label}</div>
                  <div className="pd">{p.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="stack-lg">

        {/* ── STEP 2: Target ── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Globe size={13} /> Target</span>
          </div>
          <div className="card-body stack new-crawl-card-body">
            <div className="input-wrap">
              <label className="input-label">URL *</label>
              <div className="input-with-icon">
                <Globe size={14} />
                <input
                  required
                  type="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onBlur={e => setUrl(normalizeUrlInput(e.target.value))}
                />
              </div>
              <p className="text-xs text-tertiary" style={{ marginTop: 6 }}>
                Enter a site root, product catalog, docs hub, or any page that can seed discovery.
              </p>
            </div>
            <div className="input-wrap">
              <label className="input-label">
                Crawl Goal
                {goal && (
                  <span style={{ marginLeft: 8, color: "var(--brand)", fontWeight: 500, fontSize: 11 }}>
                    AI link-scoring active
                  </span>
                )}
              </label>
              <div className="input-with-icon">
                <Target size={14} />
                <input
                  placeholder="Describe what to find — leave blank for breadth-first…"
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── STEP 3: Extraction Intelligence ── */}
        <div className="card extraction-card">
          <div className="card-header">
            <span className="card-title"><Braces size={13} /> Extraction Intelligence</span>
            <span className="text-xs text-tertiary">What structured data should each page produce?</span>
          </div>
          <div className="card-body stack new-crawl-card-body">

            {/* Mode picker */}
            <div className="extraction-mode-grid">
              {EXTRACTION_MODES.map(m => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`extraction-mode-card ${extractionMode === m.id ? "selected" : ""}`}
                    onClick={() => { setExtractionMode(m.id); setTestResult(null); setTestError(null); }}
                  >
                    <span className="emc-icon"><Icon size={14} /></span>
                    <div className="emc-label">{m.label}</div>
                    <div className="emc-desc">{m.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* Prompt mode */}
            {extractionMode === "prompt" && (
              <div className="input-wrap anim-up" style={{ marginTop: 4 }}>
                <label className="input-label">Extraction Prompt</label>
                <textarea
                  placeholder="Extract: product name, price, description, availability…"
                  value={extractionPrompt}
                  onChange={e => setExtractionPrompt(e.target.value)}
                  rows={3}
                  style={{ width: "100%", resize: "vertical" }}
                />
              </div>
            )}

            {/* Schema mode */}
            {extractionMode === "schema" && (
              <div className="stack anim-up" style={{ gap: 6, marginTop: 4 }}>
                <div className="schema-field-header">
                  <span className="text-xs text-tertiary" style={{ gridColumn: "1" }}>Field name</span>
                  <span className="text-xs text-tertiary" style={{ gridColumn: "2" }}>Type</span>
                  <span className="text-xs text-tertiary" style={{ gridColumn: "3" }}>Description (helps AI extract accurately)</span>
                </div>
                {schemaFields.map((f, i) => (
                  <div key={i} className="schema-field-row">
                    <input
                      placeholder="field_name"
                      value={f.key}
                      onChange={e => updateField(i, { key: e.target.value })}
                    />
                    <select
                      value={f.type}
                      onChange={e => updateField(i, { type: e.target.value })}
                    >
                      <option value="string">String</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="array">Array</option>
                    </select>
                    <input
                      placeholder='e.g. "Price with currency symbol, e.g. $29.99"'
                      value={f.description}
                      onChange={e => updateField(i, { description: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => removeField(i)}
                      title="Remove field"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={addField}
                  style={{ alignSelf: "flex-start", marginTop: 4 }}
                >
                  <Plus size={12} /> Add Field
                </button>
              </div>
            )}

            {/* Test Extraction panel */}
            {extractionMode !== "none" && (
              <div className="extraction-test-panel anim-up">
                <div className="extraction-test-header">
                  <span className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    <FlaskConical size={12} style={{ color: "var(--brand)" }} />
                    Test on root page
                  </span>
                  <div className="flex items-center gap-2">
                    {testResult && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={copyTest}
                      >
                        {testCopied ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={runTest}
                      disabled={!canTest || testBusy}
                    >
                      {testBusy
                        ? <><LoadingSpinner loading size="sm" /> Scraping…</>
                        : "Run Test →"}
                    </button>
                  </div>
                </div>
                <div className="extraction-test-body">
                  {testBusy && (
                    <div className="extraction-test-empty">
                      <LoadingSpinner loading />
                      <div style={{ marginTop: 8 }}>Scraping page and running extraction…</div>
                    </div>
                  )}
                  {!testBusy && testError && (
                    <div className="extraction-test-empty" style={{ color: "var(--red)" }}>
                      {testError}
                    </div>
                  )}
                  {!testBusy && testResult && (
                    <pre className="extraction-test-result">
                      {JSON.stringify(testResult, null, 2)}
                    </pre>
                  )}
                  {!testBusy && !testResult && !testError && (
                    <div className="extraction-test-empty">
                      {canTest
                        ? "Click \"Run Test\" to preview extracted data before starting the full crawl."
                        : url
                          ? "Configure your extraction above, then test."
                          : "Enter a URL above to enable test extraction."}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── STEP 4: Budget ── */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Target size={13} /> Crawl Budget</span>
          </div>
          <div className="card-body stack new-crawl-card-body">
            <div className="crawl-profile-grid">
              {[
                { key: "focused", label: "Focused", depth: 2, pages: 25, note: "Fast validation runs for one section or workflow." },
                { key: "balanced", label: "Balanced", depth: 3, pages: 80, note: "Best default for most sites and product surfaces." },
                { key: "broad", label: "Broad", depth: 5, pages: 250, note: "Wider discovery pass when you need full coverage." },
              ].map((profile) => (
                <button
                  key={profile.key}
                  type="button"
                  className={`crawl-profile-card ${maxDepth === profile.depth && maxPages === profile.pages ? "selected" : ""}`}
                  onClick={() => {
                    setDepth(profile.depth);
                    setPages(profile.pages);
                  }}
                >
                  <span className="crawl-profile-title">{profile.label}</span>
                  <strong>{profile.depth} depth · {profile.pages} pages</strong>
                  <span>{profile.note}</span>
                </button>
              ))}
            </div>
            <div className="new-crawl-field-grid">
              <div className="input-wrap">
                <label className="input-label">Max Depth</label>
                <input
                  type="number" min={1} max={50}
                  value={maxDepth}
                  onChange={e => setDepth(Number(e.target.value))}
                />
              </div>
              <div className="input-wrap">
                <label className="input-label">Max Pages</label>
                <input
                  type="number" min={1} max={2000}
                  value={maxPages}
                  onChange={e => setPages(Number(e.target.value))}
                />
              </div>
              <div className="input-wrap">
                <label className="input-label">Concurrency</label>
                <input type="number" value={5} disabled style={{ opacity: 0.4 }} />
              </div>
            </div>

            <div className="input-wrap" style={{ marginTop: 4 }}>
              <label className="flex items-center gap-2" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={adaptiveBudget}
                  onChange={e => setAdaptiveBudget(e.target.checked)}
                />
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Adaptive Budget
                </span>
              </label>
              <p className="text-xs text-tertiary" style={{ marginTop: 4 }}>
                Stop early when discovered content drops below relevance threshold.
              </p>
              {adaptiveBudget && (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="text-xs text-secondary">Threshold:</span>
                  <input
                    type="number" min={0.1} max={0.9} step={0.1}
                    value={satisfactionThreshold}
                    onChange={e => setSatisfactionThreshold(Number(e.target.value))}
                    style={{ width: 80 }}
                  />
                </div>
              )}
            </div>

            <div className="input-wrap" style={{ marginTop: 4 }}>
              <label className="input-label">Output Formats</label>
              <div className="format-grid">
                {["markdown", "html", "json", "screenshot"].map(f => (
                  <button
                    key={f}
                    type="button"
                    className={`format-btn ${formats.includes(f) ? "on" : ""}`}
                    onClick={() => toggleFormat(f)}
                  >
                    <span className="format-btn-label">{f}</span>
                    <span className="format-btn-meta">
                      {f === "markdown" && "Best for RAG and summaries"}
                      {f === "html" && "Keep page structure"}
                      {f === "json" && "Structured raw metadata"}
                      {f === "screenshot" && "Visual fallback for QA"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="input-wrap" style={{ marginTop: 8 }}>
              <label className="flex items-center gap-2" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={enableEntities}
                  onChange={e => setEnableEntities(e.target.checked)}
                />
                <span className="text-sm font-semibold text-white">
                  Enable Entity Resolution
                </span>
                <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/30">
                  LLM INTENSIVE
                </span>
              </label>
              <p className="text-[10px] text-slate-500 mt-1 ml-5">
                Automatically identifies and merges people, companies, and products found in text.
              </p>
            </div>

            {/* Schedule toggle */}
            <div style={{ marginTop: 8, borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
              <label className="flex items-center gap-2" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isScheduled}
                  onChange={e => setIsScheduled(e.target.checked)}
                />
                <span className="text-sm font-semibold" style={{ color: "var(--brand)" }}>
                  Schedule as recurring job
                </span>
              </label>
              {isScheduled && (
                <div className="stack anim-up" style={{ marginTop: 12, padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 8, border: "1px dashed rgba(99,102,241,0.25)" }}>
                  <div className="input-wrap">
                    <label className="input-label">Schedule Name</label>
                    <input
                      placeholder="e.g. Daily Docs Sync"
                      value={scheduleName}
                      onChange={e => setScheduleName(e.target.value)}
                    />
                  </div>
                  <div className="input-wrap">
                    <label className="input-label">Frequency</label>
                    <select value={scheduleCron} onChange={e => setScheduleCron(e.target.value)}>
                      <option value="0 * * * *">Hourly</option>
                      <option value="0 0 * * *">Daily at Midnight</option>
                      <option value="0 0 * * 1">Weekly (Monday)</option>
                      <option value="0 0 1 * *">Monthly (1st)</option>
                      <option value="*/5 * * * *">Every 5 Minutes (Testing)</option>
                    </select>
                    <p className="text-xs text-tertiary" style={{ marginTop: 4 }}>
                      Cron: <code style={{ color: "var(--brand)" }}>{scheduleCron}</code>
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        {err && (
          <div className="msg-banner err">
            <Rocket size={13} /> {err}
          </div>
        )}

        <div className="card">
          <div className="card-footer new-crawl-footer">
            <p className="text-xs text-tertiary">
              Crawl runs asynchronously — you'll be redirected to the live view.
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => nav("/")}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={busy || !canSubmit}
              >
                {busy
                  ? <><span className="spinner" /> {isScheduled ? "Scheduling…" : "Starting…"}</>
                  : isScheduled
                    ? <><Calendar size={14} /> Create Schedule</>
                    : <><Rocket size={14} /> Start Crawl</>}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
