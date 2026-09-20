import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

/* =========================================================
   CONFIG
========================================================= */

const API = "http://127.0.0.1:8000";
const HISTORY_KEY = "reacher-history-v1";
const THEME_KEY = "reacher-theme";
const EMPTY = [];

/* =========================================================
   HELPERS
========================================================= */

function extractUrls(text = "") {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:]+$/, "")))];
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function cleanMarkdown(text = "") {
  return text.replace(/<br\s*\/?>/gi, "\n\n").replace(/\r\n/g, "\n").trim();
}

function makeUrlsClickable(text = "") {
  let result = cleanMarkdown(text);

  // Convert plain URLs into Markdown links.
  result = result.replace(
    /(^|[\s(])((https?:\/\/)[^\s<>"')\]]+)/g,
    (match, prefix, url) => {
      if (match.includes("](")) return match;
      const cleanUrl = url.replace(/[.,;:]+$/, "");
      const punctuation = url.slice(cleanUrl.length);
      return `${prefix}[${getDomain(cleanUrl)}](${cleanUrl})${punctuation}`;
    }
  );

  return result;
}

// Turn numeric citations like [3] into hoverable chips that point at source #3.
function linkCitations(text = "", sources = []) {
  return text.replace(/\[(\d{1,2})\](?![(:])/g, (m, n) =>
    sources[Number(n) - 1] ? `[${n}](#cite-${n})` : m
  );
}

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const toText = (v) =>
  typeof v === "string" ? v : v ? JSON.stringify(v) : "";

const countWords = (t = "") => {
  const s = t.trim();
  return s ? s.split(/\s+/).length : 0;
};

const favicon = (url) =>
  `https://www.google.com/s2/favicons?domain=${getDomain(url)}&sz=64`;

const textOf = (n) =>
  typeof n === "string"
    ? n
    : Array.isArray(n)
    ? n.map(textOf).join("")
    : n?.props?.children
    ? textOf(n.props.children)
    : "";

const timeAgo = (ts) => {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const load = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
};

function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeShare(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ---------- voice helpers (Web Speech API) ---------- */

const SR =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

const TTS = typeof window !== "undefined" && "speechSynthesis" in window;

// Markdown report → clean plain text that sounds natural when read aloud.
function toSpeechText(md = "") {
  const body = cleanMarkdown(md).split(/^\s{0,3}#{1,6}\s*(?:sources?|references?)\b/im)[0];

  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|#)[^)]*\)/g, "$1")
    .replace(/\[(\d{1,2})\]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, "$1.")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\|?[\s:|-]+\|?$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[*_~>]+/g, "")
    .replace(/\n+/g, ". ")
    .replace(/([.!?:,])(\s*[.,])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Split into short chunks — browsers cut off very long utterances.
function chunkSpeech(text = "") {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [];
  const chunks = [];
  let cur = "";

  sentences.forEach((s) => {
    if ((cur + s).length > 220 && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  });

  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/* =========================================================
   HOOKS / SMALL COMPONENTS
========================================================= */

// Reveals text word-by-word (like ChatGPT / Perplexity).
function useStreamedText(text, enabled, { onTick, onDone } = {}) {
  const tokens = useMemo(() => text.split(/(\s+)/), [text]);
  const [count, setCount] = useState(enabled ? 0 : tokens.length);
  const skipRef = useRef(false);
  const cb = useRef({});
  cb.current = { onTick, onDone };

  useLayoutEffect(() => {
    skipRef.current = false;

    if (!enabled) {
      setCount(tokens.length);
      return;
    }

    setCount(0);
    let c = 0;
    const step = Math.max(4, Math.ceil(tokens.length / 450));

    const id = setInterval(() => {
      if (skipRef.current) {
        clearInterval(id);
        return;
      }
      c = Math.min(c + step, tokens.length);
      setCount(c);
      cb.current.onTick?.();
      if (c >= tokens.length) {
        clearInterval(id);
        cb.current.onDone?.();
      }
    }, 30);

    return () => clearInterval(id);
  }, [tokens, enabled]);

  const skip = useCallback(() => {
    skipRef.current = true;
    setCount(tokens.length);
    cb.current.onDone?.();
  }, [tokens]);

  const shown = useMemo(() => tokens.slice(0, count).join(""), [tokens, count]);

  return { shown, done: count >= tokens.length, skip, words: countWords(shown) };
}

// Number that smoothly ticks up/down to its target value.
function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    const duration = 350;
    let raf;

    const step = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const v = Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      fromRef.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className="tick">{display.toLocaleString()}</span>;
}

function StreamedMarkdown({ text, animate, components, onTick }) {
  const { shown } = useStreamedText(text, animate, { onTick });
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {shown}
    </ReactMarkdown>
  );
}

/* Simulated live narration. Replace with real events from your
   backend (SSE / websocket) whenever you add streaming there. */
const SCRIPT = [
  { at: 0, phase: 0, text: "Search Agent is scanning the web for recent sources…" },
  { at: 1800, phase: 0, sources: 4, text: "Found 4 sources so far…" },
  { at: 3500, phase: 0, sources: 9, text: "Found 9 sources — ranking by relevance…" },
  { at: 5200, phase: 0, sources: 12, text: "Found 12 sources — shortlisting the best ones…" },
  { at: 6500, phase: 1, text: "Reader Agent is opening the most relevant page…" },
  { at: 9000, phase: 1, text: "Extracting key facts, figures and quotes…" },
  { at: 12000, phase: 2, text: "Writer Agent is outlining the report…" },
  { at: 15000, phase: 2, text: "Drafting the findings section…" },
  { at: 18500, phase: 2, text: "Polishing the conclusion and adding sources…" },
  { at: 21500, phase: 3, text: "Critic Agent is checking clarity and unsupported claims…" },
  { at: 27000, phase: 3, text: "Almost there — finalising the review…" },
];

const AGENTS = [
  { icon: "⌕", name: "Search Agent", note: "Finding relevant sources" },
  { icon: "◈", name: "Reader Agent", note: "Analyzing source content" },
  { icon: "✦", name: "Writer Agent", note: "Building research report" },
  { icon: "✓", name: "Critic Agent", note: "Checking final quality" },
];

const CONFETTI_COLORS = ["#3b82f6", "#60a5fa", "#22c55e", "#f59e0b", "#ec4899", "#a78bfa"];

/* =========================================================
   APP
========================================================= */

function App() {
  /* ---------- core state ---------- */
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState("report");
  const [selectedMode, setSelectedMode] = useState("deep");
  const [expandedFeature, setExpandedFeature] = useState(null);
  const [expandedReport, setExpandedReport] = useState(false);

  /* ---------- new state ---------- */
  const [theme, setTheme] = useState(() => load(THEME_KEY, "light"));
  const [animateReport, setAnimateReport] = useState(false);
  const [sharedView, setSharedView] = useState(false);

  const [phase, setPhase] = useState(0);
  const [feed, setFeed] = useState([]);
  const [simSources, setSimSources] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const [history, setHistory] = useState(() => load(HISTORY_KEY, []));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const [preview, setPreview] = useState(null);
  const [selBtn, setSelBtn] = useState(null);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);

  const [celebrate, setCelebrate] = useState(0);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);

  /* voice input + read-aloud */
  const [listening, setListening] = useState(false);
  const [speechState, setSpeechState] = useState("idle"); // idle | playing | paused
  const [speechRate, setSpeechRate] = useState(1);
  const [speechProgress, setSpeechProgress] = useState(0);

  /* ---------- refs ---------- */
  const researchRef = useRef(null);
  const scrollRef = useRef(null);
  const articleRef = useRef(null);
  const stickRef = useRef(true);
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const paletteInputRef = useRef(null);
  const toastTimer = useRef(null);
  const recogRef = useRef(null);
  const sessionRef = useRef(0);
  const chunksRef = useRef([]);
  const indexRef = useRef(0);
  const rateRef = useRef(1);
  const utterRef = useRef(null);

  const isMac =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");

  /* ---------- derived ---------- */
  const sourceUrls = result?.sources || EMPTY;

  const reportMarkdownFull = useMemo(
    () => linkCitations(makeUrlsClickable(result?.report || ""), sourceUrls),
    [result, sourceUrls]
  );

  const autoScroll = () => {
    const sc = scrollRef.current;
    const ar = articleRef.current;
    if (!sc || !ar || !stickRef.current) return;
    sc.scrollTop = ar.offsetTop + ar.offsetHeight - sc.clientHeight + 30;
  };

  const {
    shown: streamedReport,
    done: streamDone,
    skip: skipStream,
    words: wordsWritten,
  } = useStreamedText(reportMarkdownFull, animateReport && !!result, {
    onTick: autoScroll,
    onDone: () => {
      if (animateReport) setCelebrate(Date.now());
    },
  });

  const streaming = animateReport && !!result && !streamDone;
  const totalWords = countWords(result?.report || "");
  const readMinutes = Math.max(1, Math.ceil(totalWords / 220));

  const related = useMemo(() => {
    if (!result) return [];
    const heads = [...(result.report || "").matchAll(/^#{2,3}\s+(.+)$/gm)]
      .map((m) =>
        m[1].replace(/[*_`#]/g, "").replace(/^\d+[.)]\s*/, "").trim()
      )
      .filter(
        (h) =>
          h.length > 3 &&
          h.length < 70 &&
          !/^(sources?|references?|conclusion|summary|introduction|executive summary|overview|key findings?)/i.test(
            h
          )
      );

    return [
      ...heads.slice(0, 2).map((h) => `What should I know about ${h}?`),
      "What are the main challenges or criticisms around this topic?",
      "What is likely to happen next?",
      "Give me a beginner-friendly summary.",
    ].slice(0, 4);
  }, [result]);

  const confetti = useMemo(
    () =>
      celebrate
        ? Array.from({ length: 42 }, (_, i) => ({
            id: i,
            left: Math.random() * 100,
            delay: Math.random() * 0.5,
            dur: 2.2 + Math.random() * 1.6,
            size: 6 + Math.random() * 7,
            rot: Math.random() * 360,
            color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          }))
        : [],
    [celebrate]
  );

  /* ---------- voice input (speech → text) ---------- */

  const toggleVoice = () => {
    if (!SR) {
      showToast("Voice input isn't supported in this browser. Try Chrome, Edge or Safari.");
      return;
    }

    if (listening) {
      recogRef.current?.stop();
      return;
    }

    if (loading) return;

    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => setListening(true);

    rec.onresult = (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("")
        .trim();
      setTopic(text);
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        showToast("Microphone access is blocked. Allow it in your browser settings.");
      } else if (e.error === "no-speech") {
        showToast("Didn't catch that — tap the mic and try again.");
      } else if (e.error !== "aborted") {
        showToast("Voice input stopped unexpectedly.");
      }
    };

    rec.onend = () => {
      setListening(false);
      recogRef.current = null;
    };

    try {
      recogRef.current = rec;
      rec.start();
    } catch {
      setListening(false);
    }
  };

  /* ---------- read-aloud (text → speech) ---------- */

  const speakChunk = (i, session) => {
    if (session !== sessionRef.current) return;

    const chunks = chunksRef.current;

    if (i >= chunks.length) {
      setSpeechState("idle");
      setSpeechProgress(0);
      return;
    }

    indexRef.current = i;
    setSpeechProgress(i / chunks.length);

    const u = new SpeechSynthesisUtterance(chunks[i]);
    u.rate = rateRef.current;
    u.lang = navigator.language || "en-US";
    u.onend = () => speakChunk(i + 1, session);
    u.onerror = (e) => {
      if (session !== sessionRef.current) return;
      if (e.error === "canceled" || e.error === "interrupted") return;
      setSpeechState("idle");
    };

    utterRef.current = u; // keep a reference so Chrome doesn't garbage-collect it
    window.speechSynthesis.speak(u);
  };

  const stopSpeaking = () => {
    sessionRef.current++;
    if (TTS) window.speechSynthesis.cancel();
    setSpeechState("idle");
    setSpeechProgress(0);
  };

  const startSpeaking = () => {
    if (!TTS) {
      showToast("Read-aloud isn't supported in this browser.");
      return;
    }
    if (!result?.report) return;

    const chunks = chunkSpeech(toSpeechText(result.report));
    if (!chunks.length) return;

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();

    const session = ++sessionRef.current;
    chunksRef.current = [`${result.topic}.`, ...chunks];
    setSpeechState("playing");
    setTimeout(() => speakChunk(0, session), 60);
  };

  const togglePause = () => {
    if (speechState === "playing") {
      window.speechSynthesis.pause();
      setSpeechState("paused");
    } else if (speechState === "paused") {
      window.speechSynthesis.resume();
      setSpeechState("playing");
    }
  };

  const changeRate = (r) => {
    rateRef.current = r;
    setSpeechRate(r);
    if (speechState === "idle") return;

    // restart the current chunk at the new speed
    const session = ++sessionRef.current;
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    setSpeechState("playing");
    setTimeout(() => speakChunk(indexRef.current, session), 60);
  };

  /* ---------- effects ---------- */

  // Stop reading aloud whenever the report changes (new research, history, shared link)
  useEffect(() => {
    sessionRef.current++;
    if (TTS) window.speechSynthesis.cancel();
    setSpeechState("idle");
    setSpeechProgress(0);
  }, [result?.id]);

  // Release the mic + speaker when leaving the page
  useEffect(() => {
    const stopAll = () => {
      if (TTS) window.speechSynthesis.cancel();
      recogRef.current?.abort?.();
    };
    window.addEventListener("beforeunload", stopAll);
    return () => {
      window.removeEventListener("beforeunload", stopAll);
      stopAll();
    };
  }, []);

  // Theme
  useEffect(() => {
    save(THEME_KEY, theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  // History persistence
  useEffect(() => {
    save(HISTORY_KEY, history);
  }, [history]);

  // Scroll-reveal animations
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");

    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in-view"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("in-view");
            io.unobserve(en.target);
          }
        }),
      { threshold: 0.12 }
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Open a shared report link (#share=...)
  useEffect(() => {
    const m = window.location.hash.match(/^#share=(.+)$/);
    if (!m) return;
    try {
      const d = decodeShare(m[1]);
      setResult({
        id: "shared",
        topic: d.t,
        report: d.r,
        feedback: d.f || "",
        sources: d.s || [],
      });
      setTopic(d.t || "");
      setSharedView(true);
      setAnimateReport(false);
      setTimeout(
        () =>
          researchRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        400
      );
    } catch (err) {
      console.error("Invalid share link", err);
    }
  }, []);

  // Live narration while loading
  useEffect(() => {
    if (!loading) return;

    setFeed([]);
    setPhase(0);
    setSimSources(0);
    setElapsed(0);

    const timers = SCRIPT.map((s) =>
      setTimeout(() => {
        setPhase(s.phase);
        if (s.sources) setSimSources(s.sources);
        setFeed((f) => [...f, { id: uid(), text: s.text }]);
      }, s.at)
    );
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);

    return () => {
      timers.forEach(clearTimeout);
      clearInterval(tick);
    };
  }, [loading]);

  // Confetti / completion toast auto-clear
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(0), 3800);
    return () => clearTimeout(t);
  }, [celebrate]);

  // Global keyboard shortcuts (Cmd/Ctrl + K, Esc)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        setPaletteQuery("");
        setPaletteIndex(0);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setHistoryOpen(false);
        setSelBtn(null);
        setPreview(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (paletteOpen) setTimeout(() => paletteInputRef.current?.focus(), 30);
  }, [paletteOpen]);

  // Hide the "Explain this further" button when clicking elsewhere
  useEffect(() => {
    const h = (e) => {
      if (!e.target.closest?.(".selection-btn")) setSelBtn(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  /* ---------- small utilities ---------- */

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  };

  const scrollToId = (id) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const scrollToInput = () =>
    setTimeout(
      () =>
        document.getElementById("research-input")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        }),
      50
    );

  const goTab = (tab) => {
    setActiveTab(tab);
    setTimeout(
      () =>
        researchRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      60
    );
  };

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const showPreview = useCallback((el, url, label) => {
    const r = el.getBoundingClientRect();
    const W = 320;
    const x = Math.max(12, Math.min(r.left, window.innerWidth - W - 12));
    const below = r.bottom + 150 < window.innerHeight;
    setPreview({ url, label, x, y: below ? r.bottom + 8 : r.top - 8, above: !below });
  }, []);

  /* ---------- research ---------- */

  const runResearch = async (value) => {
    const q = (typeof value === "string" ? value : topic).trim();
    if (!q || loading) return;

    setTopic(q);
    setLoading(true);
    setError("");
    setResult(null);
    setChat([]);
    setSharedView(false);
    setAnimateReport(false);
    setActiveTab("report");
    setExpandedReport(false);
    setHistoryOpen(false);
    stickRef.current = true;
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    try {
      const response = await fetch(`${API}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: q }),
      });

      if (!response.ok) throw new Error("Research request failed");

      const data = await response.json();

      const sources = extractUrls(
        [toText(data.search_results), toText(data.scraped_content), toText(data.report)].join("\n")
      );

      const entry = {
        id: uid(),
        topic: data.topic || q,
        report: toText(data.report),
        feedback: toText(data.feedback),
        sources,
        createdAt: Date.now(),
        pinned: false,
      };

      setResult(entry);
      setAnimateReport(true);
      setHistory((h) => [entry, ...h].slice(0, 50));

      setTimeout(() => {
        researchRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 150);
    } catch (err) {
      console.error(err);
      setError(
        "The research service is temporarily unavailable. Please try again later."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResearch = () => runResearch(topic);

  const pickTopic = (value) => {
    setTopic(value);
    scrollToInput();
  };

  const newResearch = () => {
    setResult(null);
    setError("");
    setTopic("");
    setChat([]);
    setSharedView(false);
    setAnimateReport(false);
    setActiveTab("report");
    setExpandedReport(false);
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    scrollToInput();
  };

  /* ---------- report actions ---------- */

  const copyReport = async () => {
    if (!result?.report) return;
    try {
      await navigator.clipboard.writeText(cleanMarkdown(result.report));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const downloadReport = () => {
    if (!result?.report) return;

    const blob = new Blob([cleanMarkdown(result.report)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${
      (result.topic || topic)
        .trim()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "research-report"
    }.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const printReport = () => window.print();

  const shareReport = async () => {
    if (!result) return;
    const payload = {
      topic: result.topic,
      report: result.report,
      feedback: result.feedback,
      sources: result.sources,
    };
    let url = "";

    // 1) Preferred: your backend creates a public link (needed for OG preview cards).
    try {
      const r = await fetch(`${API}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        const d = await r.json();
        url = d.url || "";
      }
    } catch {
      /* fall through to the offline link */
    }

    // 2) Fallback: self-contained link with the report encoded in the URL.
    if (!url) {
      url = `${window.location.origin}${window.location.pathname}#share=${encodeShare({
        t: result.topic,
        r: result.report,
        f: result.feedback,
        s: result.sources,
      })}`;
    }

    try {
      await navigator.clipboard.writeText(url);
      showToast("Share link copied to clipboard");
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  /* ---------- follow-up chat ---------- */

  const askFollowUp = async (question, display) => {
    const q = question.trim();
    if (!q || chatLoading || !result) return;

    setActiveTab("report");
    setChat((c) => [...c, { id: uid(), role: "user", content: q, display }]);
    setChatInput("");
    setChatLoading(true);
    setTimeout(
      () => chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      80
    );

    try {
      let answer = "";

      // Preferred: dedicated /followup endpoint on your backend.
      try {
        const r = await fetch(`${API}/followup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: result.topic,
            report: result.report,
            question: q,
            history: chat.map(({ role, content }) => ({ role, content })),
          }),
        });
        if (r.ok) {
          const d = await r.json();
          answer = d.answer || d.report || "";
        }
      } catch {
        /* fall back below */
      }

      // Fallback: reuse /research with the question + context.
      if (!answer) {
        const r = await fetch(`${API}/research`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: `${q} (in the context of: ${result.topic})`,
          }),
        });
        if (!r.ok) throw new Error("Follow-up failed");
        const d = await r.json();
        answer = d.report || "";
      }

      if (!answer) throw new Error("Empty answer");

      setChat((c) => [
        ...c,
        { id: uid(), role: "assistant", content: cleanMarkdown(answer), animate: true },
      ]);
    } catch {
      setChat((c) => [
        ...c,
        {
          id: uid(),
          role: "assistant",
          content: "I couldn't reach the research service. Please try again.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  /* ---------- highlight-to-expand ---------- */

  const handleSelection = () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 12 || !sel.rangeCount) {
        setSelBtn(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setSelBtn({
        text: text.slice(0, 600),
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    }, 0);
  };

  const explainSelection = () => {
    if (!selBtn) return;
    const t = selBtn.text;
    askFollowUp(
      `Explain this further, with more detail and context: "${t}"`,
      `Explain further: “${t.length > 140 ? t.slice(0, 140) + "…" : t}”`
    );
    window.getSelection()?.removeAllRanges();
    setSelBtn(null);
  };

  /* ---------- history ---------- */

  const sortedHistory = useMemo(
    () =>
      [...history].sort(
        (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt - a.createdAt
      ),
    [history]
  );

  const openFromHistory = (entry) => {
    setResult(entry);
    setTopic(entry.topic);
    setAnimateReport(false);
    setSharedView(false);
    setChat([]);
    setActiveTab("report");
    setExpandedReport(false);
    setHistoryOpen(false);
    setTimeout(
      () =>
        researchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      250
    );
  };

  const togglePin = (id) =>
    setHistory((h) => h.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e)));

  const deleteEntry = (id) => setHistory((h) => h.filter((e) => e.id !== id));

  const commitRename = () => {
    const v = editValue.trim();
    if (editingId && v) {
      setHistory((h) => h.map((e) => (e.id === editingId ? { ...e, title: v } : e)));
    }
    setEditingId(null);
  };

  /* ---------- command palette ---------- */

  const pq = paletteQuery.trim();

  const commands = [
    ...(pq
      ? [{ id: "run", icon: "⌕", label: `Research “${pq}”`, run: () => runResearch(pq) }]
      : []),
    { id: "new", icon: "+", label: "New research", run: newResearch },
    {
      id: "theme",
      icon: theme === "dark" ? "☀" : "☾",
      label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
      run: toggleTheme,
    },
    { id: "history", icon: "↺", label: "Open history", run: () => setHistoryOpen(true) },
    {
      id: "voice",
      icon: "🎙",
      label: listening ? "Stop voice input" : "Start voice input",
      run: () => {
        scrollToInput();
        toggleVoice();
      },
    },
    ...(result
      ? [
          { id: "t-report", icon: "✦", label: "Go to Report", run: () => goTab("report") },
          { id: "t-sources", icon: "◎", label: "Go to Sources", run: () => goTab("sources") },
          { id: "t-review", icon: "✓", label: "Go to AI Review", run: () => goTab("review") },
          {
            id: "followup",
            icon: "↳",
            label: "Ask a follow-up",
            run: () => {
              goTab("report");
              setTimeout(() => {
                chatInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                chatInputRef.current?.focus();
              }, 350);
            },
          },
          {
            id: "listen",
            icon: "🔊",
            label: speechState === "idle" ? "Read report aloud" : "Stop reading aloud",
            run: () => (speechState === "idle" ? (goTab("report"), startSpeaking()) : stopSpeaking()),
          },
          { id: "copy", icon: "⧉", label: "Copy report", run: copyReport },
          { id: "download", icon: "↓", label: "Download report (.md)", run: downloadReport },
          { id: "share", icon: "⤴", label: "Share report link", run: shareReport },
          { id: "print", icon: "⎙", label: "Print report", run: printReport },
          {
            id: "expand",
            icon: "⤢",
            label: expandedReport ? "Collapse report" : "Expand report",
            run: () => setExpandedReport((v) => !v),
          },
        ]
      : []),
    { id: "features", icon: "◈", label: "Go to Features", run: () => scrollToId("features") },
    { id: "about", icon: "ⓘ", label: "Go to About", run: () => scrollToId("about") },
  ];

  const filteredCommands = pq
    ? commands.filter((c) => c.id === "run" || c.label.toLowerCase().includes(pq.toLowerCase()))
    : commands;

  const runCommand = (c) => {
    if (!c) return;
    setPaletteOpen(false);
    setPaletteQuery("");
    c.run();
  };

  const onPaletteKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPaletteIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPaletteIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCommand(filteredCommands[paletteIndex]);
    }
  };

  /* ---------- markdown renderers (hover-preview citations) ---------- */

  const mdComponents = useMemo(
    () => ({
      a: ({ node, href, children }) => {
        const cite = href?.match(/^#cite-(\d+)$/);
        const url = cite ? sourceUrls[Number(cite[1]) - 1] : href;
        if (!url) return <>{children}</>;
        const label = cite ? `Source ${cite[1]}` : textOf(children);

        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cite ? "cite-chip" : undefined}
            onMouseEnter={(e) => showPreview(e.currentTarget, url, label)}
            onMouseLeave={() => setPreview(null)}
            onFocus={(e) => showPreview(e.currentTarget, url, label)}
            onBlur={() => setPreview(null)}
          >
            {children}
          </a>
        );
      },

      table: ({ node, ...props }) => (
        <div className="table-wrapper">
          <table {...props} />
        </div>
      ),

      blockquote: ({ node, ...props }) => (
        <blockquote className="report-quote" {...props} />
      ),

      code: ({ node, inline, className, children, ...props }) => {
        const isInline = inline ?? (!className && !String(children).includes("\n"));
        return isInline ? (
          <code className="inline-code" {...props}>
            {children}
          </code>
        ) : (
          <pre className="code-block">
            <code {...props}>{children}</code>
          </pre>
        );
      },
    }),
    [sourceUrls, showPreview]
  );

  /* ---------- static content ---------- */

  const featureData = [
    {
      id: "search",
      icon: "⌕",
      number: "01",
      title: "Web Intelligence",
      tag: "SEARCH AGENT",
      description:
        "Search the web for recent information and discover relevant sources before the report is written.",
      detail:
        "REACHER sends the research topic to its dedicated search agent, which uses your configured web search tool to find relevant sources.",
    },
    {
      id: "analysis",
      icon: "◈",
      number: "02",
      title: "Deep Analysis",
      tag: "READER AGENT",
      description:
        "Relevant resources are read and analyzed before information is passed to the writer.",
      detail:
        "The reader agent selects a relevant source and retrieves deeper content so the writer has more than just search snippets.",
    },
    {
      id: "writing",
      icon: "✦",
      number: "03",
      title: "Structured Reports",
      tag: "WRITER AGENT",
      description:
        "Scattered research is transformed into a structured and readable report.",
      detail:
        "The writer agent receives the collected research material and produces an organized report with findings, conclusion and sources.",
    },
    {
      id: "review",
      icon: "✓",
      number: "04",
      title: "AI Quality Review",
      tag: "CRITIC AGENT",
      description:
        "A dedicated critic checks the generated report for clarity, structure and unsupported claims.",
      detail:
        "The critic agent reviews the final report independently and provides strengths, areas to improve and a quality score.",
    },
  ];

  const quickTopics = [
    ["✦", "Artificial Intelligence", "Latest developments in artificial intelligence"],
    ["◈", "Quantum Computing", "Future of quantum computing"],
    ["◎", "Robotics", "Latest advancements in robotics"],
    ["⌘", "AI & Software", "Impact of generative AI on software development"],
  ];

  const modes = [
    { id: "quick", icon: "⚡", badge: "FAST", title: "Quick Research", text: "Get a concise overview of a topic without unnecessary detail.", foot: "Quick overview" },
    { id: "deep", icon: "✦", badge: "POPULAR", title: "Deep Research", text: "Explore sources and generate a detailed research report.", foot: "Detailed analysis", highlight: true },
    { id: "academic", icon: "◇", badge: "ACADEMIC", title: "Academic Research", text: "Focus on structured evidence, findings and methodology.", foot: "Evidence focused" },
  ];

  const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="app" data-theme={theme}>
      {/* BACKGROUND */}
      <div className="grid-background"></div>
      <div className="background-glow glow-one"></div>
      <div className="background-glow glow-two"></div>

      {/* NAVBAR */}
      <nav className="navbar">
        <a href="#home" className="logo">
          <span className="logo-mark">R</span>
          <span>REACHER</span>
        </a>

        <div className="nav-links">
          <a href="#home">Home</a>
          <a href="#research">Research</a>
          <a href="#features">Features</a>
          <a href="#about">About</a>
        </div>

        <div className="nav-actions">
          <button
            className="nav-btn"
            onClick={() => setHistoryOpen(true)}
            aria-label="Open history"
          >
            <span aria-hidden="true">↺</span>
            <span className="nav-btn-label">History</span>
            {history.length > 0 && <b className="nav-count">{history.length}</b>}
          </button>

          <button
            className="nav-btn"
            onClick={() => {
              setPaletteOpen(true);
              setPaletteQuery("");
              setPaletteIndex(0);
            }}
            aria-label="Open command palette"
          >
            <span aria-hidden="true">⌘</span>
            <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </button>

          <button
            className="nav-btn icon-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title="Toggle theme"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>

          <div className="nav-status">
            <span></span>
            AI Research System
          </div>
        </div>
      </nav>

      {/* MAIN */}
      <main className="main-content" id="home">
        {/* HERO */}
        <section className={`hero ${result ? "hero-with-result" : ""}`}>
          <div className="badge">
            <span className="badge-dot"></span>
            MULTI-AGENT AI RESEARCH
          </div>

          <h1>
            Research smarter.
            <br />
            <span>Discover deeper.</span>
          </h1>

          <p className="description">
            REACHER combines multiple AI agents to search the web, analyze
            sources, write reports, and review the final result.
          </p>

          {/* SEARCH */}
          <div className="search-wrapper" id="research-input">
            <div className="search-box">
              <div className="search-icon">⌕</div>

              <input
                type="text"
                placeholder={
                  listening ? "Listening… speak now" : "What would you like to research?"
                }
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleResearch();
                }}
              />

              <button
                type="button"
                className={`mic-btn ${listening ? "listening" : ""}`}
                onClick={toggleVoice}
                disabled={loading}
                aria-label={listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={listening}
                title={listening ? "Stop listening" : "Speak your topic"}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0" />
                  <path d="M12 18v4" />
                </svg>
              </button>

              <button onClick={handleResearch} disabled={loading || !topic.trim()}>
                {loading ? (
                  <>
                    <span className="button-spinner"></span>
                    Researching
                  </>
                ) : (
                  <>
                    Research
                    <span>→</span>
                  </>
                )}
              </button>
            </div>

            <div className="search-meta">
              <span>{listening ? "Listening… speak now" : "Enter to research"}</span>
              <span>AI-powered web research</span>
            </div>
          </div>

          {/* QUICK TOPICS */}
          {!result && !loading && (
            <div className="quick-section">
              <span className="quick-label">TRY A TOPIC</span>
              <div className="quick-topics">
                {quickTopics.map(([icon, label, value]) => (
                  <button key={label} onClick={() => pickTopic(value)}>
                    <span>{icon}</span>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* LOADING WORKSPACE */}
          {loading && (
            <div className="research-loading">
              <div className="loading-header">
                <div>
                  <span className="result-label">REACHER AGENTS</span>
                  <h2>Researching your topic</h2>
                </div>
                <div className="loading-orb">
                  <span></span>
                </div>
              </div>

              <div className="live-stats">
                <div>
                  <AnimatedNumber value={simSources} />
                  <small>Sources found</small>
                </div>
                <div>
                  <AnimatedNumber value={0} />
                  <small>Words written</small>
                </div>
                <div>
                  <span className="tick">{fmtTime(elapsed)}</span>
                  <small>Elapsed</small>
                </div>
              </div>

              <div className="agent-status-grid">
                {AGENTS.map((a, i) => (
                  <div
                    key={a.name}
                    className={`agent-status ${
                      i === phase ? "active" : i < phase ? "done" : ""
                    }`}
                  >
                    <span className="agent-status-icon">{a.icon}</span>
                    <div>
                      <strong>{a.name}</strong>
                      <small>{a.note}</small>
                    </div>
                    {i === phase && <span className="status-loader"></span>}
                    {i < phase && <span className="status-done">✓</span>}
                  </div>
                ))}
              </div>

              <div className="narration" aria-live="polite">
                {feed.slice(-4).map((line, i, arr) => (
                  <div
                    key={line.id}
                    className={`narration-line ${i === arr.length - 1 ? "current" : ""}`}
                  >
                    <span className="narration-dot"></span>
                    {line.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RESEARCH WORKSPACE */}
          {result && (
            <section
              className={`research-workspace ${expandedReport ? "workspace-expanded" : ""}`}
              id="research"
              ref={researchRef}
            >
              {/* HEADER */}
              <div className="workspace-header">
                <div className="workspace-title">
                  <span className="result-label">
                    {sharedView
                      ? "SHARED REPORT · READ-ONLY"
                      : streaming
                      ? "WRITING REPORT"
                      : "RESEARCH COMPLETE"}
                  </span>
                  <h2>{result.topic}</h2>
                </div>

                <button className="new-research-button" onClick={newResearch}>
                  + New Research
                </button>
              </div>

              {/* TABS */}
              <div className="workspace-tabs">
                <button
                  className={activeTab === "report" ? "active" : ""}
                  onClick={() => setActiveTab("report")}
                >
                  <span>✦</span>
                  Report
                </button>

                <button
                  className={activeTab === "sources" ? "active" : ""}
                  onClick={() => setActiveTab("sources")}
                >
                  <span>◎</span>
                  Sources
                  <b>{sourceUrls.length}</b>
                </button>

                <button
                  className={activeTab === "review" ? "active" : ""}
                  onClick={() => setActiveTab("review")}
                >
                  <span>✓</span>
                  AI Review
                </button>
              </div>

              {/* REPORT TAB */}
              {activeTab === "report" && (
                <div className="report-panel">
                  <div className="report-toolbar">
                    {streaming ? (
                      <span className="live-status">
                        <i className="live-dot"></i>
                        Writing…{" "}
                        <b>
                          <AnimatedNumber value={wordsWritten} />
                        </b>{" "}
                        words ·{" "}
                        <b>
                          <AnimatedNumber value={sourceUrls.length} />
                        </b>{" "}
                        sources
                      </span>
                    ) : (
                      <span>
                        {totalWords.toLocaleString()} words · {sourceUrls.length} sources ·{" "}
                        {readMinutes} min read
                      </span>
                    )}

                    <div className="report-actions">
                      {streaming && (
                        <button onClick={skipStream}>Skip animation</button>
                      )}
                      <button
                        className={speechState !== "idle" ? "speaking" : ""}
                        onClick={speechState === "idle" ? startSpeaking : stopSpeaking}
                        disabled={streaming}
                        title={streaming ? "Available when the report finishes" : "Read the report aloud"}
                      >
                        {speechState === "idle" ? "🔊 Listen" : "■ Stop"}
                      </button>
                      <button onClick={copyReport}>{copied ? "Copied ✓" : "Copy"}</button>
                      <button onClick={downloadReport}>Download</button>
                      <button onClick={printReport}>Print</button>
                      <button onClick={shareReport}>Share</button>
                      <button onClick={() => setExpandedReport(!expandedReport)}>
                        {expandedReport ? "Collapse" : "Expand"}
                      </button>
                    </div>
                  </div>

                  {speechState !== "idle" && (
                    <div className={`listen-bar ${speechState}`}>
                      <span className="listen-eq" aria-hidden="true">
                        <i></i>
                        <i></i>
                        <i></i>
                      </span>
                      <span className="listen-label">
                        {speechState === "paused" ? "Paused" : "Reading aloud"}
                      </span>

                      <button
                        className="listen-btn"
                        onClick={togglePause}
                        aria-label={speechState === "paused" ? "Resume" : "Pause"}
                      >
                        {speechState === "paused" ? "▶" : "❚❚"}
                      </button>
                      <button className="listen-btn" onClick={stopSpeaking} aria-label="Stop">
                        ■
                      </button>

                      <div className="listen-progress" aria-hidden="true">
                        <span style={{ width: `${Math.round(speechProgress * 100)}%` }}></span>
                      </div>

                      <div className="listen-rate">
                        {[1, 1.25, 1.5, 2].map((r) => (
                          <button
                            key={r}
                            className={speechRate === r ? "on" : ""}
                            onClick={() => changeRate(r)}
                          >
                            {r}×
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div
                    className="report-scroll"
                    ref={scrollRef}
                    onScroll={() => setPreview(null)}
                    onWheel={(e) => {
                      if (e.deltaY < 0) stickRef.current = false;
                    }}
                    onTouchMove={() => {
                      stickRef.current = false;
                    }}
                  >
                    <article
                      ref={articleRef}
                      className={`report-content ${streaming ? "streaming" : ""}`}
                      onMouseUp={handleSelection}
                      onTouchEnd={handleSelection}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {streamedReport}
                      </ReactMarkdown>
                    </article>

                    {streamDone && (
                      <div className="report-extras">
                        {related.length > 0 && (
                          <div className="related">
                            <span className="extras-label">KEEP EXPLORING</span>
                            <div className="related-chips">
                              {related.map((q) => (
                                <button
                                  key={q}
                                  onClick={() => askFollowUp(q)}
                                  disabled={chatLoading}
                                >
                                  <span>↳</span>
                                  {q}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="followup">
                          <span className="extras-label">ASK A FOLLOW-UP</span>

                          {chat.length > 0 && (
                            <div className="chat-thread">
                              {chat.map((m) =>
                                m.role === "user" ? (
                                  <div className="chat-msg user" key={m.id}>
                                    {m.display || m.content}
                                  </div>
                                ) : (
                                  <div
                                    className="chat-msg assistant report-content compact"
                                    key={m.id}
                                  >
                                    <StreamedMarkdown
                                      text={m.content}
                                      animate={!!m.animate}
                                      components={mdComponents}
                                    />
                                  </div>
                                )
                              )}

                              {chatLoading && (
                                <div className="chat-msg assistant typing">
                                  <span></span>
                                  <span></span>
                                  <span></span>
                                </div>
                              )}
                            </div>
                          )}

                          <div ref={chatEndRef}></div>

                          <div className="chat-input">
                            <input
                              ref={chatInputRef}
                              type="text"
                              placeholder="Ask a follow-up about this report…"
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") askFollowUp(chatInput);
                              }}
                            />
                            <button
                              onClick={() => askFollowUp(chatInput)}
                              disabled={chatLoading || !chatInput.trim()}
                            >
                              Ask
                            </button>
                          </div>

                          <small className="chat-tip">
                            Tip: highlight any sentence in the report to get “Explain this
                            further”.
                          </small>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SOURCES TAB */}
              {activeTab === "sources" && (
                <div className="sources-panel">
                  <div className="sources-intro">
                    <span className="result-label">RESEARCH SOURCES</span>
                    <h3>Sources used during research</h3>
                    <p>
                      URLs discovered from the search, scraped content, and generated report.
                    </p>
                  </div>

                  {sourceUrls.length > 0 ? (
                    <div className="source-list">
                      {sourceUrls.map((url, index) => (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="source-card"
                          key={`${url}-${index}`}
                        >
                          <div className="source-number">
                            {String(index + 1).padStart(2, "0")}
                          </div>

                          <img
                            className="source-favicon"
                            src={favicon(url)}
                            alt=""
                            width="20"
                            height="20"
                            loading="lazy"
                            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                          />

                          <div className="source-info">
                            <strong>{getDomain(url)}</strong>
                            <span>{url}</span>
                          </div>

                          <div className="source-arrow">↗</div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div>◎</div>
                      <h3>No URLs were returned</h3>
                      <p>Your current backend response did not contain extractable URLs.</p>
                    </div>
                  )}
                </div>
              )}

              {/* REVIEW TAB */}
              {activeTab === "review" && (
                <div className="review-panel">
                  <div className="review-header">
                    <div>
                      <span className="result-label">CRITIC AGENT</span>
                      <h3>AI Quality Review</h3>
                    </div>
                    <div className="review-icon">✓</div>
                  </div>

                  <div className="review-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {makeUrlsClickable(result.feedback || "No feedback available.")}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* PIPELINE */}
          {!result && !loading && (
            <div className="agent-pipeline">
              <div className="pipeline-title">HOW REACHER WORKS</div>

              <div className="pipeline">
                {[
                  ["⌕", "Search", "Find sources"],
                  ["◈", "Analyze", "Read & compare"],
                  ["✦", "Write", "Build report"],
                  ["✓", "Review", "Check quality"],
                ].map(([icon, title, sub], i) => (
                  <div className="pipeline-fragment" key={title}>
                    {i > 0 && <div className="pipeline-connector"></div>}
                    <div className="pipeline-step">
                      <div className="pipeline-icon">{icon}</div>
                      <div>
                        <strong>{title}</strong>
                        <span>{sub}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* FEATURES */}
        <section className="features-section" id="features">
          <div className="section-heading reveal">
            <div>
              <span className="section-label">RESEARCH ENGINE</span>
              <h2>
                Everything you need
                <br />
                to research better.
              </h2>
            </div>

            <p>
              REACHER turns a simple question into a structured research workflow
              using specialized AI agents.
            </p>
          </div>

          <div className="feature-grid">
            {featureData.map((feature, i) => (
              <div
                className="reveal reveal-cell"
                style={{ "--i": i }}
                key={feature.id}
              >
                <div
                  className={`feature-card ${
                    expandedFeature === feature.id ? "feature-expanded" : ""
                  }`}
                  onClick={() =>
                    setExpandedFeature(expandedFeature === feature.id ? null : feature.id)
                  }
                >
                  <div className="feature-number">{feature.number}</div>
                  <div className="feature-icon">{feature.icon}</div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>

                  {expandedFeature === feature.id && (
                    <div className="feature-detail">{feature.detail}</div>
                  )}

                  <div className="feature-line"></div>

                  <div className="feature-bottom">
                    <span className="feature-tag">{feature.tag}</span>
                    <span className="feature-action">
                      {expandedFeature === feature.id ? "−" : "+"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* RESEARCH MODES */}
        <section className="modes-section">
          <div className="section-heading center-heading reveal">
            <span className="section-label">RESEARCH MODES</span>
            <h2>Choose how you want to research.</h2>
            <p>
              Select a research style for your current workflow. Backend mode controls
              can be connected later.
            </p>
          </div>

          <div className="modes-grid">
            {modes.map((m, i) => (
              <div className="reveal reveal-cell" style={{ "--i": i }} key={m.id}>
                <button
                  className={`mode-card ${m.highlight ? "mode-highlight" : ""} ${
                    selectedMode === m.id ? "mode-selected" : ""
                  }`}
                  onClick={() => setSelectedMode(m.id)}
                >
                  <div className="mode-top">
                    <span className="mode-icon">{m.icon}</span>
                    <span className="mode-badge">{m.badge}</span>
                  </div>

                  <h3>{m.title}</h3>
                  <p>{m.text}</p>

                  <div className="mode-footer">
                    {m.foot}
                    <span>{selectedMode === m.id ? "✓" : "→"}</span>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ABOUT */}
        <section className="about-section" id="about">
          <div className="about-card reveal">
            <div>
              <span className="section-label">ABOUT REACHER</span>
              <h2>
                Research is no longer
                <br />
                just a search box.
              </h2>
            </div>

            <p>
              REACHER is a multi-agent AI research system designed to break complex
              research into smaller intelligent tasks — searching, reading, writing,
              and reviewing.
            </p>
          </div>
        </section>
      </main>

      {/* ERROR */}
      {error && <div className="error">{error}</div>}

      {/* TOAST */}
      {toast && <div className="toast">{toast}</div>}

      {/* FOOTER */}
      <footer>
        <div className="footer-logo">
          <span className="logo-mark">R</span>
          REACHER
        </div>

        <p>Multi-agent AI research system</p>

        <span>Built for deeper research.</span>
      </footer>

      {/* HOVER-PREVIEW CITATION CARD */}
      {preview && (
        <div
          className={`cite-preview ${preview.above ? "above" : ""}`}
          style={{ left: preview.x, top: preview.y }}
        >
          <img src={favicon(preview.url)} alt="" width="28" height="28" />
          <div>
            <strong>{getDomain(preview.url)}</strong>
            {preview.label && preview.label !== getDomain(preview.url) && (
              <em>{preview.label}</em>
            )}
            <span>{preview.url}</span>
          </div>
        </div>
      )}

      {/* HIGHLIGHT-TO-EXPAND BUTTON */}
      {selBtn && (
        <button
          className="selection-btn"
          style={{ left: selBtn.x, top: selBtn.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={explainSelection}
        >
          ✦ Explain this further
        </button>
      )}

      {/* HISTORY DRAWER */}
      <div
        className={`drawer-backdrop ${historyOpen ? "open" : ""}`}
        onClick={() => setHistoryOpen(false)}
      ></div>

      <aside
        className={`drawer ${historyOpen ? "open" : ""}`}
        aria-hidden={!historyOpen}
        aria-label="Research history"
      >
        <div className="drawer-header">
          <div>
            <span className="result-label">HISTORY</span>
            <h3>Past research</h3>
          </div>
          <button className="drawer-close" onClick={() => setHistoryOpen(false)} aria-label="Close history">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {sortedHistory.length === 0 ? (
            <div className="drawer-empty">
              <div>↺</div>
              <p>Your finished research will appear here so you can revisit it anytime.</p>
            </div>
          ) : (
            sortedHistory.map((entry) => (
              <div
                className={`history-item ${result?.id === entry.id ? "current" : ""}`}
                key={entry.id}
              >
                {editingId === entry.id ? (
                  <input
                    className="history-edit"
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <button className="history-main" onClick={() => openFromHistory(entry)}>
                    <strong>
                      {entry.pinned && <span className="pin-mark">★</span>}
                      {entry.title || entry.topic}
                    </strong>
                    <span>
                      {timeAgo(entry.createdAt)} · {entry.sources?.length || 0} sources
                    </span>
                  </button>
                )}

                <div className="history-actions">
                  <button
                    onClick={() => togglePin(entry.id)}
                    title={entry.pinned ? "Unpin" : "Pin"}
                    aria-label={entry.pinned ? "Unpin" : "Pin"}
                    className={entry.pinned ? "on" : ""}
                  >
                    ★
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(entry.id);
                      setEditValue(entry.title || entry.topic);
                    }}
                    title="Rename"
                    aria-label="Rename"
                  >
                    ✎
                  </button>
                  <button onClick={() => deleteEntry(entry.id)} title="Delete" aria-label="Delete">
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {history.length > 0 && (
          <div className="drawer-footer">
            <button
              onClick={() => {
                if (window.confirm("Clear all saved research? Pinned items too.")) {
                  setHistory([]);
                }
              }}
            >
              Clear all history
            </button>
          </div>
        )}
      </aside>

      {/* COMMAND PALETTE */}
      {paletteOpen && (
        <div className="palette-overlay" onClick={() => setPaletteOpen(false)}>
          <div
            className="palette"
            role="dialog"
            aria-label="Command palette"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="palette-input">
              <span>⌘</span>
              <input
                ref={paletteInputRef}
                placeholder="Type a command or a topic to research…"
                value={paletteQuery}
                onChange={(e) => {
                  setPaletteQuery(e.target.value);
                  setPaletteIndex(0);
                }}
                onKeyDown={onPaletteKey}
              />
              <kbd>Esc</kbd>
            </div>

            <div className="palette-list">
              {filteredCommands.map((c, i) => (
                <button
                  key={c.id}
                  className={i === paletteIndex ? "active" : ""}
                  onMouseEnter={() => setPaletteIndex(i)}
                  onClick={() => runCommand(c)}
                >
                  <span className="palette-icon">{c.icon}</span>
                  {c.label}
                  {i === paletteIndex && <kbd>Enter</kbd>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* COMPLETION DELIGHT */}
      {celebrate > 0 && (
        <div className="celebrate" key={celebrate} aria-hidden="true">
          <div className="check-toast">
            <svg viewBox="0 0 52 52" className="check-svg">
              <circle className="check-circle" cx="26" cy="26" r="24" fill="none" />
              <path className="check-path" fill="none" d="M14 27l8 8 16-17" />
            </svg>
            Research complete
          </div>

          {confetti.map((p) => (
            <i
              key={p.id}
              className="confetti-piece"
              style={{
                left: `${p.left}%`,
                width: p.size,
                height: p.size * 0.45,
                background: p.color,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.dur}s`,
                "--rot": `${p.rot}deg`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default App;