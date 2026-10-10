import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Sun,
  Moon,
  Sunrise,
  Inbox,
  CalendarDays,
  Check,
  CheckCheck,
  Plus,
  Search,
  Bell,
  Settings,
  PanelLeftClose,
  ChevronRight,
  ChevronDown,
  ArrowUpRight,
  ArrowRight,
  X,
  Flag,
  Clock3,
  MoreHorizontal,
  SlidersHorizontal,
  Sparkles,
  CircleHelp,
  Folder,
  Trash2,
  Download,
  Command,
  Bot,
  Play,
  Square,
  Repeat2,
  Terminal,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  Laptop,
  Circle,
  FileText,
  Menu,
  Pin,
  PinOff,
} from "lucide-react";
import "./styles.css";
import "./liquid-material.css";
import { taskPayload } from "./task-data.js";
import Sunflower, { SunflowerMark } from "./Sunflower.jsx";
import LiquidRibbon from "./LiquidRibbon.jsx";
import MilkyWay from "./MilkyWay.jsx";
import GlassSettings from "./GlassSettings.jsx";
import { useGlassPreferences } from "./glass-preferences.js";
import { I18nProvider, LanguageSwitch, useI18n, translate } from "./i18n.jsx";
import SkyAtmosphere from './SkyAtmosphere.jsx';
import GlassRain from './GlassRain.jsx';
import RainField from './RainField.jsx';
import WeatherSettings, { WeatherBadge } from './WeatherSettings.jsx';
import { useWeather } from './weather-state.js';
import { useTaskMotion } from './task-motion.js';
import { useScheduledTheme } from './theme-schedule.js';
import { useThemeTransition } from './theme-transition.js';
import McpConnection, { useMcpConnection } from './McpConnection.jsx';
import { usePanelMotion } from './interaction-motion.js';
import './interaction-motion.css';
import StartupScene from './StartupScene.jsx';
import { useStartup } from './startup.js';
import { deriveAtmosphere } from './weather-model.js';

const priorities = { high: "高优先级", medium: "中优先级", low: "低优先级" };
const repeats = {
  none: "仅一次",
  daily: "每天",
  weekdays: "工作日",
  weekly: "每周",
};
const runLabels = {
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
const pad = (v) => String(v).padStart(2, "0");
const dateKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const today = () => dateKey(new Date());
const localInput = (value) =>
  value
    ? `${dateKey(value)}T${pad(new Date(value).getHours())}:${pad(new Date(value).getMinutes())}`
    : "";
const toISO = (value) => (value ? new Date(value).toISOString() : null);
const time = (value, lang = "zh") =>
  value
    ? new Date(value).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";
function dateLabel(value, lang = "zh") {
  const t = (zh, en) => translate(lang, zh, en);
  if (!value) return t("未设日期");
  const key = dateKey(value),
    tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return `${key === today() ? t("今天") : key === dateKey(tomorrow) ? t("明天") : new Date(value).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric" })} ${time(value, lang)}`;
}
const blankTask = () => ({
  title: "",
  notes: "",
  projectId: null,
  priority: "low",
  dueAt: null,
  reminderAt: null,
  completed: false,
  automation: {
    enabled: false,
    prompt: "",
    workspace: "",
    runAt: null,
    repeat: "none",
    sandbox: "read-only",
  },
});
function IconButton({ label, children, onClick, ...rest }) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
function Modal({ title, subtitle, children, onClose, wide = false, closeDisabled = false, className = "", returnFocus }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const closeTimer = useRef(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  closeRef.current = onClose;
  closeDisabledRef.current = closeDisabled;
  const finishDismiss = () => {
    if (!closingRef.current) return;
    closingRef.current = false;
    clearTimeout(closeTimer.current);
    closeRef.current();
  };
  const dismiss = () => {
    if (closeDisabledRef.current || closingRef.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || document.visibilityState === 'hidden' || document.documentElement.dataset.glassMotion === 'off') {
      closeRef.current();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    // A bounded fallback also works when CSS animations are disabled by the OS.
    closeTimer.current = setTimeout(finishDismiss, 200);
  };
  useEffect(() => {
    const prev = returnFocus || document.activeElement;
    const initial = ref.current?.querySelector('[data-modal-autofocus], input:not([type="hidden"]), textarea, select');
    (initial || ref.current)?.focus();
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
      if (e.key === "Tab") {
        const items = [
          ...ref.current.querySelectorAll(
            'button,input,select,textarea,a[href],[tabindex="0"]',
          ),
        ].filter((el) => !el.disabled && el.offsetParent !== null);
        const first = items[0],
          last = items.at(-1);
        if (!first) {
          e.preventDefault();
          ref.current?.focus();
        } else if (!ref.current.contains(document.activeElement) || document.activeElement === ref.current) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(closeTimer.current);
      document.removeEventListener("keydown", key);
      if (prev?.isConnected && !prev.closest('[inert]')) prev.focus();
      else document.querySelector('[data-dialog-return-focus]')?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      data-closing={closing ? 'true' : undefined}
      onMouseDown={(e) => e.target === e.currentTarget && dismiss()}
      onClickCapture={(event) => {
        if (closingRef.current || event.target.closest?.('[data-modal-dismiss]')) {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
      }}
      onSubmitCapture={(event) => {
        if (closingRef.current) { event.preventDefault(); event.stopPropagation(); }
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""} ${className}`}
        data-closing={closing ? 'true' : undefined}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === 'interaction-modal-out') finishDismiss();
        }}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label={t("关闭")} onClick={dismiss} disabled={closeDisabled}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

function App() {
  const { lang, t, locale } = useI18n();
  const { settings: glassSettings, setSettings: setGlassSettings, resetSettings: resetGlassSettings } = useGlassPreferences();
  const climate = useWeather();
  const mcpConnection = useMcpConnection();
  const panelRef = useRef(null);
  const rainIntensity = climate.atmosphere.rainIntensity;
  const { theme: scheduledTheme, setTheme } = useScheduledTheme({ timezone: climate.atmosphere.timezone });
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [view, setView] = useState("today"),
    [search, setSearch] = useState(""),
    [priorityFilter, setPriorityFilter] = useState("all"),
    [projectFilter, setProjectFilter] = useState("all"),
    [sort, setSort] = useState("due"),
    [filters, setFilters] = useState(false),
    [editor, setEditor] = useState(null),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(null),
    [busy, setBusy] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [selectedRun, setSelectedRun] = useState(null),
    [desktop, setDesktop] = useState(null),
    [pinBusy, setPinBusy] = useState(false),
    [completionBusy, setCompletionBusy] = useState(false),
    [showDone, setShowDone] = useState(false);
  const startup = useStartup({ ready: Boolean(data), settled: climate.initialResolved, error, enabled: glassSettings.motion,
    theme: scheduledTheme, atmosphere: deriveAtmosphere({ weather: climate.weather, location: climate.location, timezone: climate.atmosphere.timezone }) });
  const theme = useThemeTransition(scheduledTheme, glassSettings.motion && !startup.active);
  const startupScene = startup.active && <StartupScene key={startup.cycle} theme={startup.theme} lang={lang}
    phase={startup.phase} motion={startup.motion} atmosphere={startup.atmosphere} onSkip={startup.dismiss} />;
  usePanelMotion(panelRef, view, glassSettings.motion);
  const token = useRef(""),
    toastTimer = useRef(null),
    searchRef = useRef(null),
    completionPending = useRef(false),
    requestSequence = useRef(0);
  const isNight = theme === "night";
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === "night" ? "dark" : "light";
    const appName = theme === "night" ? t("夜光清单") : t("日光清单");
    document.title = lang === "en" ? appName : `${appName} · Daylight`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "night" ? "#11192b" : "#f6f5ef");
    window.daylightDesktop?.setTheme?.(theme).catch(() => {});
    try {
      localStorage.setItem("daylight-theme", theme);
    } catch {
      // Keep theme switching usable when storage is unavailable.
    }
  }, [theme, lang]);
  function message(text, kind = "success") {
    setToast({ text: t(text), kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }
  async function load() {
    const seq = ++requestSequence.current;
    try {
      const r = await fetch("/api/bootstrap");
      if (!r.ok) throw Error(t("本地服务暂时不可用"));
      const d = await r.json();
      if (seq === requestSequence.current) {
        token.current = d.csrfToken;
        setData(d);
        setError("");
      }
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    window.daylightDesktop
      ?.getInfo()
      .then(setDesktop)
      .catch(() => {});
    const timer = setInterval(load, 5000);
    return () => {
      clearInterval(timer);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    const projectIds = new Set((data.projects || []).map(project => project.id));
    if (view.startsWith("project:") && !projectIds.has(view.slice(8))) {
      setView("all");
      setProjectFilter("all");
    } else if (!["all", "general"].includes(projectFilter) && !projectIds.has(projectFilter)) {
      setProjectFilter("all");
    }
  }, [data, view, projectFilter]);
  useEffect(() => {
    const key = (e) => {
      if (!data || editor || modal || startup.active) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (
        e.key === "n" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName,
        ) &&
        !e.ctrlKey && !e.metaKey && !e.altKey
      ) {
        newTask();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [data, editor, modal, startup.active, view, projectFilter]);
  async function api(path, method = "GET", body) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Daylight-Token": token.current,
      },
      ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    const result = await res.json();
    if (!res.ok)
      throw Error(result.error || result.message || t("操作未完成，请重试"));
    return result;
  }
  async function mutate(path, method, body, success) {
    try {
      const result = await api(path, method, body);
      await load();
      if (success) message(success);
      return result;
    } catch (e) {
      message(e.message, "error");
      throw e;
    }
  }
  function navigate(next) {
    window.scrollTo({ top: 0, behavior: "instant" });
    setView(next);
    setSearch("");
    setPriorityFilter("all");
    setProjectFilter("all");
    setMobileNav(false);
  }
  async function toggle(task) {
    if (!task.completed) {
      if (!editor && !modal) setModal({ type: "complete", task, returnFocus: document.activeElement });
      return;
    }
    try {
      await mutate(
        `/tasks/${task.id}`,
        "PATCH",
        { completed: false },
        t("任务已恢复"),
      );
    } catch {}
  }
  async function confirmComplete() {
    if (completionPending.current || modal?.type !== "complete") return;
    completionPending.current = true;
    setCompletionBusy(true);
    try {
      await mutate(`/tasks/${modal.task.id}`, "PATCH", { completed: true }, t("任务已完成"));
      setModal(null);
    } catch {
    } finally {
      completionPending.current = false;
      setCompletionBusy(false);
    }
  }
  async function deleteTask(task) {
    setModal({ type: "delete", task });
  }
  async function confirmDelete() {
    setBusy(true);
    try {
      await mutate(
        `/tasks/${modal.task.id}`,
        "DELETE",
        undefined,
        t("任务已删除"),
      );
      setModal(null);
      setEditor(null);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function runTask(task) {
    try {
      const run = await mutate(
        `/tasks/${task.id}/run`,
        "POST",
        {},
        t("任务已交给 Codex"),
      );
      setSelectedRun(run);
      setModal({ type: "run", id: run.id });
    } catch {}
  }
  if (!data)
    return (
      <>{startupScene}<div className="loading-screen" inert={startup.active}>
        {isNight ? <Moon size={42} /> : <Sun size={42} />}
        <h1>{isNight ? t("夜光清单") : t("日光清单")}</h1>
        <p>{error || t("正在打开你的本地工作空间…")}</p>
        {error && (
          <button className="primary" onClick={load}>{t("重新连接")}</button>
        )}
      </div></>
    );
  const tasks = data.tasks || [],
    projects = data.projects || [],
    notifications = data.notifications || [],
    runs = data.runs || [];
  const active = tasks.filter((t) => !t.completed),
    todayTasks = tasks.filter((t) => t.dueAt && dateKey(t.dueAt) === today()),
    todayDone = todayTasks.filter((t) => t.completed).length;
  const unread = notifications.filter((n) => !n.read).length,
    scheduled = active.filter((t) => t.automation?.enabled),
    currentProject = projects.find((p) => view === `project:${p.id}`);
  const projectIds = new Set(projects.map(project => project.id));
  const selectedProject = currentProject?.id ||
    (projectFilter === "general" || projectIds.has(projectFilter) ? projectFilter : "all");
  function selectProject(value) {
    if (view.startsWith("project:") && value !== currentProject?.id) setView("all");
    setProjectFilter(value);
  }
  const navItems = [
    [
      "today",
      isNight ? Moon : Sun,
      t("今天"),
      active.filter((t) => t.dueAt && dateKey(t.dueAt) <= today()).length,
    ],
    ["upcoming", CalendarDays, t("即将到来"), null],
    ["all", Inbox, t("全部任务"), active.length],
    [
      "completed",
      CheckCheck,
      t("已完成"),
      tasks.filter((t) => t.completed).length,
    ],
  ];
  const title =
    currentProject?.name ||
    {
      today: t("今天"),
      upcoming: t("即将到来"),
      all: t("全部任务"),
      completed: t("已完成"),
      automation: t("Codex 调度"),
    }[view] || t("全部任务");
  let filtered = tasks.filter((t) => {
    if (view === "completed" && !t.completed) return false;
    if (view !== "completed" && t.completed && !showDone) return false;
    if (view === "today" && (!t.dueAt || dateKey(t.dueAt) > today()))
      return false;
    if (view === "upcoming" && (!t.dueAt || dateKey(t.dueAt) <= today()))
      return false;
    if (selectedProject === "general" && projectIds.has(t.projectId)) return false;
    if (!["all", "general"].includes(selectedProject) && t.projectId !== selectedProject) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    return `${t.title} ${t.notes}`.toLowerCase().includes(search.toLowerCase());
  });
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  filtered.sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (sort === "priority"
        ? priorityOrder[a.priority] - priorityOrder[b.priority]
        : sort === "created"
          ? new Date(b.createdAt) - new Date(a.createdAt)
          : new Date(a.dueAt || "2099-01-01") -
            new Date(b.dueAt || "2099-01-01")),
  );
  const groups = [];
  for (const task of filtered) {
    let label =
      view === "today"
        ? task.completed
          ? t("已完成")
          : dateKey(task.dueAt) < today()
            ? t("逾期待办")
            : t("今日待办")
        : view === "upcoming"
          ? new Date(task.dueAt).toLocaleDateString(locale, {
              month: "long",
              day: "numeric",
              weekday: "long",
            })
          : task.completed
            ? t("已完成")
            : t("待办任务");
    let group = groups.find((g) => g.label === label);
    if (!group) {
      group = { label, tasks: [] };
      groups.push(group);
    }
    group.tasks.push(task);
  }
  const nearest = active
    .filter((t) => t.dueAt && new Date(t.dueAt) > new Date())
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
    .slice(0, 3);
  const newTask = () =>
    setEditor({
      ...blankTask(),
      projectId: projectIds.has(selectedProject) ? selectedProject : null,
      ...(view === "today"
        ? { dueAt: new Date(new Date().setHours(18, 0, 0, 0)).toISOString() }
        : {}),
    });
  async function loadExamples() {
    setBusy(true);
    try {
      const dateAt = (days, hour) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        d.setHours(hour, 0, 0, 0);
        return d.toISOString();
      };
      const project = await api("/projects", "POST", {
        name: "开始使用",
        color: "#7A8F73",
      });
      for (const item of [
        {
          title: "规划今天最重要的三件事",
          notes: "点击任务可以编辑详情。把大目标拆成轻松开始的小步骤。",
          dueAt: dateAt(0, 10),
          priority: "high",
        },
        {
          title: "给下一项任务设置提醒",
          notes:
            "打开任务详情，设置提醒时间。开启桌面提醒后，本地服务会在到点时通知你。",
          dueAt: dateAt(0, 15),
          priority: "medium",
        },
        {
          title: "了解 Codex 自动调度",
          notes:
            "进入左侧 Codex 调度。填写任务指令和工作目录，再决定手动执行或定时运行。",
          dueAt: dateAt(0, 18),
          priority: "low",
        },
        {
          title: "为明天留一点余地",
          notes: "这些都是入门示例任务，可以自由编辑或删除。",
          dueAt: dateAt(1, 10),
          priority: "low",
        },
      ])
        await api("/tasks", "POST", {
          ...blankTask(),
          ...item,
          projectId: project.id,
        });
      await load();
      message(t("已添加 4 项入门示例，可自由编辑或删除"));
    } catch (e) {
      message(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>{startupScene}<div className={`app-shell ${mobileNav ? "nav-expanded" : ""}`} inert={startup.active}>
      <div className="glass-environment" aria-hidden="true" />
      <SkyAtmosphere atmosphere={climate.atmosphere} animated={glassSettings.motion} night={isNight} />
      <RainField intensity={rainIntensity} animated={glassSettings.motion} night={isNight} storm={climate.atmosphere.condition === 'storm'} />
      {mobileNav && (
        <div className="sidebar-scrim" onClick={() => setMobileNav(false)} />
      )}
      <aside
        className={`sidebar ${mobileNav ? "open" : ""}`}
        inert={!!(editor || modal)}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.setProperty("--light-x", `${event.clientX - bounds.left}px`);
          event.currentTarget.style.setProperty("--light-y", `${event.clientY - bounds.top}px`);
          event.currentTarget.style.setProperty("--light-active", "1");
        }}
        onPointerLeave={(event) => {
          event.currentTarget.style.setProperty("--light-active", "0");
        }}
      >
        <div className="sidebar-atmosphere" aria-hidden="true">
          <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
          <div className="glass-caustics" />
          {isNight
            ? <MilkyWay className="sidebar-milky-way" animated={glassSettings.motion} />
            : <LiquidRibbon night={false} className="sidebar-liquid-ribbon" animated={glassSettings.motion} />}
          <div className="daylight-botanical">
            <Sunflower className="sidebar-sunflower" />
            <Sunflower className="sidebar-sunflower-small" />
          </div>
          <div className="glass-stars" />
        </div>
        <div className="brand">
          <div className="brand-mark">
            {isNight ? <Moon size={26} /> : <SunflowerMark className="sunflower-mark" />}
          </div>
          <div>
            <strong>
              {isNight ? t("夜光清单") : t("日光清单")}
            </strong>
          </div>
          <IconButton
            label={t("收起导航")}
            className="icon-button mobile-only"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </IconButton>
        </div>
        <button
          className="theme-toggle"
          type="button"
          role="switch"
          aria-checked={isNight}
          aria-label={t("夜晚模式")}
          title={isNight ? t("切换到日光") : t("切换到夜晚")}
          onClick={() => setTheme(current => current === "night" ? "day" : "night")}
        >
          <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
          <span className={`theme-option ${!isNight ? "active" : ""}`}><Sun size={16} /><span>{t("日光")}</span></span>
          <span className={`theme-option ${isNight ? "active" : ""}`}><Moon size={16} /><span>{t("夜晚")}</span></span>
        </button>
        <button
          className="workspace"
          onClick={() => setModal({ type: "settings" })}
        >
          <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
          <span className="avatar">D</span>
          <span className="workspace-label">{t("我的工作空间")}</span>
          <ChevronDown size={14} />
        </button>
        <nav>
          {navItems.map(([id, Icon, label, count]) => (
            <button
              key={id}
              data-view={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
              <Icon size={18} />
              <span>{label}</span>
              {count > 0 && <span className="nav-count">{count}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <button
          className={`nav-item ${view === "automation" ? "active" : ""}`}
          data-view="automation"
          aria-current={view === "automation" ? "page" : undefined}
          onClick={() => navigate("automation")}
        >
          <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
          <Sparkles size={18} />
          <span>{t("Codex 调度")}</span>
          <span className="mini-tag">AI</span>
        </button>
        <div className="project-header">
          <span className="nav-caption">{t("我的项目")}</span>
          <IconButton
            label={t("新建项目")}
            onClick={() => setModal({ type: "project" })}
          >
            <Plus size={16} />
          </IconButton>
        </div>
        <div className="project-nav">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`nav-item ${currentProject?.id === p.id ? "active" : ""}`}
              aria-current={currentProject?.id === p.id ? "page" : undefined}
              onClick={() => navigate(`project:${p.id}`)}
            >
              <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
              <span
                className="project-dot"
                style={{ background: p.color || "#7A8F73" }}
              />
              <span>{p.name}</span>
              <small>
                {active.filter((t) => t.projectId === p.id).length || ""}
              </small>
            </button>
          ))}
          {!projects.length && (
            <button
              className="add-project"
              onClick={() => setModal({ type: "project" })}
            >
              <Plus size={14} />{t("新建项目")}</button>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={() => setModal({ type: "settings" })}
          >
            <Settings size={18} />
            <span>{t("设置与连接")}</span>
          </button>
          <button
            className="nav-item"
            onClick={() => setModal({ type: "help" })}
          >
            <CircleHelp size={18} />
            <span>{t("使用指南")}</span>
            <ArrowUpRight size={14} />
          </button>
        </div>
      </aside>
      <div className="workspace-shell" inert={!!(editor || modal)}>
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              label={t("切换导航")}
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu className="mobile-only" size={18} />
              <PanelLeftClose className="desktop-only" size={17} />
            </IconButton>
            <span>{t("我的工作空间")}</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`saved-status ${error ? "offline" : ""}`}>
              <i />
              {error ? t("正在重新连接") : t("已保存到本地")}
            </span>
            <span className="topbar-divider" />
            {desktop && (
              <button
                className={`window-pin ${desktop.alwaysOnTop ? "active" : ""}`}
                aria-label={desktop.alwaysOnTop ? t("取消窗口置顶") : t("置顶窗口")}
                title={
                  desktop.alwaysOnTop
                    ? t("取消窗口置顶")
                    : t("让窗口保持在其他窗口上方")
                }
                aria-pressed={!!desktop.alwaysOnTop}
                disabled={pinBusy}
                onClick={async () => {
                  setPinBusy(true);
                  try {
                    const result = await window.daylightDesktop.setAlwaysOnTop(
                      !desktop.alwaysOnTop,
                    );
                    setDesktop((current) => ({ ...current, ...result }));
                  } catch (error) {
                    message(error.message, "error");
                  } finally {
                    setPinBusy(false);
                  }
                }}
              >
                {desktop.alwaysOnTop ? <PinOff size={16} /> : <Pin size={16} />}
                <span>{desktop.alwaysOnTop ? t("已置顶") : t("置顶")}</span>
              </button>
            )}
            <IconButton
              label={t(`通知${unread ? `，${unread} 条未读` : ""}`, `Notifications${unread ? `, ${unread} unread` : ""}`)}
              onClick={() => setModal({ type: "notifications" })}
            >
              <Bell size={18} />
              {unread > 0 && <span className="unread-dot" />}
            </IconButton>
            <span className="small-avatar">D</span>
          </div>
        </header>
        {error && (
          <div role="alert" className="connection-error">
            <CircleAlert size={16} />{t("连接中断，正在重试。已保存的任务仍在本地。")}<button onClick={load}>{t("立即重试")}</button>
          </div>
        )}
        <div
          className={`content-layout ${view === "automation" ? "automation-layout" : ""}`}
        >
          <main className="main-content" ref={panelRef} data-panel-view={view}>
            <div className="weather-heading">
            <div className="heading-meta">
            {view === "today" && <div className="page-eyebrow">
              {new Date().toLocaleDateString(locale, {
                    month: "long",
                    day: "numeric",
                    weekday: "long",
                  })}
            </div>}
            <WeatherBadge climate={climate} onClick={() => setModal({ type: "settings" })} />
            </div>
            <div className="page-heading">
              <div>
                <h1>
                  {title}
                </h1>
              </div>
              <button
                className="primary"
                data-dialog-return-focus
                onClick={
                  view === "automation"
                    ? () =>
                        setEditor({
                          ...blankTask(),
                          automation: {
                            ...blankTask().automation,
                            prompt:
                              "请总结这个工作目录的当前状态，并列出下一步建议。",
                          },
                        })
                    : newTask
                }
              >
                <Plus size={17} />
                {view === "automation" ? t("新建调度") : t("新建任务")}
                <kbd>N</kbd>
              </button>
            </div>
            </div>
            {view === "automation" ? (
              <AutomationView
                tasks={tasks}
                runs={runs}
                codex={data.codex}
                mcpConnection={mcpConnection}
                onEdit={setEditor}
                onRun={runTask}
                onToggle={async (task) => {
                  if (
                    !task.automation.enabled &&
                    (!task.automation.runAt ||
                      new Date(task.automation.runAt) <= new Date())
                  ) {
                    setEditor({
                      ...task,
                      _originalTask: task,
                      automation: {
                        ...task.automation,
                        enabled: true,
                        runAt: null,
                      },
                    });
                    return;
                  }
                  try {
                    await mutate(
                      `/tasks/${task.id}`,
                      "PATCH",
                      { automation: { enabled: !task.automation.enabled } },
                      task.automation.enabled ? t("调度已暂停") : t("调度已开启"),
                    );
                  } catch {}
                }}
                onHistory={(run) => {
                  setSelectedRun(run);
                  setModal({ type: "run", id: run.id });
                }}
                onConnect={() => setModal({ type: "help" })}
              />
            ) : (
              <>
                <div className="list-toolbar">
                  <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
                  <div className="view-tabs">
                    <span className="selected view-tab-label">
                      <FileText size={15} />{t("清单视图")}</span>
                    <span className="item-count">{t(`${filtered.length} 项任务`, `${filtered.length} ${filtered.length === 1 ? "task" : "tasks"}`)}</span>
                  </div>
                  <div className="list-tools">
                    <div className="search-wrap">
                      <Search size={15} />
                      <input
                        ref={searchRef}
                        aria-label={t("搜索任务")}
                        placeholder={t("搜索任务")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <kbd>Ctrl K</kbd>
                    </div>
                    <IconButton
                      label={t("筛选与排序")}
                      aria-expanded={filters}
                      aria-controls="task-filters"
                      onClick={() => setFilters(value => !value)}
                    >
                      <SlidersHorizontal size={17} />
                    </IconButton>
                  </div>
                </div>
                <div className="motion-disclosure" data-open={filters ? 'true' : 'false'}
                  id="task-filters" aria-hidden={!filters} inert={!filters}>
                  <div className="motion-disclosure-inner">
                  <div className="filter-bar">
                    <label>{t("优先级")}<select
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value)}
                      >
                        <option value="all">{t("全部")}</option>
                        {Object.entries(priorities).map(([k, v]) => (
                          <option key={k} value={k}>
                            {t(v)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>{t("排序")}<select
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="due">{t("到期时间")}</option>
                        <option value="priority">{t("优先级")}</option>
                        <option value="created">{t("最新添加")}</option>
                      </select>
                    </label>
                    {view !== "completed" && (
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={showDone}
                          onChange={(e) => setShowDone(e.target.checked)}
                        />{t("显示已完成")}</label>
                    )}
                    {currentProject && (
                      <button
                        className="text-danger"
                        onClick={() =>
                          setModal({
                            type: "delete-project",
                            project: currentProject,
                          })
                        }
                      >{t("删除项目")}</button>
                    )}
                  </div>
                  </div>
                </div>
                <div className={`group-heading task-project-heading ${groups[0]?.label === t("逾期待办") ? "overdue" : ""}`}>
                  <ChevronDown size={14} aria-hidden="true" />
                  <h3>{groups[0]?.label || (view === "completed" ? t("已完成") : t("待办任务"))}</h3>
                  <span>{groups[0]?.tasks.length || 0}</span>
                  <label className="project-filter-control">
                    <Folder size={14} aria-hidden="true" />
                    <select id="task-project-filter" aria-label={t("按项目筛选")}
                      value={selectedProject} onChange={event => selectProject(event.target.value)}>
                      <option value="all">{t("全部项目")}</option>
                      <option value="general">{t("常规")}</option>
                      {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                    <ChevronDown size={13} aria-hidden="true" />
                  </label>
                </div>
                {!tasks.length ? (
                  <div className="welcome-panel">
                    <div className="welcome-art">
                      <div className="art-orbit" />
                      {isNight ? <Moon size={52} /> : <Sunrise size={52} />}
                      <span className="art-spark spark-one">✦</span>
                      <span className="art-spark spark-two">✦</span>
                    </div>
                    <h2>{t("还没有任务")}</h2>
                    <button className="primary" onClick={newTask}>
                      <Plus size={17} />{t("添加第一项任务")}</button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={loadExamples}
                    >{t("体验入门示例")}<ArrowRight size={14} />
                    </button>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="empty-state">
                    <CheckCheck size={38} />
                    <h2>
                      {search
                        ? t("没有找到这项任务")
                        : view === "today"
                          ? t("今天暂无待办")
                          : t("这里还没有任务")}
                    </h2>
                    <p>
                      {search
                        ? t("试试其他关键词，或切换到全部任务。")
                        : view === "today"
                          ? t("今天到期和逾期的待办会显示在这里。")
                          : t("创建任务或调整筛选条件。")}
                    </p>
                    <button className="text-button" onClick={newTask}>
                      <Plus size={16} />{t("添加任务")}</button>
                  </div>
                ) : (
                  <TaskMotionArea ids={groups.flatMap(group => group.tasks.map(task => task.id))} enabled={glassSettings.motion}>
                  {groups.map((group, index) => (
                    <section className="task-group" key={group.label}>
                      {index > 0 && <div
                        className={`group-heading ${group.label === t("逾期待办") ? "overdue" : ""}`}
                      >
                        <ChevronDown size={14} />
                        <h3>{group.label}</h3>
                        <span>{group.tasks.length}</span>
                      </div>}
                      {group.tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          project={projects.find(
                            (p) => p.id === task.projectId,
                          )}
                          onToggle={toggle}
                          onEdit={setEditor}
                          onDelete={deleteTask}
                          rainIntensity={rainIntensity}
                          animated={glassSettings.motion}
                        />
                      ))}
                    </section>
                  ))}
                  </TaskMotionArea>
                )}
                {tasks.length > 0 && (
                  <button className="add-task-inline" onClick={newTask}>
                    <Plus size={19} />
                    <span>{t("添加一项任务")}</span>
                    <kbd>N</kbd>
                  </button>
                )}
              </>
            )}
          </main>
          {view !== "automation" && (
            <aside className="daily-sidebar">
              <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
              <div className="side-section-title">
                <h2>{t("今日概览")}</h2>
                {isNight ? <Moon size={17} /> : <Sun size={17} />}
              </div>
              <section className="progress-card">
                <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
                <div
                  className="progress-circle"
                  style={{
                    "--progress": `${todayTasks.length ? (todayDone / todayTasks.length) * 100 : 0}%`,
                  }}
                >
                  <div>
                    <strong>
                      {todayDone}
                      <span>/{todayTasks.length}</span>
                    </strong>
                    <small>{t("已完成")}</small>
                  </div>
                </div>
                <p>
                  {todayTasks.length
                    ? t(`还有 ${todayTasks.length - todayDone} 项今日任务待完成`, `${todayTasks.length - todayDone} task${todayTasks.length - todayDone === 1 ? "" : "s"} left today`)
                    : t("今天暂无任务")}
                </p>
                <div className="progress-stats">
                  <div>
                    <strong>
                      {active.filter((t) => t.priority === "high").length}
                    </strong>
                    <span>
                      <Flag size={12} />{t("重要待办")}</span>
                  </div>
                  <div>
                    <strong>
                      {
                        active.filter(
                          (t) =>
                            t.reminderAt && new Date(t.reminderAt) > new Date(),
                        ).length
                      }
                    </strong>
                    <span>
                      <Bell size={12} />{t("待提醒")}</span>
                  </div>
                </div>
              </section>
              <section className="agenda-section">
                <GlassRain intensity={rainIntensity} animated={glassSettings.motion} />
                <div className="side-section-title">
                  <h2>{t("接下来")}</h2>
                  <Clock3 size={16} />
                </div>
                {nearest.length ? (
                  nearest.map((task, index) => (
                    <button
                      className="agenda-item"
                      key={task.id}
                      onClick={() => setEditor(task)}
                    >
                      <span className="timeline-dot" />
                      <div>
                        <small>{dateLabel(task.dueAt, lang)}</small>
                        <strong>{task.title}</strong>
                        <span>
                          {projects.find((p) => p.id === task.projectId)
                            ?.name || t("我的任务")}
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="agenda-empty">
                    <span className="empty-line" />
                    <p>{t("暂无后续安排")}</p>
                  </div>
                )}
              </section>
              <LanguageSwitch rainIntensity={rainIntensity} animated={glassSettings.motion} />
            </aside>
          )}
        </div>
      </div>
      {editor && !modal && (
        <TaskEditor
          task={editor}
          projects={projects}
          onClose={() => setEditor(null)}
          onDelete={() => {
            setEditor(null);
            deleteTask(editor);
          }}
          onSave={async (value) => {
            await mutate(
              editor.id ? `/tasks/${editor.id}` : "/tasks",
              editor.id ? "PATCH" : "POST",
              value,
              editor.id ? t("任务已更新") : t("新任务已添加"),
            );
            setEditor(null);
          }}
        />
      )}
      {modal?.type === "complete" && (
        <Modal
          title={t("确认完成任务")}
          className="completion-confirm"
          returnFocus={modal.returnFocus}
          closeDisabled={completionBusy}
          onClose={() => {
            if (!completionPending.current) setModal(null);
          }}
        >
          <div className="modal-body">
            <div className="completion-icon" aria-hidden="true"><CheckCheck size={27} /></div>
            <p className="completion-task">{modal.task.title}</p>
            <p className="hint">{t("完成后可在「已完成」中查看或恢复。")}</p>
          </div>
          <div className="modal-footer">
            <button className="secondary" data-modal-dismiss data-modal-autofocus disabled={completionBusy}>{t("取消")}</button>
            <button className="primary" disabled={completionBusy} onClick={confirmComplete}>
              {completionBusy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
              {completionBusy ? t("正在完成…") : t("确认完成")}
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "delete" && (
        <Modal
          title={t("删除这项任务？")}
          subtitle={t("删除后无法恢复，执行记录仍会保留。")}
          closeDisabled={busy}
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <p className="delete-preview">{modal.task.title}</p>
          </div>
          <div className="modal-footer">
            <button className="secondary" data-modal-dismiss disabled={busy}>{t("保留任务")}</button>
            <button className="danger" disabled={busy} onClick={confirmDelete}>{t("删除任务")}</button>
          </div>
        </Modal>
      )}
      {modal?.type === "project" && (
        <ProjectModal
          onClose={() => setModal(null)}
          onSave={async (value) => {
            await mutate("/projects", "POST", value, t("项目已创建"));
            setModal(null);
          }}
        />
      )}
      {modal?.type === "delete-project" && (
        <Modal
          title={t(`删除「${modal.project.name}」？`, `Delete “${modal.project.name}”?`)}
          subtitle={t("项目中的任务会保留，并移到全部任务中。")}
          onClose={() => setModal(null)}
        >
          <div className="modal-footer">
            <button className="secondary" data-modal-dismiss>{t("取消")}</button>
            <button
              className="danger"
              onClick={async () => {
                try {
                  await mutate(
                    `/projects/${modal.project.id}`,
                    "DELETE",
                    undefined,
                    t("项目已删除"),
                  );
                  setModal(null);
                  navigate("all");
                } catch {}
              }}
            >{t("删除项目")}</button>
          </div>
        </Modal>
      )}
      {modal?.type === "notifications" && (
        <Modal
          title={t("提醒收件箱")}
          subtitle={t(`${unread} 条未读`, `${unread} unread`)}
          onClose={() => setModal(null)}
        >
          <div className="notification-list">
            {notifications.length ? (
              <>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await mutate(
                        "/notifications/read-all",
                        "POST",
                        {},
                        t("已全部标为已读"),
                      );
                    } catch {}
                  }}
                >
                  <CheckCheck size={15} />{t("全部标为已读")}</button>
                {notifications.map((n) => (
                  <button
                    className={`notification ${n.read ? "read" : ""}`}
                    key={n.id}
                    onClick={async () => {
                      try {
                        await mutate(`/notifications/${n.id}`, "PATCH", {
                          read: true,
                        });
                        const task = tasks.find((t) => t.id === n.taskId);
                        if (task) {
                          setModal(null);
                          setEditor(task);
                        }
                      } catch {}
                    }}
                  >
                    <span className="notification-icon">
                      {n.type === "error" ? (
                        <CircleAlert size={19} />
                      ) : (
                        <Bell size={19} />
                      )}
                    </span>
                    <div>
                      <strong>{n.title}</strong>
                      <p>{n.body}</p>
                      <small>{dateLabel(n.createdAt, lang)}</small>
                    </div>
                    {!n.read && <i />}
                  </button>
                ))}
              </>
            ) : (
              <div className="empty-state">
                <Bell size={34} />
                <h3>{t("还没有新的提醒")}</h3>
                <p>{t("任务提醒与 Codex 运行结果会出现在这里。")}</p>
              </div>
            )}
          </div>
        </Modal>
      )}
      {modal?.type === "settings" && (
        <Modal
          title={t("设置与连接")}
          onClose={() => setModal(null)}
        >
          <div className="modal-body settings-body">
            <WeatherSettings climate={climate} />
            <GlassSettings settings={glassSettings} onChange={setGlassSettings} onReset={resetGlassSettings} />
            <section>
              <div className="setting-row">
                <h3><Play size={17} />{t('开场动画', 'Opening animation')}</h3>
                <button className="secondary" data-replay-startup disabled={!glassSettings.motion || window.matchMedia('(prefers-reduced-motion: reduce)').matches}
                  onClick={() => { setModal(null); startup.replay(); }}>
                  <Play size={15} />{t('重播', 'Replay')}
                </button>
              </div>
            </section>
            <section className="theme-schedule-info" aria-label={t('主题定时', 'Theme schedule')}>
              <h3><Moon size={17} />{t('主题定时', 'Theme schedule')}</h3>
              <div><span><Moon size={15} />19:00 {t('夜晚', 'Night')}</span><span><Sun size={15} />07:00 {t('日光', 'Day')}</span></div>
              <p>{t('按电脑时间切换；手动选择保留至下次定时切换或退出应用。', 'Uses your computer’s time; manual choices last until the next scheduled switch or app exit.')}</p>
            </section>
            <LanguageSwitch />
            {desktop && (
              <section>
                <h3>
                  <Laptop size={17} />{t("Windows 桌面应用")}</h3>
                <div className="setting-row">
                  <div>
                    <strong>{t("登录 Windows 时启动")}</strong>
                    <p>{t("启动后保持在系统托盘，按时提醒。")}</p>
                  </div>
                  <button
                    role="switch"
                    aria-label={t("登录 Windows 时启动")}
                    aria-checked={desktop.autoLaunch}
                    className={`switch ${desktop.autoLaunch ? "on" : ""}`}
                    onClick={async () => {
                      try {
                        const result =
                          await window.daylightDesktop.setAutoLaunch(
                            !desktop.autoLaunch,
                          );
                        setDesktop({ ...desktop, ...result });
                        message(t("启动设置已保存"));
                      } catch (e) {
                        message(e.message, "error");
                      }
                    }}
                  >
                    <span />
                  </button>
                </div>
                <p className="hint">{t("关闭窗口会收起到系统托盘。右键托盘图标选择「退出」才会停止提醒和调度。")}</p>
              </section>
            )}
            <section>
              <h3>
                <Bell size={17} />{t("桌面提醒")}</h3>
              <div className="setting-row">
                <div>
                  <strong>{t("Windows 桌面通知")}</strong>
                  <p>{t("到达提醒时间时，在桌面显示通知。")}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={!!data.settings?.desktopNotifications}
                  aria-label={t("Windows 桌面通知")}
                  className={`switch ${data.settings?.desktopNotifications ? "on" : ""}`}
                  onClick={async () => {
                    try {
                      await mutate(
                        "/settings",
                        "PATCH",
                        {
                          desktopNotifications:
                            !data.settings?.desktopNotifications,
                        },
                        t("提醒设置已保存"),
                      );
                    } catch {}
                  }}
                >
                  <span />
                </button>
              </div>
              <p className="hint">
                {desktop
                  ? t("应用在系统托盘中运行时也能提醒。请让电脑保持唤醒，检查 Windows 的通知和勿扰设置。")
                  : t("提醒与调度需要本地服务运行、电脑保持唤醒。关闭网页后，后台服务仍可工作。")}
              </p>
            </section>
            <McpConnection connection={mcpConnection} />
            <section>
              <h3>
                <Download size={17} />{t("数据与备份")}</h3>
              <p>{t("任务、提醒和执行记录保存在本机，升级应用不会清空任务。")}</p>
              <p className="data-path">
                {desktop?.dataPath || "data/store.json"}
              </p>
              {desktop && (
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await window.daylightDesktop.openDataFolder();
                    } catch (e) {
                      message(e.message, "error");
                    }
                  }}
                >
                  <Folder size={15} />{t("打开数据目录")}</button>
              )}
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    const result = await api("/export");
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(result, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `daylight-backup-${today()}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    message(t("备份已导出"));
                  } catch (e) {
                    message(e.message, "error");
                  }
                }}
              >
                <Download size={16} />{t("导出 JSON 备份")}</button>
            </section>
          </div>
        </Modal>
      )}
      {modal?.type === "help" && (
        <Modal
          title={t("使用指南")}
          subtitle={t("本地管理 + Codex 协作")}
          onClose={() => setModal(null)}
          wide
        >
          <div className="modal-body help-body">
            <div className="help-step">
              <span>01</span>
              <div>
                <h3>{t("写下任务，设好提醒")}</h3>
                <p>{t("新建任务可以设置项目、优先级、到期时间与独立提醒。点击任务编辑；勾选圆圈后确认完成。使用「筛选与排序」显示已完成任务。")}</p>
              </div>
            </div>
            <div className="help-step">
              <span>02</span>
              <div>
                <h3>{t("把重复工作交给 Codex")}</h3>
                <p>{t("在任务编辑面板展开 Codex 指令，填写提示词和本地工作目录。保存后可手动运行，或开启定时调度。支持单次、每天、工作日和每周。")}</p>
                <p>{t("默认只读。需要修改文件时，选择「允许写入工作目录」。Codex 调用会使用你的账户额度；运行详情中可查看输出或取消。")}</p>
              </div>
            </div>
            <div className="help-step">
              <span>03</span>
              <div>
                <h3>{t("在 Codex 中直接管理任务")}</h3>
                <p>
                  {desktop
                    ? t("启动时会自动连接本机 Codex。可在「设置与连接」查看工具状态；首次连接后请打开新的 Codex 聊天。", "Daylight connects to local Codex on startup. Check tool status in Settings; open a new Codex chat after the first connection.")
                    : t("在应用目录运行 scripts/Install-Codex-MCP.ps1，安装本地 MCP 连接，然后重新打开 Codex 会话。")}
                </p>
                <div className="example-prompt">{t("“在日光清单里创建一项任务：明天下午三点检查报告，提前十分钟提醒我。”")}</div>
                <p>{t("连接后支持查询、新建、修改、删除任务与触发调度。")}</p>
              </div>
            </div>
            <div className="help-note">
              <Laptop size={19} />
              <p>
                {desktop
                  ? t("从开始菜单打开「日光清单」。关闭窗口后，应用继续在系统托盘运行。右键托盘可以完全退出；电脑休眠和关机时无法提醒或执行。")
                  : t("Windows 用户可安装 Daylight 安装版，或直接运行免安装版。开发模式也可使用 Start-Daylight.cmd。")}
              </p>
            </div>
            <a
              className="text-button"
              href="https://www.figma.com/design/UHEyr1qqi1WspOuH8QJVvP"
              target="_blank"
              rel="noreferrer"
            >{t("查看 Figma 设计稿")}<ArrowUpRight size={14} />
            </a>
          </div>
        </Modal>
      )}
      {modal?.type === "run" && (
        <RunModal
          run={runs.find((r) => r.id === modal.id) || selectedRun}
          onClose={() => setModal(null)}
          onCancel={async (run) => {
            try {
              await mutate(
                `/runs/${run.id}/cancel`,
                "POST",
                {},
                t("已发送取消请求"),
              );
            } catch {}
          }}
        />
      )}
      {toast && (
        <div role="status" className={`toast ${toast.kind}`}>
          <span>
            {toast.kind === "error" ? (
              <CircleAlert size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )}
          </span>
          {toast.text}
          <IconButton label={t("关闭提示")} onClick={() => setToast(null)}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div></>
  );
}

function TaskMotionArea({ children, ids, enabled }) {
  const list = useRef(null);
  useTaskMotion(list, ids, enabled);
  return <div ref={list} className="task-list">{children}</div>;
}

function TaskRow({ task, project, onToggle, onEdit, onDelete, rainIntensity = 0, animated = true }) {
  const { lang, t } = useI18n();
  const overdue =
    task.dueAt && !task.completed && new Date(task.dueAt) < new Date();
  return (
    <div className={`task-row ${task.completed ? "completed" : ""}`} data-task-id={task.id}>
      <GlassRain intensity={rainIntensity} animated={animated} />
      <button
        className={`task-checkbox ${task.priority}`}
        role="checkbox"
        aria-checked={task.completed}
        aria-label={t(`${task.completed ? "恢复" : "完成"}任务：${task.title}`, `${task.completed ? "Restore" : "Complete"} task: ${task.title}`)}
        onClick={() => onToggle(task)}
      >
        {task.completed && <Check size={13} />}
      </button>
      <button className="task-main" onClick={() => onEdit(task)}>
        <span className="task-title">
          {task.title}
          {task.automation?.prompt && (
            <Sparkles className="task-ai" size={13} />
          )}
        </span>
        <span className="task-meta">
          <span className="task-project-label">
            <i style={{ background: project?.color || "var(--muted)" }} />
            {project?.name || t("常规")}
          </span>
          {task.notes && <FileText size={11} />}
          <span className={overdue ? "overdue" : ""}>
            {task.dueAt && (
              <>
                <CalendarDays size={12} />
                {dateLabel(task.dueAt, lang)}
              </>
            )}
          </span>
          {task.reminderAt && (
            <span title={t(`提醒：${dateLabel(task.reminderAt, lang)}`, `Reminder: ${dateLabel(task.reminderAt, lang)}`)}>
              <Bell size={12} />
              {time(task.reminderAt, lang)}
            </span>
          )}
        </span>
      </button>
      {task.priority !== "low" && (
        <span className={`priority-label ${task.priority}`}>
          <Flag size={11} />
          {task.priority === "high" ? t("高优先级") : t("中优先级")}
        </span>
      )}
      <IconButton
        label={t(`编辑任务：${task.title}`, `Edit task: ${task.title}`)}
        onClick={() => onEdit(task)}
      >
        <MoreHorizontal size={19} />
      </IconButton>
      <IconButton
        label={t(`删除任务：${task.title}`, `Delete task: ${task.title}`)}
        className="icon-button row-delete"
        onClick={() => onDelete(task)}
      >
        <Trash2 size={15} />
      </IconButton>
    </div>
  );
}

function TaskEditor({ task, projects, onClose, onSave, onDelete }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
      ...blankTask(),
      ...task,
      automation: { ...blankTask().automation, ...task.automation },
    }),
    [automationOpen, setAutomationOpen] = useState(!!task.automation?.prompt),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const changeAI = (key, value) =>
    setForm((f) => ({ ...f, automation: { ...f.automation, [key]: value } }));
  async function save(e) {
    e.preventDefault();
    setError("");
    if (!form.title.trim()) {
      setError(t("请给任务起一个名字。"));
      return;
    }
    if (
      (form.automation.enabled || form.automation.prompt.trim()) &&
      (!form.automation.prompt.trim() || !form.automation.workspace.trim())
    ) {
      setError(t("使用 Codex 需要同时填写执行指令和工作目录。"));
      return;
    }
    if (form.automation.enabled && !form.automation.runAt) {
      setError(t("请设置首次运行时间。"));
      return;
    }
    setSaving(true);
    try {
      await onSave(taskPayload(task._originalTask || task, form));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={task.id ? t("任务详情") : t("添加一项新任务")}
      onClose={onClose}
      closeDisabled={saving}
      wide
    >
      <form onSubmit={save}>
        <div className="modal-body task-form">
          <label className="field title-field">{t("任务名称")}<input
              autoFocus
              value={form.title}
              maxLength={200}
              placeholder={t("输入任务名称")}
              onChange={(e) => change("title", e.target.value)}
              required
            />
          </label>
          <label className="field">{t("备注")}<textarea
              value={form.notes}
              maxLength={20000}
              placeholder={t("添加说明、链接，或把步骤写在这里…")}
              rows={3}
              onChange={(e) => change("notes", e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>
                <Folder size={14} />{t("所属项目")}</span>
              <select
                value={form.projectId || ""}
                onChange={(e) => change("projectId", e.target.value || null)}
              >
                <option value="">{t("常规")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                <Flag size={14} />{t("优先级")}</span>
              <select
                value={form.priority}
                onChange={(e) => change("priority", e.target.value)}
              >
                {Object.entries(priorities).map(([k, v]) => (
                  <option value={k} key={k}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                <CalendarDays size={14} />{t("到期时间")}</span>
              <input
                type="datetime-local"
                value={localInput(form.dueAt)}
                onChange={(e) => change("dueAt", toISO(e.target.value))}
              />
            </label>
            <label className="field">
              <span>
                <Bell size={14} />{t("提醒时间")}</span>
              <input
                type="datetime-local"
                value={localInput(form.reminderAt)}
                onChange={(e) => change("reminderAt", toISO(e.target.value))}
              />
            </label>
          </div>
          <div className="reminder-shortcuts">
            <span>{t("快速提醒")}</span>
            <button
              type="button"
              onClick={() =>
                change(
                  "reminderAt",
                  new Date(Date.now() + 10 * 60000).toISOString(),
                )
              }
            >{t("10 分钟后")}</button>
            <button
              type="button"
              disabled={!form.dueAt}
              onClick={() =>
                change(
                  "reminderAt",
                  new Date(
                    new Date(form.dueAt).getTime() - 15 * 60000,
                  ).toISOString(),
                )
              }
            >{t("到期前 15 分钟")}</button>
            {form.reminderAt && (
              <button type="button" onClick={() => change("reminderAt", null)}>{t("清除")}</button>
            )}
          </div>
          <section className="automation-editor">
            <button
              type="button"
              className="automation-toggle"
              aria-expanded={automationOpen}
              aria-controls="codex-task-fields"
              onClick={() => setAutomationOpen(value => !value)}
            >
              <span className="ai-icon">
                <Sparkles size={18} />
              </span>
              <span>
                <strong>{t("交给 Codex")}</strong>
                <small>{t("设置执行指令与自动调度")}</small>
              </span>
              <ChevronDown
                size={17}
                style={{ transform: automationOpen ? "rotate(180deg)" : "" }}
              />
            </button>
            <div className="motion-disclosure" id="codex-task-fields"
              data-open={automationOpen ? 'true' : 'false'} aria-hidden={!automationOpen} inert={!automationOpen}>
              <div className="motion-disclosure-inner">
              <div className="automation-fields">
                <label className="field">{t("Codex 执行指令")}<textarea
                    rows={3}
                    placeholder={t("例如：整理此目录中本周的笔记，生成一份复习提纲。")}
                    value={form.automation.prompt}
                    onChange={(e) => changeAI("prompt", e.target.value)}
                  />
                </label>
                <label className="field">{t("工作目录")}<input
                    placeholder={t("例如 C:\\Users\\你的名字\\Documents\\项目")}
                    value={form.automation.workspace}
                    onChange={(e) => changeAI("workspace", e.target.value)}
                  />
                </label>
                <label className="field">{t("文件访问权限")}<select
                    value={form.automation.sandbox}
                    onChange={(e) => changeAI("sandbox", e.target.value)}
                  >
                    <option value="read-only">{t("只读 · 分析与检查")}</option>
                    <option value="workspace-write">{t("允许写入工作目录 · 生成与修改文件")}</option>
                  </select>
                </label>
                <label className="checkbox-label schedule-check">
                  <input
                    type="checkbox"
                    checked={form.automation.enabled}
                    onChange={(e) => changeAI("enabled", e.target.checked)}
                  />
                  <span>{t("启用定时执行")}<small>{t("关闭时仍可在调度页面手动运行")}</small>
                  </span>
                </label>
                {form.automation.enabled && (
                  <div className="form-grid">
                    <label className="field">{t("首次运行")}<input
                        required
                        disabled={!automationOpen}
                        type="datetime-local"
                        value={localInput(form.automation.runAt)}
                        onChange={(e) =>
                          changeAI("runAt", toISO(e.target.value))
                        }
                      />
                    </label>
                    <label className="field">{t("重复")}<select
                        value={form.automation.repeat}
                        onChange={(e) => changeAI("repeat", e.target.value)}
                      >
                        {Object.entries(repeats).map(([k, v]) => (
                          <option key={k} value={k}>
                            {t(v)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <p className="hint">{t("按本机时区调度，需要服务运行、电脑唤醒及 Codex 已登录。执行会使用你的 Codex 额度。")}</p>
              </div>
              </div>
            </div>
          </section>
          {error && (
            <div role="alert" className="form-error">
              <CircleAlert size={15} />
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {task.id && (
            <button
              type="button"
              className="text-danger delete-left"
              onClick={onDelete}
            >
              <Trash2 size={16} />{t("删除任务")}</button>
          )}
          <button type="button" className="secondary" data-modal-dismiss disabled={saving}>{t("取消")}</button>
          <button className="primary" type="submit" disabled={saving}>
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            {saving ? t("正在保存…") : task.id ? t("保存修改") : t("创建任务")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectModal({ onClose, onSave }) {
  const { t } = useI18n();
  const [name, setName] = useState(""),
    [color, setColor] = useState("#7A8F73"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const colors = [
    "#7A8F73",
    "#5B85AD",
    "#C89052",
    "#9B80AD",
    "#C77473",
    "#5C9B97",
  ];
  return (
    <Modal
      title={t("创建一个项目")}
      onClose={onClose}
      closeDisabled={busy}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            await onSave({ name: name.trim(), color });
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <label className="field">{t("项目名称")}<input
              autoFocus
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("例如：学习计划、生活日常")}
            />
          </label>
          <span className="field-label">{t("项目颜色")}</span>
          <div className="color-picker">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t(`选择颜色 ${c}`, `Choose color ${c}`)}
                aria-pressed={c === color}
                style={{ background: c }}
                onClick={() => setColor(c)}
              >
                {c === color && <Check size={17} />}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary" data-modal-dismiss disabled={busy}>{t("取消")}</button>
          <button className="primary" disabled={busy}>{t("创建项目")}</button>
        </div>
      </form>
    </Modal>
  );
}

function AutomationView({
  tasks,
  runs,
  codex,
  mcpConnection,
  onEdit,
  onRun,
  onToggle,
  onHistory,
  onConnect,
}) {
  const { lang, t } = useI18n();
  const automations = tasks.filter((t) => t.automation?.prompt);
  return (
    <div className="automation-view">
      <div className="automation-banner">
        <div className="automation-orb">
          <Sparkles size={31} />
        </div>
        <div>
          <h2>{t("自动调度")}</h2>
          <p>{t("设置任务指令、工作目录和运行时间。")}</p>
        </div>
        <span
          className={`status-pill ${codex?.available ? "success" : "neutral"}`}
        >
          <i />
          {codex?.available ? t("已检测到 CLI") : t("等待连接")}
        </span>
      </div>
      <McpConnection connection={mcpConnection} compact />
      <div className="section-heading">
        <h3>{t("我的调度")}<span>{automations.length}</span>
        </h3>
        <button className="text-button" onClick={onConnect}>{t("连接指南")}<ArrowUpRight size={14} />
        </button>
      </div>
      {!automations.length ? (
        <div className="automation-empty">
          <div className="empty-icon">
            <Repeat2 size={28} />
          </div>
          <h3>{t("暂无调度")}</h3>
          <p>{t("新建调度，写下指令和工作目录。")}<br />{t("你可以先手动试运行，再安排一个固定时间。")}</p>
          <button
            className="secondary"
            onClick={() =>
              onEdit({
                ...blankTask(),
                title: "每日工作总结",
                automation: {
                  ...blankTask().automation,
                  prompt:
                    "请阅读当前工作目录，总结最近的工作进展与待处理事项。仅提供文字总结，不修改文件。",
                },
              })
            }
          >
            <Plus size={16} />{t("创建每日总结")}</button>
        </div>
      ) : (
        <div className="automation-cards">
          {automations.map((task) => (
            <article className="automation-task" key={task.id}>
              <div className="automation-task-top">
                <span className="ai-icon">
                  <Sparkles size={18} />
                </span>
                <button onClick={() => onEdit(task)}>{task.title}</button>
                <button
                  className={`switch ${task.automation.enabled ? "on" : ""}`}
                  role="switch"
                  aria-label={t(`${task.automation.enabled ? "暂停" : "启用"}调度：${task.title}`, `${task.automation.enabled ? "Pause" : "Enable"} schedule: ${task.title}`)}
                  aria-checked={task.automation.enabled}
                  disabled={task.completed}
                  onClick={() => onToggle(task)}
                >
                  <span />
                </button>
              </div>
              <p>{task.automation.prompt}</p>
              <div className="automation-meta">
                <span>
                  <Repeat2 size={13} />
                  {t(repeats[task.automation.repeat])}
                </span>
                <span>
                  <Clock3 size={13} />
                  {task.completed
                    ? t("任务已完成")
                    : task.automation.enabled
                      ? dateLabel(task.automation.runAt, lang)
                      : t("手动运行 / 已暂停")}
                </span>
              </div>
              <div className="automation-task-bottom">
                <span>
                  <Folder size={13} />
                  {task.automation.workspace
                    .split(/[\/]/)
                    .filter(Boolean)
                    .at(-1) || t("未设置目录")}
                </span>
                <button
                  className="secondary small"
                  onClick={() => onRun(task)}
                  disabled={
                    !codex?.available ||
                    task.completed ||
                    runs.some((r) => r.status === "running")
                  }
                >
                  <Play size={13} />{t("立即运行")}</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="section-heading">
        <h3>{t("执行记录")}<span>{runs.length}</span>
        </h3>
        <span className="muted">{t("自动更新")}</span>
      </div>
      {runs.length ? (
        <div className="run-list">
          {[...runs]
            .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
            .map((run) => (
              <button
                className="run-row"
                key={run.id}
                onClick={() => onHistory(run)}
              >
                <span className={`run-icon ${run.status}`}>
                  {run.status === "running" ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : run.status === "succeeded" ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <CircleAlert size={18} />
                  )}
                </span>
                <div>
                  <strong>{run.taskTitle || t("Codex 任务")}</strong>
                  <small>
                    {dateLabel(run.startedAt, lang)} ·{" "}
                    {run.trigger === "manual" ? t("手动运行") : t("定时运行")}
                  </small>
                </div>
                <span
                  className={`status-pill ${run.status === "succeeded" ? "success" : run.status === "failed" ? "failed" : "neutral"}`}
                >
                  {t(runLabels[run.status] || run.status)}
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
        </div>
      ) : (
        <div className="no-runs">
          <Terminal size={19} />
          <p>{t("运行后的状态和输出会保存在这里。")}</p>
        </div>
      )}
      <p className="automation-footnote">
        <Laptop size={14} />{t("调度由本地服务执行，电脑需要保持唤醒。时间使用本机时区。")}</p>
    </div>
  );
}

function RunModal({ run, onClose, onCancel }) {
  const { lang, t } = useI18n();
  return (
    <Modal
      title={t("Codex 执行详情")}
      subtitle={run?.taskTitle || t("任务执行记录")}
      onClose={onClose}
      wide
    >
      {run ? (
        <>
          <div className="modal-body">
            <div className="run-detail-meta">
              <span
                className={`status-pill ${run.status === "failed" ? "failed" : run.status === "succeeded" ? "success" : "neutral"}`}
              >
                {t(runLabels[run.status])}
              </span>
              <span>{dateLabel(run.startedAt, lang)}</span>
              {run.finishedAt && (
                <span>{t("耗时")}{" "}
                  {Math.max(
                    0,
                    Math.round(
                      (new Date(run.finishedAt) - new Date(run.startedAt)) /
                        1000,
                    ),
                  )}{" "}{t("秒")}</span>
              )}
            </div>
            {run.error && <p className="form-error">{run.error}</p>}
            <pre className="run-output">{run.output || t("等待 Codex 输出…")}</pre>
          </div>
          <div className="modal-footer">
            {run.status === "running" && (
              <button className="danger" onClick={() => onCancel(run)}>
                <Square size={14} />{t("取消执行")}</button>
            )}
            <button className="secondary" data-modal-dismiss>{t("关闭")}</button>
          </div>
        </>
      ) : (
        <div className="modal-body">{t("正在读取执行记录…")}</div>
      )}
    </Modal>
  );
}

createRoot(document.getElementById("root")).render(<I18nProvider><App /></I18nProvider>);
