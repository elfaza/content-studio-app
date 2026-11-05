"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import {
  ArrowUpRight,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  Flame,
  Home,
  Instagram,
  LayoutGrid,
  Lightbulb,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Video,
  WifiOff,
  X,
  Archive,
  Sun,
  Moon,
} from "lucide-react";
import {
  Dataset,
  Entity,
  RecordData,
  dayAdd,
  engagement,
  number,
  platforms,
  platformPrefix,
  type Platform,
  stage,
  stages,
  sum,
  cancelIdeaSchedules,
  today,
} from "@/lib/domain";
import { platformPerformance, averageWatchedPercent } from "@/lib/performance";
import { PublishedPlatforms, ObservationHistory } from "./published-platforms";
import { InstagramSettings } from "./instagram-settings";
import { TikTokSettings } from "./tiktok-settings";
import { PerformanceTracker } from "./performance-tracker";
import { Dialog } from "./ui/dialog";
import Editor from "./editor";
import { CancelIdeaDialog } from "./cancel-idea-dialog";
import { CategoryChart, ViewsChart } from "./charts";
const pages = [
  { slug: "dashboard", name: "Overview", icon: Home },
  { slug: "pipeline", name: "Content pipeline", icon: LayoutGrid },
  { slug: "calendar", name: "Calendar", icon: CalendarDays },
  { slug: "ideas", name: "Idea library", icon: Lightbulb },
  { slug: "published", name: "Published content", icon: Clapperboard },
  { slug: "analytics", name: "Analytics", icon: BarChart3 },
  { slug: "performance", name: "Performance tracker", icon: TrendingUp },
  { slug: "settings", name: "Settings", icon: Settings },
];
const fmt = (n: number | null, digits = 0) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("en", {
        maximumFractionDigits: digits,
        notation: n >= 10000 ? "compact" : "standard",
      }).format(n);
const dateLabel = (d: string) =>
  d
    ? new Date(d + "T12:00:00+07:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Jakarta",
      })
    : "Not recorded";
function PlatformIcon({ platform }: { platform: string }) {
  return (
    <span className={"platform-icon " + platform.toLowerCase()}>
      {platform === "Instagram" ? (
        <Instagram size={14} />
      ) : platform === "TikTok" ? (
        <span className="music-note">♪</span>
      ) : (
        <Video size={14} />
      )}
    </span>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + stage(status).toLowerCase()}>
      <i />
      {status || "Idea"}
    </span>
  );
}
async function fetcher(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(body.error || "Connection failed"), {
      reconnect: body.reconnect === true,
    });
  if (
    url === "/api/studio" &&
    body.mode === "demo" &&
    body.persistence === "browser"
  ) {
    const cached = localStorage.getItem("cs-hosted-demo");
    if (cached) {
      try {
        const saved = JSON.parse(cached);
        if (saved.mode === "demo" && saved.persistence === "browser")
          return { ...saved, syncedAt: body.syncedAt };
      } catch {
        localStorage.removeItem("cs-hosted-demo");
      }
    }
  }
  return body;
}
type Editing = {
  entity: Entity;
  record?: Partial<RecordData>;
  title: string;
  publishIdeaId?: string;
};
export default function Studio() {
  const path = usePathname().split("/")[1] || "dashboard",
    page = pages.find((p) => p.slug === path) ?? pages[0];
  const [session, setSession] = useState<
      "loading" | "locked" | "open" | "offline"
    >("loading"),
    [configured, setConfigured] = useState(true),
    [password, setPassword] = useState(""),
    [loginError, setLoginError] = useState(""),
    [loggingIn, setLoggingIn] = useState(false);
  const [offlineData, setOfflineData] = useState<Dataset | null>(null),
    [online, setOnline] = useState(true),
    [editing, setEditing] = useState<Editing | null>(null),
    [cancelling, setCancelling] = useState<RecordData | null>(null),
    [notice, setNotice] = useState(""),
    [menu, setMenu] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("All categories"),
    [platform, setPlatform] = useState("All platforms"),
    [analyticsPlatform, setAnalyticsPlatform] = useState<Platform>("Instagram"),
    [statusFilter, setStatusFilter] = useState("All stages"),
    [sort, setSort] = useState("recent"),
    [archived, setArchived] = useState(false),
    [days, setDays] = useState("30"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(today()),
    [month, setMonth] = useState(today().slice(0, 7) + "-01"),
    [calendarView, setCalendarView] = useState("month"),
    [week, setWeek] = useState(today()),
    [light, setLight] = useState(true);
  const {
    data: fresh,
    error,
    isLoading,
    mutate,
    isValidating,
  } = useSWR<Dataset>(session === "open" ? "/api/studio" : null, fetcher, {
    refreshInterval: 45000,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    shouldRetryOnError: false,
    onSuccess: (data) => {
      const savedTheme = localStorage.getItem("cs-ui-theme");
      if (savedTheme) setLight(savedTheme === "light");
      else if (data.settings[0]?.theme)
        setLight(data.settings[0].theme === "light");
    },
  });
  const dataset = fresh ?? offlineData;
  useEffect(() => {
    async function init() {
      try {
        const s = await fetcher("/api/session");
        const preferredPlatform = localStorage.getItem("cs-analytics-platform");
        if (platforms.includes(preferredPlatform as Platform))
          setAnalyticsPlatform(preferredPlatform as Platform);
        const savedTheme = localStorage.getItem("cs-ui-theme");
        if (savedTheme) setLight(savedTheme === "light");
        setConfigured(s.configured);
        setSession(s.authorized ? "open" : "locked");
        if (!s.authorized) localStorage.removeItem("cs-offline");
      } catch {
        const cached = localStorage.getItem("cs-offline");
        if (cached) {
          setOfflineData(JSON.parse(cached));
          setSession("offline");
        } else setSession("locked");
      }
    }
    void init();
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js");
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (fresh) {
      localStorage.setItem("cs-offline", JSON.stringify(fresh));
    }
  }, [fresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
  }, [light]);

  const notify = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 5500);
  }, []);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [needsGoogle, setNeedsGoogle] = useState(false);
  const connectGoogle = async () => {
    setConnectingGoogle(true);
    try {
      const response = await fetch("/api/google", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.assign(result.url);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not connect Google.");
      setConnectingGoogle(false);
    }
  };
  const save = async (
    entity: Entity,
    record: Record<string, string>,
    current = dataset,
    closeEditor = true,
  ) => {
    if (!online || session === "offline")
      throw new Error("Reconnect before editing. Offline mode is read-only.");
    const response = await fetch("/api/studio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity,
        data: record,
        ...(current?.persistence === "browser" ? { demoState: current } : {}),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      if (body.reconnect) setNeedsGoogle(true);
      throw new Error(body.error);
    }
    if (closeEditor) setEditing(null);
    let updated: Dataset | undefined;
    if (current?.persistence === "browser") {
      const next = {
        ...current,
        [entity]: current[entity].some((r) => r.id === body.id)
          ? current[entity].map((r) => (r.id === body.id ? body : r))
          : [...current[entity], body],
        ...(entity === "ideas" && stage(body.status) === "Cancelled"
          ? {
              schedule: cancelIdeaSchedules(
                current.schedule,
                body.id,
                body.version,
              ),
            }
          : {}),
        syncedAt: new Date().toISOString(),
      };
      localStorage.setItem("cs-hosted-demo", JSON.stringify(next));
      updated = await mutate(next, { revalidate: false });
    } else updated = await mutate();
    notify(
      current?.mode === "demo"
        ? "Saved to demo workspace"
        : "Saved to Google Sheets",
    );
    return updated;
  };
  const quickSave = async (
    entity: Entity,
    record: RecordData,
    changes: Record<string, string>,
  ) => {
    if (entity === "ideas" && changes.status === "Cancelled") {
      setCancelling(record);
      return;
    }
    if (
      entity === "ideas" &&
      changes.status === "Published" &&
      !dataset?.videos.some((v) => v.ideaId === record.id)
    ) {
      openPublishedPost(record);
      return;
    }
    try {
      await save(entity, { ...record, ...changes });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save");
    }
  };
  const canWrite = !!dataset?.writable && online && session === "open";
  const activeIdeas = (dataset?.ideas ?? []).filter(
    (i) => (i.archived === "true") === archived,
  );
  const categories = [
    ...new Set(
      [...(dataset?.ideas ?? []), ...(dataset?.videos ?? [])]
        .map((i) => i.category)
        .filter(Boolean),
    ),
  ].sort();
  const matches = (r: RecordData) =>
    r.title?.toLowerCase().includes(query.toLowerCase()) &&
    (category === "All categories" || r.category === category) &&
    (platform === "All platforms" ||
      r.platform === platform ||
      r.platform === "All" ||
      (platform === "Instagram" && !!r.igUrl) ||
      (platform === "TikTok" && !!r.tiktokUrl) ||
      (platform === "YouTube" && !!r.youtubeUrl)) &&
    (statusFilter === "All stages" || stage(r.status ?? "") === statusFilter);
  const ideas = activeIdeas
    .filter(matches)
    .sort((a, b) =>
      sort === "priority"
        ? priorityRank(a.priority) - priorityRank(b.priority)
        : sort === "difficulty"
          ? difficultyRank(a.difficulty) - difficultyRank(b.difficulty)
          : (b.date ?? "").localeCompare(a.date ?? ""),
    );
  const filteredVideos = (dataset?.videos ?? []).filter(matches);
  const start = days === "custom" ? from : dayAdd(today(), -Number(days) + 1),
    end = days === "custom" ? to : today();
  const { observed, points } = useMemo(
    () =>
      platformPerformance(
        dataset?.snapshots ?? [],
        analyticsPlatform,
        start,
        end,
      ),
    [dataset?.snapshots, analyticsPlatform, start, end],
  );
  const viewTotal = sum(observed.map((s) => number(s.views))),
    engagementRates = observed
      .map(engagement)
      .filter((r): r is number => r !== null),
    avgRate = engagementRates.length
      ? engagementRates.reduce((a, b) => a + b, 0) / engagementRates.length
      : null;
  const categoryPoints = categories
    .map((c) => ({
      category: c,
      views:
        sum(
          observed
            .filter(
              (s) =>
                dataset?.videos.find((v) => v.id === s.videoId)?.category === c,
            )
            .map((s) => number(s.views)),
        ) ?? 0,
    }))
    .filter((c) => c.views > 0)
    .sort((a, b) => b.views - a.views);
  const upcoming = (dataset?.schedule ?? [])
    .filter((s) => s.status === "Scheduled" && s.date >= today())
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const [topSort, setTopSort] = useState("views");
  const top = [...observed].sort((a, b) =>
    topSort === "engagement"
      ? (engagement(b) ?? -1) - (engagement(a) ?? -1)
      : (number(b[topSort]) ?? -1) - (number(a[topSort]) ?? -1),
  );
  function priorityRank(v: string) {
    return /high/i.test(v) ? 0 : /medium/i.test(v) ? 1 : 2;
  }
  function difficultyRank(v: string) {
    return /easy/i.test(v) ? 0 : /medium/i.test(v) ? 1 : 2;
  }
  const openIdea = (record?: Partial<RecordData>) =>
    setEditing({
      entity: "ideas",
      record,
      title: record?.id ? "The idea, in detail" : "Make room for a new idea",
    });
  const openPublishedPost = (idea: Partial<RecordData>) => {
    const linked = dataset?.videos.find((v) => v.ideaId === idea.id);
    setEditing({
      entity: "videos",
      title: "Add published post links",
      publishIdeaId: idea.id,
      record: linked || {
        ideaId: idea.id,
        title: idea.title,
        category: idea.category,
      },
    });
  };
  const openSchedule = (record?: Partial<RecordData>) =>
    setEditing({
      entity: "schedule",
      record,
      title: record?.id ? "Refine your plan" : "Put it on the calendar",
    });
  const analyticsPlatformControl = (
    <div
      className="analytics-platform-tabs"
      role="group"
      aria-label="Analytics platform"
    >
      {platforms.map((p) => (
        <button
          key={p}
          type="button"
          aria-label={p}
          aria-pressed={analyticsPlatform === p}
          onClick={() => {
            setAnalyticsPlatform(p);
            localStorage.setItem("cs-analytics-platform", p);
          }}
        >
          <PlatformIcon platform={p} />
          {p}
        </button>
      ))}
    </div>
  );
  const analyticsVideos = (dataset?.videos ?? []).filter(
    (v) => !!v[platformPrefix(analyticsPlatform) + "Url"],
  );
  const rangeControl = (
    <div className="range-control">
      <select
        aria-label="Analytics date range"
        value={days}
        onChange={(e) => setDays(e.target.value)}
      >
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
        <option value="custom">Custom range</option>
      </select>
      {days === "custom" && (
        <>
          <input
            aria-label="Start date"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            aria-label="End date"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </>
      )}
    </div>
  );
  const toolbar = (
    <div className="toolbar">
      <div className="search">
        <Search size={16} />
        <input
          aria-label="Search content"
          placeholder="Find a little inspiration…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <select
        aria-label="Filter category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option>All categories</option>
        {categories.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select
        aria-label="Filter platform"
        value={platform}
        onChange={(e) => setPlatform(e.target.value)}
      >
        <option>All platforms</option>
        {platforms.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      {path === "ideas" && (
        <>
          <select
            aria-label="Filter stage"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option>All stages</option>
            {stages.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Sort ideas"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">Most recent</option>
            <option value="priority">Priority</option>
            <option value="difficulty">Difficulty</option>
          </select>
          <button
            className={"button subtle " + (archived ? "selected" : "")}
            onClick={() => setArchived(!archived)}
          >
            <Archive size={15} />
            {archived ? "Archived" : "Archive"}
          </button>
        </>
      )}
    </div>
  );
  if (session === "loading")
    return (
      <div className="login-page">
        <LoaderCircle className="spin" />
        <p className="muted">Opening your studio…</p>
      </div>
    );
  if (session === "locked")
    return (
      <div className="login-page">
        <div className="login-art">
          <div className="brand-symbol">
            <Clapperboard size={26} />
          </div>
          <p className="eyebrow">CONTENT STUDIO</p>
          <h1>
            A little more
            <br />
            <em>intentional.</em>
          </h1>
          <p className="muted">
            A space for your ideas, your stories,
            <br />
            and everything you’re becoming.
          </p>
          <div className="login-tags">
            <span>MAKE.</span>
            <span>SHARE.</span>
            <span>GROW.</span>
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoggingIn(true);
            setLoginError("");
            try {
              await fetcherPostSession(password);
              setPassword("");
              setSession("open");
            } catch (err) {
              setLoginError(
                err instanceof Error ? err.message : "Sign in failed",
              );
            } finally {
              setLoggingIn(false);
            }
          }}
        >
          <ShieldCheck size={25} className="accent" />
          <h2>Your studio awaits.</h2>
          <p className="muted">Sign in to your personal creator workspace.</p>
          <label className="field">
            <span>Workspace password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {!configured && (
            <p className="form-note">
              First-time setup: set APP_PASSWORD (16+ characters) and
              SESSION_SECRET (32+ characters) in .env.local, then restart the
              server. See README.md.
            </p>
          )}
          {loginError && (
            <p className="error" role="alert">
              {loginError}
            </p>
          )}
          <button className="button primary wide" disabled={loggingIn}>
            {loggingIn ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <>
                Enter your studio <ArrowRight size={17} />
              </>
            )}
          </button>
          <p className="small muted">
            Single creator. Your stories. Your pace.
          </p>
        </form>
      </div>
    );
  return (
    <div className={"app " + (collapsed ? "collapsed" : "")}>
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-symbol">
            <Clapperboard size={20} />
          </span>
          <span>
            content<span className="brand-light">studio</span>
            <sup>®</sup>
          </span>
        </Link>
        <button
          aria-label="Collapse sidebar"
          className="collapse-button icon-button"
          onClick={() => setCollapsed(!collapsed)}
        >
          <PanelLeftClose size={17} />
        </button>
        <p className="sidebar-label">YOUR WORKSPACE</p>
        <nav>
          {pages
            .filter((p) => p.slug !== "settings")
            .map((p) => (
              <Link
                className={path === p.slug ? "active" : ""}
                aria-current={path === p.slug ? "page" : undefined}
                href={"/" + p.slug}
                key={p.slug}
              >
                <p.icon size={18} />
                <span>{p.name}</span>
                {p.slug === "ideas" && (
                  <small>
                    {dataset?.ideas.filter((i) => i.archived !== "true")
                      .length ?? "—"}
                  </small>
                )}
              </Link>
            ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-spark">
            <Sparkles size={18} />
          </span>
          <p>
            Good stories start
            <br />
            with everyday moments.
          </p>
          <span>Make something that feels like you.</span>
        </div>
        <div className="sidebar-bottom">
          <Link href="/settings">
            <Settings size={18} />
            <span>Settings & connection</span>
          </Link>
          <div className="profile">
            <span className="avatar">
              {(dataset?.settings[0]?.creator || "C").charAt(0)}
            </span>
            <div>
              <strong>
                {dataset?.settings[0]?.creator || "Your creative space"}
              </strong>
              <span>Personal workspace</span>
            </div>
            <button
              aria-label="Sign out"
              className="icon-button"
              onClick={async () => {
                await fetch("/api/session", { method: "DELETE" });
                localStorage.removeItem("cs-offline");
                setOfflineData(null);
                await mutate(undefined, { revalidate: false });
                setSession("locked");
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{page.name}</strong>
          </div>
          <div className="topbar-right">
            <span className="sync-dot" />
            <span className="sync-label">
              {!online
                ? "Offline · read only"
                : isValidating
                  ? "Syncing…"
                  : dataset?.mode === "demo"
                    ? "Demo workspace"
                    : dataset?.mode === "live"
                      ? "Google Sheets connected"
                      : error
                        ? "Connection unavailable"
                        : "Connecting…"}
            </span>
            <button
              className="icon-button"
              onClick={() => void mutate()}
              aria-label="Synchronize now"
              disabled={!online || isValidating}
            >
              <RefreshCw size={15} className={isValidating ? "spin" : ""} />
            </button>
            <span className="divider" />
            <button
              className="icon-button"
              aria-label="Toggle theme"
              title={light ? "Switch to dark mode" : "Switch to light mode"}
              aria-pressed={!light}
              onClick={() => {
                localStorage.setItem("cs-ui-theme", light ? "dark" : "light");
                setLight(!light);
              }}
            >
              {light ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <span className="mini-avatar">CS</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {path === "dashboard"
                  ? new Intl.DateTimeFormat("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      timeZone: "Asia/Jakarta",
                    })
                      .format(new Date())
                      .toUpperCase()
                  : "YOUR PERSONAL CREATOR WORKSPACE"}
              </p>
              <h1>
                {(
                  {
                    dashboard: "Your content at a glance",
                    ideas: "Content ideas",
                    pipeline: "Content pipeline",
                    calendar: "Publishing calendar",
                    published: "Published content",
                    analytics: "Performance overview",
                    performance: "Performance tracker",
                    settings: "Workspace settings",
                  } as Record<string, string>
                )[path] || "A little more intentional."}
                <span className="heading-dot">.</span>
              </h1>
              <p className="muted">
                {
                  (
                    {
                      dashboard:
                        "Your ideas, your progress, your next great story. All in one place.",
                      ideas:
                        "Collect the sparks. Give the good ones room to grow.",
                      pipeline:
                        "Keep things moving, one meaningful step at a time.",
                      calendar:
                        "A thoughtful plan. A little breathing room. All times in WIB.",
                      published:
                        "A growing collection of stories you’ve shared.",
                      analytics:
                        "Understand what resonates. Let real observations guide your next story.",
                      performance:
                        "Review observations by date and correct the details in one place.",
                      settings: "Your workspace, connected and considered.",
                    } as Record<string, string>
                  )[path]
                }
              </p>
            </div>
            <button
              className="button primary"
              onClick={() => openIdea()}
              disabled={!canWrite}
            >
              <Plus size={17} /> Capture idea
            </button>
          </div>
          {dataset?.mode === "demo" && (
            <div className="demo-banner">
              <span>
                <Sparkles size={14} /> DEMO WORKSPACE{" "}
                <span>
                  Explore with sample stories. Your Google Sheet is untouched.
                </span>
              </span>
              <Link href="/settings">
                Connect your sheet <ArrowUpRight size={13} />
              </Link>
            </div>
          )}
          {(!online || session === "offline") && (
            <div className="warning-banner">
              <WifiOff size={16} /> Offline reading · showing your last
              successful sync. Reconnect to save changes.
            </div>
          )}
          {dataset?.warnings.map((w) => (
            <div className="warning-banner" key={w}>
              {w}
            </div>
          ))}
          {path === "settings" && (
            <div className="section-top">
              <p className="muted small">
                Securely authorize the Google account that owns your tracker.
              </p>
              <button
                className="button primary"
                onClick={() => void connectGoogle()}
                disabled={!online || session !== "open" || connectingGoogle}
              >
                {connectingGoogle ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <ShieldCheck size={15} />
                )}{" "}
                {connectingGoogle
                  ? "Connecting…"
                  : dataset?.mode === "live" || needsGoogle
                    ? "Reconnect Google"
                    : "Connect Google"}
              </button>
            </div>
          )}
          {path === "settings" && (
            <p className="muted small connection-help">
              Google OAuth apps in Testing require reauthorization after seven
              days. Reconnect, choose your account, and approve access. The
              connection is saved automatically.
            </p>
          )}
          {(error || needsGoogle) && (
            <div className="error" role="alert">
              {error?.message || "Reconnect Google to restore access."}{" "}
              {((error as { reconnect?: boolean } | undefined)?.reconnect ||
                needsGoogle) && (
                <button
                  className="button primary"
                  onClick={() => void connectGoogle()}
                  disabled={!online || connectingGoogle}
                >
                  Reconnect Google
                </button>
              )}
              <button className="button" onClick={() => void mutate()}>
                Try again
              </button>
            </div>
          )}
          {isLoading && !dataset ? (
            <div className="skeleton-grid">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="skeleton" />
              ))}
            </div>
          ) : (
            dataset && (
              <>
                {path === "dashboard" && (
                  <>
                    <div className="section-top">
                      <h2>
                        Your studio at a glance{" "}
                        <span className="tiny-pill">LIVE WORKSPACE</span>
                      </h2>
                      {rangeControl}
                    </div>
                    <p>
                      <Link href="/performance" className="text-link">
                        View and edit all observations{" "}
                        <ArrowUpRight size={14} />
                      </Link>
                    </p>
                    {analyticsPlatformControl}
                    <div className="stats-grid">
                      <Stat
                        label={analyticsPlatform + " published stories"}
                        value={fmt(analyticsVideos.length)}
                        icon={<Clapperboard size={17} />}
                        detail={`${
                          analyticsVideos.filter((v) => {
                            const d =
                              v[platformPrefix(analyticsPlatform) + "Date"];
                            return d >= dayAdd(today(), -6) && d <= today();
                          }).length
                        } ${analyticsPlatform} posts in the last 7 days`}
                      />
                      <Stat
                        label={analyticsPlatform + " recorded views"}
                        value={fmt(viewTotal)}
                        icon={<TrendingUp size={17} />}
                        detail={`${observed.filter((s) => number(s.views) !== null).length} latest ${analyticsPlatform} observations`}
                      />
                      <Stat
                        label="Avg. engagement rate"
                        value={avgRate === null ? "—" : fmt(avgRate, 2) + "%"}
                        icon={<Flame size={17} />}
                        detail={`${engagementRates.length} complete observations`}
                      />
                      <Stat
                        label="In the making"
                        value={fmt(
                          dataset.ideas.filter(
                            (i) =>
                              i.archived !== "true" &&
                              !["Published", "Scheduled", "Cancelled"].includes(
                                stage(i.status),
                              ),
                          ).length,
                        )}
                        icon={<Film size={17} />}
                        detail={`${dataset.schedule.filter((s) => s.status === "Scheduled").length} platform posts scheduled`}
                      />
                    </div>
                    <div className="dashboard-middle">
                      <section className="panel views-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>{analyticsPlatform} in numbers</h2>
                            <p className="muted small">
                              Recorded cumulative views at each observation date
                            </p>
                          </div>
                          <span className="legend">
                            <i /> Observed views
                          </span>
                        </div>
                        {points.length ? (
                          <ViewsChart points={points} />
                        ) : (
                          <Empty text="Add a performance snapshot to start seeing your story." />
                        )}
                        <div className="chart-footer">
                          Each point sums only snapshots recorded that day;
                          these are not daily views. Different dates may contain
                          different videos.
                        </div>
                      </section>
                      <section className="panel next-panel">
                        <div className="panel-heading">
                          <h2>Coming up next</h2>
                          <Link href="/calendar" className="text-link">
                            Calendar <ArrowUpRight size={14} />
                          </Link>
                        </div>
                        {upcoming.length ? (
                          upcoming.slice(0, 3).map((s, i) => (
                            <button
                              key={s.id}
                              className="upcoming-item"
                              onClick={() => openSchedule(s)}
                            >
                              <div
                                className={
                                  "date-tile " + (i === 0 ? "highlight" : "")
                                }
                              >
                                <span>
                                  {s.date === today()
                                    ? "TODAY"
                                    : new Date(s.date + "T12:00:00+07:00")
                                        .toLocaleDateString("en", {
                                          weekday: "short",
                                        })
                                        .toUpperCase()}
                                </span>
                                <strong>{s.date.slice(-2)}</strong>
                              </div>
                              <div>
                                <h3>{s.title}</h3>
                                <p>
                                  <PlatformIcon platform={s.platform} />
                                  {s.platform}
                                  <span>·</span>
                                  {s.time} WIB
                                </p>
                              </div>
                              <ChevronRight size={15} />
                            </button>
                          ))
                        ) : (
                          <Empty text="A little room for your next story. Schedule something when you’re ready." />
                        )}
                        <button
                          className="button outline wide"
                          disabled={!canWrite}
                          onClick={() => openSchedule()}
                        >
                          <Plus size={15} /> Plan a post
                        </button>
                      </section>
                    </div>
                    <div className="dashboard-bottom">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Stories that resonated</h2>
                          <Link href="/analytics" className="text-link">
                            View analytics <ArrowUpRight size={14} />
                          </Link>
                        </div>
                        {top.length ? (
                          <div className="story-table">
                            <div className="table-head">
                              <span>CONTENT</span>
                              <span>VIEWS</span>
                              <span>ENG. RATE</span>
                            </div>
                            {top.slice(0, 4).map((s, i) => (
                              <div className="story-row" key={s.id}>
                                <div className="story-name">
                                  <span className="story-rank">0{i + 1}</span>
                                  <span>
                                    <strong>{s.title}</strong>
                                    <small>
                                      <PlatformIcon platform={s.platform} />
                                      {s.platform} · observed{" "}
                                      {dateLabel(s.date)}
                                    </small>
                                  </span>
                                </div>
                                <strong>{fmt(number(s.views))}</strong>
                                <span className="accent">
                                  {engagement(s) === null
                                    ? "—"
                                    : fmt(engagement(s), 2) + "%"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Empty text="Your published stories will find their place here." />
                        )}
                      </section>
                      <section className="panel production-panel">
                        <div className="panel-heading">
                          <h2>Keep the momentum</h2>
                          <Link href="/pipeline" className="text-link">
                            Pipeline <ArrowUpRight size={14} />
                          </Link>
                        </div>
                        {["Scripting", "Filming", "Editing", "Ready"].map(
                          (s) => (
                            <div className="momentum" key={s}>
                              <span
                                className={"status-dot " + s.toLowerCase()}
                              />
                              <span>
                                {s === "Ready" ? "Ready to share" : s}
                              </span>
                              <div className="progress-track">
                                <i
                                  style={{
                                    width: `${Math.min(100, (dataset.ideas.filter((i) => stage(i.status) === s && i.archived !== "true").length / Math.max(1, dataset.ideas.length)) * 100)}%`,
                                  }}
                                />
                              </div>
                              <strong>
                                {
                                  dataset.ideas.filter(
                                    (i) =>
                                      stage(i.status) === s &&
                                      i.archived !== "true",
                                  ).length
                                }
                              </strong>
                            </div>
                          ),
                        )}
                        <div className="gentle-note">
                          <Sparkles size={16} />
                          <p>
                            Consistency is a collection of small steps.
                            <br />
                            <span>
                              You’re building something, one story at a time.
                            </span>
                          </p>
                        </div>
                      </section>
                    </div>
                  </>
                )}
                {path === "ideas" && (
                  <>
                    {toolbar}
                    <div className="section-top">
                      <p className="muted small">
                        {ideas.length} {archived ? "archived ideas" : "ideas"}
                      </p>
                      <span className="small muted">
                        Your next story could be right here.
                      </span>
                    </div>
                    <div className="idea-grid">
                      {ideas.map((i, index) => (
                        <article className="idea-card" key={i.id}>
                          <button
                            className="idea-card-main"
                            onClick={() => openIdea(i)}
                          >
                            <div
                              className={"card-visual visual-" + (index % 5)}
                            >
                              <span className="visual-word">
                                {i.category?.split("/")[0] || "Everyday"}
                              </span>
                              <span className="visual-counter">
                                FIELD NOTES /{" "}
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <span className="visual-line" />
                              <span className="visual-sub">
                                A STORY WORTH TELLING
                              </span>
                            </div>
                            <div className="idea-card-body">
                              <div className="card-meta">
                                <span className="category-label">
                                  {i.category || "Uncategorized"}
                                </span>
                                <span
                                  className={
                                    "priority " +
                                    (/high/i.test(i.priority) ? "high" : "")
                                  }
                                >
                                  {i.priority || "No priority"}
                                </span>
                              </div>
                              <h3>{i.title}</h3>
                              <p className="idea-excerpt">
                                {i.hook ||
                                  i.relevance ||
                                  "A little spark, waiting to become a story."}
                              </p>
                              <div className="idea-bottom">
                                <Badge status={i.status} />
                                <span>
                                  {i.duration ? i.duration + "s" : "—"} ·{" "}
                                  {i.difficulty || "Unspecified"}
                                </span>
                              </div>
                              {stage(i.status) === "Cancelled" && (
                                <p className="cancellation-note">
                                  <strong>Cancelled:</strong>{" "}
                                  {i.cancellationReason ||
                                    "Reason not recorded"}
                                </p>
                              )}
                              <div className="idea-card-foot">
                                <span>
                                  {i.platform || "No platform"} ·{" "}
                                  {dateLabel(i.date)}
                                </span>
                                <span>
                                  {i.reference ? "↗ Reference" : "No reference"}
                                </span>
                              </div>
                            </div>
                          </button>
                          <div className="card-actions">
                            <button
                              className="text-link"
                              disabled={!canWrite}
                              onClick={() =>
                                stage(i.status) === "Cancelled"
                                  ? void quickSave("ideas", i, {
                                      status:
                                        stage(i.cancelledFrom || "Idea") ===
                                        "Cancelled"
                                          ? "Idea"
                                          : stage(i.cancelledFrom || "Idea"),
                                    })
                                  : setCancelling(i)
                              }
                            >
                              {stage(i.status) === "Cancelled"
                                ? "Restore idea"
                                : "Cancel idea"}
                            </button>
                            <button
                              className="text-link"
                              disabled={!canWrite}
                              onClick={() => {
                                const copy = {
                                  ...i,
                                  title: i.title + " (copy)",
                                  status: "Idea",
                                  date: today(),
                                  cancellationReason: "",
                                };
                                delete (copy as Partial<RecordData>).id;
                                delete (copy as Partial<RecordData>).version;
                                openIdea(copy);
                              }}
                            >
                              <Copy size={13} /> Duplicate
                            </button>
                            <button
                              className="text-link"
                              disabled={!canWrite}
                              onClick={() =>
                                void quickSave("ideas", i, {
                                  archived: archived ? "false" : "true",
                                })
                              }
                            >
                              <Archive size={13} />
                              {archived ? "Restore" : "Archive"}
                            </button>
                          </div>
                        </article>
                      ))}
                      {!ideas.length && (
                        <Empty
                          text="No ideas here yet. Capture a moment, a thought, or a story you’d like to tell."
                          action={() => openIdea()}
                        />
                      )}
                    </div>
                  </>
                )}
                {path === "pipeline" && (
                  <>
                    {toolbar}
                    <div className="pipeline-board">
                      {stages.map((s) => (
                        <section
                          className="kanban-column"
                          key={s}
                          onDragOver={(e) => {
                            e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id = e.dataTransfer.getData("text/plain");
                            const item = dataset.ideas.find((i) => i.id === id);
                            if (item && canWrite)
                              void quickSave("ideas", item, { status: s });
                          }}
                        >
                          <div className="kanban-heading">
                            <span className={"status-dot " + s.toLowerCase()} />
                            <h2>{s === "Idea" ? "Ideas" : s}</h2>
                            <span>
                              {
                                ideas.filter((i) => stage(i.status) === s)
                                  .length
                              }
                            </span>
                          </div>
                          {ideas
                            .filter((i) => stage(i.status) === s)
                            .map((i) => (
                              <article
                                key={i.id}
                                className="kanban-card"
                                draggable={canWrite}
                                onDragStart={(e) =>
                                  e.dataTransfer.setData("text/plain", i.id)
                                }
                              >
                                <button
                                  className="kanban-open"
                                  onClick={() => openIdea(i)}
                                >
                                  <span className="category-label">
                                    {i.category || "Uncategorized"}
                                  </span>
                                  <h3>{i.title}</h3>
                                  <p className="muted small">
                                    {i.hook ||
                                      i.shots?.slice(0, 90) ||
                                      "Every story starts somewhere."}
                                  </p>
                                </button>
                                <div className="kanban-details">
                                  <span
                                    className={
                                      "priority " +
                                      (/high/i.test(i.priority) ? "high" : "")
                                    }
                                  >
                                    {i.priority || "Medium"}
                                  </span>
                                  <span>
                                    {i.needFootage === "Yes"
                                      ? "◌ New footage"
                                      : "✓ Footage ready"}
                                  </span>
                                </div>
                                {stage(i.status) === "Cancelled" && (
                                  <p className="cancellation-note">
                                    <strong>Reason:</strong>{" "}
                                    {i.cancellationReason || "Not recorded"}
                                  </p>
                                )}
                                {i.deadline && (
                                  <p className="small muted">
                                    Due {dateLabel(i.deadline)}
                                  </p>
                                )}
                                <select
                                  aria-label={"Change stage for " + i.title}
                                  disabled={!canWrite}
                                  value={stage(i.status)}
                                  onChange={(e) =>
                                    void quickSave("ideas", i, {
                                      status: e.target.value,
                                    })
                                  }
                                >
                                  {stages.map((st) => (
                                    <option key={st}>{st}</option>
                                  ))}
                                </select>
                                {!stages.includes(
                                  i.status as (typeof stages)[number],
                                ) && (
                                  <p className="small muted">
                                    Original status: {i.status}
                                  </p>
                                )}
                              </article>
                            ))}
                          {s !== "Cancelled" && (
                            <button
                              className="kanban-add"
                              disabled={!canWrite}
                              onClick={() => openIdea({ status: s })}
                            >
                              <Plus size={14} /> Add idea
                            </button>
                          )}
                        </section>
                      ))}
                    </div>
                    <p className="muted small">
                      Drag cards on desktop, or use each card’s stage menu.
                      Choose Published to add the live Instagram, TikTok, or
                      YouTube post link.
                    </p>
                  </>
                )}
                {path === "calendar" && (
                  <>
                    {toolbar}
                    <section className="panel calendar-panel">
                      <div className="panel-heading">
                        <div className="calendar-heading">
                          <button
                            className="icon-button"
                            aria-label="Previous period"
                            onClick={() => {
                              if (calendarView === "week")
                                setWeek(dayAdd(week, -7));
                              else {
                                const d = new Date(month + "T00:00:00Z");
                                d.setUTCMonth(d.getUTCMonth() - 1);
                                setMonth(d.toISOString().slice(0, 10));
                              }
                            }}
                          >
                            <ChevronLeft size={18} />
                          </button>
                          <h2>
                            {new Date(
                              (calendarView === "week" ? week : month) +
                                "T12:00:00Z",
                            ).toLocaleDateString("en-GB", {
                              month: "long",
                              year: "numeric",
                            })}
                          </h2>
                          <button
                            className="icon-button"
                            aria-label="Next period"
                            onClick={() => {
                              if (calendarView === "week")
                                setWeek(dayAdd(week, 7));
                              else {
                                const d = new Date(month + "T00:00:00Z");
                                d.setUTCMonth(d.getUTCMonth() + 1);
                                setMonth(d.toISOString().slice(0, 10));
                              }
                            }}
                          >
                            <ChevronRight size={18} />
                          </button>
                          <button
                            className="button subtle"
                            onClick={() => {
                              setMonth(today().slice(0, 7) + "-01");
                              setWeek(today());
                            }}
                          >
                            Today
                          </button>
                        </div>
                        <div className="calendar-controls">
                          <select
                            aria-label="Calendar view"
                            value={calendarView}
                            onChange={(e) => setCalendarView(e.target.value)}
                          >
                            <option value="month">Month</option>
                            <option value="week">Week</option>
                          </select>
                          <button
                            className="button primary"
                            onClick={() => openSchedule()}
                            disabled={!canWrite}
                          >
                            <Plus size={15} /> Schedule
                          </button>
                        </div>
                      </div>
                      <div
                        className={
                          "calendar-grid " +
                          (calendarView === "week" ? "week-view" : "")
                        }
                      >
                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                          (d) => (
                            <div className="weekday" key={d}>
                              {d}
                            </div>
                          ),
                        )}
                        {calendarDays(
                          calendarView === "week" ? week : month,
                          calendarView === "week" ? 7 : 42,
                        ).map((day) => {
                          const scheduled = dataset.schedule.filter(
                            (s) =>
                              s.date === day &&
                              s.status !== "Cancelled" &&
                              (platform === "All platforms" ||
                                s.platform === platform) &&
                              (category === "All categories" ||
                                [...dataset.ideas, ...dataset.videos].find(
                                  (i) => i.id === s.contentId,
                                )?.category === category) &&
                              s.title
                                .toLowerCase()
                                .includes(query.toLowerCase()),
                          );
                          const posted = dataset.videos
                            .filter(
                              (v) =>
                                (category === "All categories" ||
                                  v.category === category) &&
                                v.title
                                  .toLowerCase()
                                  .includes(query.toLowerCase()),
                            )
                            .flatMap((v) =>
                              platforms
                                .filter(
                                  (p) =>
                                    (platform === "All platforms" ||
                                      p === platform) &&
                                    v[
                                      p === "Instagram"
                                        ? "igDate"
                                        : p === "TikTok"
                                          ? "tiktokDate"
                                          : "youtubeDate"
                                    ] === day,
                                )
                                .map((p) => ({ video: v, platform: p })),
                            );
                          return (
                            <div
                              key={day}
                              className={
                                "calendar-cell " +
                                (day === today() ? "is-today " : "") +
                                (day.slice(0, 7) !== month.slice(0, 7) &&
                                calendarView === "month"
                                  ? "outside"
                                  : "")
                              }
                            >
                              <button
                                className="day-number"
                                disabled={!canWrite}
                                onClick={() => openSchedule({ date: day })}
                              >
                                {Number(day.slice(-2))}
                              </button>
                              {scheduled.map((s) => (
                                <button
                                  className="calendar-event"
                                  key={s.id}
                                  onClick={() => openSchedule(s)}
                                >
                                  <PlatformIcon platform={s.platform} />
                                  <span>
                                    {s.time} · {s.title}
                                  </span>
                                </button>
                              ))}
                              {posted.map((s) => (
                                <button
                                  className="calendar-event posted-event"
                                  key={s.video.id + s.platform}
                                  onClick={() =>
                                    setEditing({
                                      entity: "videos",
                                      record: s.video,
                                      title: "Published story",
                                    })
                                  }
                                >
                                  <Check size={12} />
                                  <span>
                                    {s.video.title} · {s.platform}
                                  </span>
                                </button>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                      <div className="chart-footer">
                        Planned posts and actual publishing records are stored
                        separately. ✓ indicates an actual published record.
                      </div>
                    </section>
                  </>
                )}
                {path === "published" && (
                  <>
                    {toolbar}
                    <div className="section-top">
                      <h2>{filteredVideos.length} stories shared</h2>
                      <div className="button-group">
                        <button
                          className="button outline"
                          disabled={!canWrite || !dataset.videos.length}
                          onClick={() =>
                            setEditing({
                              entity: "snapshots",
                              title: "Record a moment of progress",
                            })
                          }
                        >
                          <TrendingUp size={15} /> Record performance
                        </button>
                        <button
                          className="button primary"
                          disabled={!canWrite}
                          onClick={() =>
                            setEditing({
                              entity: "videos",
                              title: "Add a published story",
                            })
                          }
                        >
                          <Plus size={15} /> Add video
                        </button>
                      </div>
                    </div>
                    <div className="published-grid">
                      {filteredVideos.map((v, i) => {
                        return (
                          <article className="panel published-card" key={v.id}>
                            <div className={"published-art visual-" + (i % 5)}>
                              <span>{v.category || "Your stories"}</span>
                              <div className="play-circle">
                                <Video size={22} />
                              </div>
                              <span>PUBLISHED STORY</span>
                            </div>
                            <div className="published-body">
                              <div className="card-meta">
                                <span className="category-label">
                                  {v.category || "Uncategorized"}
                                </span>
                                <span className="small muted">
                                  {v.id.slice(0, 16)}
                                </span>
                              </div>
                              <button
                                className="plain-title"
                                onClick={() =>
                                  setEditing({
                                    entity: "videos",
                                    record: v,
                                    title: "Published story",
                                  })
                                }
                              >
                                <h3>{v.title}</h3>
                              </button>
                              <PublishedPlatforms
                                video={v}
                                snapshots={dataset.snapshots}
                                filter={platform}
                              />
                              <p className="muted small">
                                Related idea:{" "}
                                {dataset.ideas.find((i) => i.id === v.ideaId)
                                  ?.title ||
                                  v.ideaId ||
                                  "Not linked"}
                              </p>
                              <div className="button-group">
                                <button
                                  className="button outline"
                                  disabled={!canWrite}
                                  onClick={() =>
                                    setEditing({
                                      entity: "snapshots",
                                      record: {
                                        videoId: v.id,
                                        title: v.title,
                                        platform:
                                          platform === "All platforms"
                                            ? "Instagram"
                                            : platform,
                                      },
                                      title: "Record performance",
                                    })
                                  }
                                >
                                  <Plus size={14} /> Add snapshot
                                </button>
                                <button
                                  className="button subtle"
                                  onClick={() =>
                                    setEditing({
                                      entity: "videos",
                                      record: v,
                                      title: "Publishing details",
                                    })
                                  }
                                >
                                  Edit details <ArrowUpRight size={14} />
                                </button>
                              </div>
                              <ObservationHistory
                                videoId={v.id}
                                snapshots={dataset.snapshots}
                                writable={canWrite}
                                onEdit={(record) =>
                                  setEditing({
                                    entity: "snapshots",
                                    record,
                                    title: "Edit performance observation",
                                  })
                                }
                              />
                            </div>
                          </article>
                        );
                      })}
                      {!filteredVideos.length && (
                        <Empty text="Your first published story belongs here. Add its post link to get started." />
                      )}
                    </div>
                  </>
                )}
                {path === "performance" && (
                  <PerformanceTracker
                    snapshots={dataset.snapshots}
                    videos={dataset.videos}
                    writable={canWrite}
                    onAdd={() =>
                      setEditing({
                        entity: "snapshots",
                        title: "Record performance",
                      })
                    }
                    onEdit={(record) =>
                      setEditing({
                        entity: "snapshots",
                        record,
                        title: "Edit performance observation",
                      })
                    }
                  />
                )}
                {path === "analytics" && (
                  <>
                    <div className="section-top">
                      <h2>{analyticsPlatform} analytics</h2>
                      {rangeControl}
                    </div>
                    {analyticsPlatformControl}
                    <div className="stats-grid">
                      <Stat
                        label={analyticsPlatform + " recorded views"}
                        value={fmt(viewTotal)}
                        icon={<PlatformIcon platform={analyticsPlatform} />}
                        detail={observed.length + " latest video observations"}
                      />
                      <Stat
                        label="Avg. engagement rate"
                        value={avgRate === null ? "—" : fmt(avgRate, 2) + "%"}
                        icon={<Flame size={17} />}
                        detail={
                          engagementRates.length +
                          " complete " +
                          analyticsPlatform +
                          " observations"
                        }
                      />
                      <Stat
                        label="Recorded engagement"
                        value={fmt(
                          sum(
                            observed.map(
                              (s) =>
                                number(s.interactions) ??
                                (["likes", "comments", "shares", "saves"].every(
                                  (k) => number(s[k]) !== null,
                                )
                                  ? sum(
                                      [
                                        "likes",
                                        "comments",
                                        "shares",
                                        "saves",
                                      ].map((k) => number(s[k])),
                                    )
                                  : null),
                            ),
                          ),
                        )}
                        icon={<Flame size={17} />}
                        detail="Interactions or complete component sums"
                      />
                    </div>
                    <div className="dashboard-middle">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Observation history</h2>
                        </div>
                        {points.length ? (
                          <ViewsChart points={points} />
                        ) : (
                          <Empty text="No recorded metrics in this date range." />
                        )}
                        <p className="chart-footer">
                          Cumulative observations, not daily views. No
                          intermediate values are estimated.
                        </p>
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Views by category</h2>
                        </div>
                        {categoryPoints.length ? (
                          <CategoryChart points={categoryPoints} />
                        ) : (
                          <Empty text="More observations will bring this into focus." />
                        )}
                      </section>
                    </div>
                    <section className="panel analytics-table">
                      <div className="panel-heading">
                        <div>
                          <h2>Stories that resonated</h2>
                          <p className="muted small">
                            Latest observation per video and platform within the
                            selected dates
                          </p>
                        </div>
                        <select
                          aria-label="Sort performance"
                          value={topSort}
                          onChange={(e) => setTopSort(e.target.value)}
                        >
                          <option value="views">By views</option>
                          <option value="engagement">By engagement rate</option>
                          <option value="saves">By saves</option>
                          <option value="shares">By shares</option>
                          <option value="follows">By followers gained</option>
                        </select>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              {[
                                "Content / platform",
                                "Observed",
                                "Views",
                                "Likes",
                                "Eng. rate",
                                "Avg. watched",
                                "Saves",
                                "Shares",
                                "Follows",
                                "View change",
                                "Post",
                              ].map((h) => (
                                <th key={h}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {top.map((s) => {
                              const v = dataset.videos.find(
                                  (v) => v.id === s.videoId,
                                ),
                                link =
                                  v?.[
                                    s.platform === "Instagram"
                                      ? "igUrl"
                                      : s.platform === "TikTok"
                                        ? "tiktokUrl"
                                        : "youtubeUrl"
                                  ];
                              const prev = dataset.snapshots
                                .filter(
                                  (p) =>
                                    p.videoId === s.videoId &&
                                    p.platform === s.platform &&
                                    p.date < s.date,
                                )
                                .sort((a, b) =>
                                  b.date.localeCompare(a.date),
                                )[0];
                              const delta =
                                prev &&
                                number(prev.views) !== null &&
                                number(s.views) !== null
                                  ? number(s.views)! - number(prev.views)!
                                  : null;
                              return (
                                <tr key={s.id}>
                                  <td>
                                    <strong>{s.title}</strong>
                                    <small>
                                      {s.platform} · published{" "}
                                      {dateLabel(
                                        v?.[
                                          s.platform === "Instagram"
                                            ? "igDate"
                                            : s.platform === "TikTok"
                                              ? "tiktokDate"
                                              : "youtubeDate"
                                        ] || "",
                                      )}
                                    </small>
                                  </td>
                                  <td>{dateLabel(s.date)}</td>
                                  <td>{fmt(number(s.views))}</td>
                                  <td>{fmt(number(s.likes))}</td>
                                  <td>
                                    {engagement(s) === null
                                      ? "—"
                                      : fmt(engagement(s), 2) + "%"}
                                  </td>
                                  <td>
                                    {averageWatchedPercent(s, v) === null
                                      ? "—"
                                      : fmt(averageWatchedPercent(s, v), 1) +
                                        "%"}
                                  </td>
                                  <td>{fmt(number(s.saves))}</td>
                                  <td>{fmt(number(s.shares))}</td>
                                  <td>{fmt(number(s.follows))}</td>
                                  <td>
                                    {delta === null
                                      ? "—"
                                      : (delta > 0 ? "+" : "") + fmt(delta)}
                                  </td>
                                  <td>
                                    {link ? (
                                      <a
                                        className="text-link"
                                        href={link}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Open <ExternalLink size={12} />
                                      </a>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {!top.length && (
                        <Empty text="No performance observations in this date range." />
                      )}
                    </section>
                    <div className="dashboard-middle">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Category comparison</h2>
                        </div>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Category</th>
                                <th>Sample</th>
                                <th>Mean views</th>
                                <th>Median</th>
                                <th>Eng. rate</th>
                              </tr>
                            </thead>
                            <tbody>
                              {categories.map((c) => {
                                const rows = observed.filter(
                                    (s) =>
                                      dataset.videos.find(
                                        (v) => v.id === s.videoId,
                                      )?.category === c,
                                  ),
                                  views = rows
                                    .map((s) => number(s.views))
                                    .filter((n): n is number => n !== null)
                                    .sort((a, b) => a - b),
                                  rates = rows
                                    .map(engagement)
                                    .filter((n): n is number => n !== null);
                                return (
                                  <tr key={c}>
                                    <td>{c}</td>
                                    <td>
                                      {views.length}
                                      {views.length < 5
                                        ? " · small sample"
                                        : ""}
                                    </td>
                                    <td>
                                      {views.length
                                        ? fmt(sum(views)! / views.length)
                                        : "—"}
                                    </td>
                                    <td>
                                      {views.length
                                        ? fmt(
                                            views.length % 2
                                              ? views[
                                                  Math.floor(views.length / 2)
                                                ]
                                              : (views[views.length / 2 - 1] +
                                                  views[views.length / 2]) /
                                                  2,
                                          )
                                        : "—"}
                                    </td>
                                    <td>
                                      {rates.length
                                        ? fmt(sum(rates)! / rates.length, 2) +
                                          "%"
                                        : "—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                      <section className="panel metric-notes">
                        <div className="panel-heading">
                          <h2>Behind the numbers</h2>
                        </div>
                        <p>
                          Engagement rate = recorded interactions ÷ views × 100.
                          If interactions are missing, the app uses likes +
                          comments + shares + saves only when all four are
                          recorded.
                        </p>
                        <p>
                          Average watched = average watch seconds ÷ the actual
                          duration of this platform version × 100. Missing or
                          zero duration is shown as unknown; loops can exceed
                          100%. Rates are averaged across complete observations.
                          A dash means unknown, not zero. View change compares
                          consecutive recorded observations and can be negative
                          after a platform correction.
                        </p>
                        <p>
                          Category samples count video-platform observations.
                          Platform definitions differ; comparisons describe
                          recorded data and do not establish causality.
                        </p>
                        <p>
                          Weekly recommendations and advanced time-slot insights
                          belong to Phase 2.
                        </p>
                      </section>
                    </div>
                  </>
                )}
                {path === "settings" && (
                  <div className="settings-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>A connected workspace</h2>
                        <ShieldCheck size={19} className="accent" />
                      </div>
                      <div className="connection-card">
                        <span className="sheet-icon">
                          <LayoutGrid size={26} />
                        </span>
                        <div>
                          <h3>Google Sheets</h3>
                          <p className="muted small">
                            {dataset.mode === "live"
                              ? "AI Content Idea Tracker"
                              : "Connect your existing content tracker"}
                          </p>
                        </div>
                        <span className="badge">
                          {dataset.mode === "live" ? "Connected" : "Demo mode"}
                        </span>
                      </div>
                      <dl className="settings-list">
                        <div>
                          <dt>Data source</dt>
                          <dd>
                            {dataset.mode === "live"
                              ? "Google Sheets"
                              : dataset.persistence === "browser"
                                ? "This browser (demo)"
                                : "Local demo file"}
                          </dd>
                        </div>
                        <div>
                          <dt>Last successful sync</dt>
                          <dd>
                            {new Date(dataset.syncedAt).toLocaleString(
                              "en-GB",
                              { timeZone: "Asia/Jakarta" },
                            )}{" "}
                            WIB
                          </dd>
                        </div>
                        <div>
                          <dt>Refresh while active</dt>
                          <dd>Every 45 seconds</dd>
                        </div>
                        <div>
                          <dt>Writes</dt>
                          <dd>
                            {dataset.writable
                              ? "Enabled"
                              : "Disabled in server configuration"}
                          </dd>
                        </div>
                        <div>
                          <dt>Application timezone</dt>
                          <dd>Asia/Jakarta · WIB</dd>
                        </div>
                      </dl>
                      <button
                        className="button outline"
                        disabled={!online || isValidating}
                        onClick={() => void mutate()}
                      >
                        <RefreshCw
                          size={15}
                          className={isValidating ? "spin" : ""}
                        />{" "}
                        Sync now
                      </button>
                      <div className="setup-note">
                        <h3>Connect your real tracker</h3>
                        <p>
                          Connect or reconnect above using the Google account
                          that can edit your tracker. After you approve access,
                          the app saves the connection securely and returns you
                          to your workspace.
                        </p>
                        <p>
                          Google authorization only saves connection
                          credentials. Your tracker content is loaded
                          separately.
                        </p>
                      </div>
                    </section>
                    <div>
                      <InstagramSettings
                        online={online}
                        writable={canWrite && dataset.mode === "live"}
                        onSynced={() => mutate()}
                      />
                      <TikTokSettings
                        online={online}
                        writable={canWrite && dataset.mode === "live"}
                        onSynced={() => mutate()}
                      />
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>The creator behind the stories</h2>
                        </div>
                        <p className="muted">
                          {dataset.settings[0]?.creator ||
                            "Your creative space"}
                        </p>
                        <p className="small muted">
                          Default platforms:{" "}
                          {dataset.settings[0]?.platform || "All"}
                        </p>
                        <p className="small muted">
                          Categories:{" "}
                          {dataset.settings[0]?.categories ||
                            "Use your existing categories"}
                        </p>
                        <button
                          className="button outline"
                          disabled={!canWrite}
                          onClick={() =>
                            setEditing({
                              entity: "settings",
                              record: dataset.settings[0],
                              title: "Your creator preferences",
                            })
                          }
                        >
                          Edit preferences <ArrowUpRight size={14} />
                        </button>
                      </section>
                      <section className="panel install-panel">
                        <span className="note-spark">
                          <Sparkles size={20} />
                        </span>
                        <h2>Your studio, wherever you are.</h2>
                        <p className="muted">
                          Install from your browser’s menu on Android or
                          desktop. On iPhone, use Safari → Share → Add to Home
                          Screen.
                        </p>
                        <p className="small muted">
                          Your last synced content is stored on this device for
                          offline reading. Signing out clears it. Use a trusted
                          personal device.
                        </p>
                        <button
                          className="button outline"
                          onClick={() => {
                            localStorage.removeItem("cs-offline");
                            notify(
                              "Offline content cleared from this device. It will be saved again after the next successful sync.",
                            );
                          }}
                        >
                          Clear offline content
                        </button>
                      </section>
                    </div>
                  </div>
                )}
              </>
            )
          )}
          <footer className="page-footer">
            <span>
              CONTENT STUDIO <span>— Make something that feels like you.</span>
            </span>
            <span>Personal workspace · WIB (UTC+7)</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav">
        {pages.slice(0, 4).map((p) => (
          <Link
            key={p.slug}
            href={"/" + p.slug}
            className={path === p.slug ? "active" : ""}
          >
            <p.icon size={20} />
            <span>
              {p.slug === "dashboard"
                ? "Home"
                : p.slug === "pipeline"
                  ? "Pipeline"
                  : p.slug === "ideas"
                    ? "Ideas"
                    : "Calendar"}
            </span>
          </Link>
        ))}
        <button className={menu ? "active" : ""} onClick={() => setMenu(!menu)}>
          <MoreHorizontal size={21} />
          <span>More</span>
        </button>
      </nav>
      {menu && (
        <div className="mobile-more">
          <button
            className="icon-button"
            aria-label="Close more menu"
            onClick={() => setMenu(false)}
          >
            <X size={18} />
          </button>
          {pages.slice(4).map((p) => (
            <Link
              key={p.slug}
              href={"/" + p.slug}
              onClick={() => setMenu(false)}
            >
              <p.icon size={18} />
              {p.name}
            </Link>
          ))}
        </div>
      )}
      {cancelling && (
        <CancelIdeaDialog
          title={cancelling.title}
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await save("ideas", {
              ...cancelling,
              status: "Cancelled",
              cancellationReason: reason,
            });
            setCancelling(null);
          }}
        />
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={editing?.title || ""}
      >
        {editing && dataset && (
          <Editor
            key={
              editing.entity +
              (editing.record?.id ?? JSON.stringify(editing.record))
            }
            saveLabel={
              editing.entity === "snapshots" && editing.record?.id
                ? "Save correction"
                : "Save changes"
            }
            entity={editing.entity}
            record={editing.record}
            dataset={{ ...dataset, writable: canWrite }}
            publishing={!!editing.publishIdeaId}
            onSavePost={
              editing.entity === "ideas" && editing.record?.id
                ? async (data) => save("videos", data, dataset, false)
                : undefined
            }
            onSave={async (entity, record) => {
              const updated = await save(entity, record);
              if (entity === "videos" && editing.publishIdeaId) {
                const idea = updated?.ideas.find(
                  (i) => i.id === editing.publishIdeaId,
                );
                if (!idea || !updated) {
                  notify(
                    "Post link saved. Refresh the pipeline to update its stage.",
                  );
                  return;
                }
                try {
                  await save(
                    "ideas",
                    { ...idea, status: "Published" },
                    updated,
                  );
                } catch (error) {
                  notify(
                    "Post link saved, but the idea stage was not updated. " +
                      (error instanceof Error
                        ? error.message
                        : "Refresh the pipeline before trying again."),
                  );
                }
              }
            }}
          />
        )}
      </Dialog>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button
            className="icon-button"
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="stat-card">
      <div className="stat-label">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <p>{detail}</p>
    </section>
  );
}
function Empty({ text, action }: { text: string; action?: () => void }) {
  return (
    <div className="empty">
      <Lightbulb size={23} />
      <p>{text}</p>
      {action && (
        <button className="button outline" onClick={action}>
          <Plus size={15} /> Capture idea
        </button>
      )}
    </div>
  );
}
function calendarDays(start: string, count: number) {
  const d = new Date(start + "T00:00:00Z"),
    offset = (d.getUTCDay() + 6) % 7;
  return Array.from({ length: count }, (_, i) => dayAdd(start, i - offset));
}
async function fetcherPostSession(password: string) {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body;
}
