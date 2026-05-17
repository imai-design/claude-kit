import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type ToolOS = "all" | "mac" | "win";
type ToolCategory = "core" | "ai" | "editor" | "extras";

interface Tool {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: ToolCategory;
  os: ToolOS;
  recommended: boolean;
}

const TOOLS: Tool[] = [
  { id: "git", name: "Git", description: "コードのバージョン管理", icon: "🌿", category: "core", os: "all", recommended: true },
  { id: "vscode", name: "Visual Studio Code", description: "コードエディタ", icon: "📝", category: "editor", os: "all", recommended: true },
  { id: "claude_code", name: "Claude Code", description: "ターミナル版 Claude", icon: "⌨️", category: "ai", os: "all", recommended: true },
  { id: "homebrew", name: "Homebrew", description: "Mac のパッケージマネージャ", icon: "🍺", category: "core", os: "mac", recommended: true },
  { id: "node", name: "Node.js (LTS)", description: "JavaScript 実行環境 (npm 同梱)", icon: "🟢", category: "core", os: "all", recommended: true },
  { id: "gh", name: "GitHub CLI", description: "ターミナルから GitHub 操作", icon: "🐙", category: "core", os: "all", recommended: false },
  { id: "codex", name: "Codex CLI", description: "OpenAI のターミナル AI (Node 必須)", icon: "🟣", category: "ai", os: "all", recommended: false },
  { id: "gemini", name: "Gemini CLI", description: "Google のターミナル AI (Node 必須)", icon: "💎", category: "ai", os: "all", recommended: false },
  { id: "obsidian", name: "Obsidian", description: "メモ・ナレッジ管理アプリ", icon: "🗒️", category: "extras", os: "all", recommended: false },
];

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  core: "基本ツール",
  editor: "エディタ",
  ai: "AI ツール",
  extras: "おまけ",
};

type Status = "queued" | "installing" | "done" | "error";

interface ToolState {
  status: Status;
  message: string;
  percent: number;
  detected: boolean;
  selected: boolean;
  logs: string[];
  logExpanded: boolean;
}

interface ProgressEvent {
  tool: string;
  phase: string;
  percent: number;
  message: string;
}

interface LogEvent {
  tool: string;
  line: string;
}

const state = new Map<string, ToolState>();
const errors = new Map<string, string>();
let runningOS: "mac" | "win" = "mac";

function detectOS(): "mac" | "win" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "win";
  return "mac";
}

function visibleTools(): Tool[] {
  return TOOLS.filter((t) => t.os === "all" || t.os === runningOS);
}

function getState(id: string): ToolState {
  const s = state.get(id);
  if (s) return s;
  const init: ToolState = {
    status: "queued",
    message: "",
    percent: 0,
    detected: false,
    selected: false,
    logs: [],
    logExpanded: false,
  };
  state.set(id, init);
  return init;
}

function setState(id: string, patch: Partial<ToolState>) {
  const prev = getState(id);
  state.set(id, { ...prev, ...patch });
}

function show(screenId: string) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(`screen-${screenId}`)?.classList.add("active");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c] as string);
}

function badgeHtml(s: Status, detected: boolean): string {
  if (s === "queued" && detected) {
    return '<span class="badge installed">✓ 入ってます</span>';
  }
  switch (s) {
    case "queued":     return '<span class="badge checking">未導入</span>';
    case "installing": return '<span class="badge installing">作業中</span>';
    case "done":       return '<span class="badge done">✓ 完了</span>';
    case "error":      return '<span class="badge error">⚠ 失敗</span>';
  }
}

function renderToolPicker() {
  const list = document.getElementById("tool-picker");
  if (!list) return;
  const tools = visibleTools();
  const byCategory = new Map<ToolCategory, Tool[]>();
  for (const t of tools) {
    const arr = byCategory.get(t.category) ?? [];
    arr.push(t);
    byCategory.set(t.category, arr);
  }
  const sections: string[] = [];
  for (const cat of ["core", "editor", "ai", "extras"] as ToolCategory[]) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    const cards = items.map((t) => {
      const s = getState(t.id);
      const checked = s.selected ? "checked" : "";
      const cls = s.detected ? "tool-card detected" : "tool-card";
      const uninstallBtn = s.detected
        ? `<button class="tool-uninstall-btn" type="button" data-id="${t.id}" title="アンインストール">🗑</button>`
        : "";
      return `
        <label class="${cls}" data-id="${t.id}">
          <input type="checkbox" data-id="${t.id}" ${checked} />
          <div class="tool-icon">${t.icon}</div>
          <div class="tool-meta">
            <div class="tool-name">${escapeHtml(t.name)}</div>
            <div class="tool-desc">${escapeHtml(t.description)}</div>
          </div>
          <div class="tool-status">${badgeHtml(s.status, s.detected)}</div>
          ${uninstallBtn}
        </label>
      `;
    }).join("");
    sections.push(`
      <div class="category">
        <h3 class="category-title">${CATEGORY_LABEL[cat]}</h3>
        <div class="category-list">${cards}</div>
      </div>
    `);
  }
  list.innerHTML = sections.join("");
  bindPickerEvents();
  updateSelectSummary();
}

function bindPickerEvents() {
  document.querySelectorAll<HTMLInputElement>("#tool-picker input[type=checkbox]").forEach((el) => {
    el.addEventListener("change", () => {
      const id = el.dataset.id;
      if (!id) return;
      setState(id, { selected: el.checked });
      const card = el.closest(".tool-card");
      card?.classList.toggle("selected", el.checked);
      updateSelectSummary();
    });
    const id = el.dataset.id;
    if (id) {
      el.closest(".tool-card")?.classList.toggle("selected", getState(id).selected);
    }
  });
  document.querySelectorAll<HTMLButtonElement>(".tool-uninstall-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      void confirmAndUninstall(id);
    });
  });
}

async function confirmAndUninstall(id: string) {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) return;
  const isDangerous = id === "homebrew" || id === "git";
  const baseMsg = `「${tool.name}」をアンインストールします。よろしいですか？`;
  const warning = id === "homebrew"
    ? "\n\n⚠️ Homebrew を消すと、Homebrew で入れたツール (gh, Node.js, Obsidian など) が動かなくなる可能性があります。"
    : id === "git"
      ? "\n\n⚠️ Git は Mac の標準ツールに含まれているので、通常はアンインストールしません。"
      : "";
  if (!confirm(baseMsg + warning)) return;
  if (isDangerous) {
    if (!confirm(`もう一度確認します。\n本当に「${tool.name}」をアンインストールしますか？`)) return;
  }

  // Switch to installing screen for visible progress and logs
  setState(id, {
    status: "installing",
    message: "アンインストール中…",
    percent: 5,
    selected: true,
    logs: [],
    logExpanded: false,
  });
  errors.clear();
  // Show only this tool on the installing screen
  for (const t of TOOLS) {
    if (t.id !== id) setState(t.id, { selected: false });
  }
  show("installing");
  renderToolListInstalling();

  try {
    await invoke("uninstall_tool", { id });
    const cur = getState(id);
    if (cur.status !== "error") {
      setState(id, { status: "done", message: "アンインストール完了", percent: 100, detected: false });
    }
  } catch (e) {
    const msg = typeof e === "string" ? e : JSON.stringify(e);
    errors.set(id, msg);
    setState(id, { status: "error", message: msg, percent: 0 });
  }
  renderToolListInstalling();

  setTimeout(() => {
    void refreshDetection();
    show("welcome");
  }, 1200);
}

function updateSelectSummary() {
  const el = document.getElementById("select-summary");
  const btn = document.getElementById("btn-start") as HTMLButtonElement | null;
  if (!el) return;
  const tools = visibleTools();
  const selected = tools.filter((t) => getState(t.id).selected);
  const missing = tools.filter((t) => !getState(t.id).detected);
  const installed = tools.length - missing.length;
  el.textContent = `すでに ${installed}/${tools.length} 個 入っています  ·  選択中: ${selected.length}`;
  if (btn) {
    btn.disabled = selected.length === 0;
    btn.textContent = selected.length === 0
      ? "インストールするものを選んでください"
      : `${selected.length} 個をインストール開始`;
  }
  renderStatusBanner(missing.length, tools.length);
}

function renderStatusBanner(missingCount: number, total: number) {
  const banner = document.getElementById("status-banner");
  if (!banner) return;
  if (missingCount === 0) {
    banner.innerHTML = `
      <div class="banner banner-success">
        <span class="banner-icon">✨</span>
        <div class="banner-body">
          <div class="banner-title">必要なツールはすべて揃っています！</div>
          <div class="banner-desc">再インストールや追加で入れたいツールがあれば、下から選んでください。</div>
        </div>
      </div>
    `;
  } else if (missingCount === total) {
    banner.innerHTML = `
      <div class="banner banner-info">
        <span class="banner-icon">👋</span>
        <div class="banner-body">
          <div class="banner-title">はじめまして！まずは基本ツールから入れていきましょう</div>
          <div class="banner-desc">おすすめのツールに最初からチェックが入っています。そのまま「インストール開始」でOK。</div>
        </div>
      </div>
    `;
  } else {
    banner.innerHTML = `
      <div class="banner banner-info">
        <span class="banner-icon">📦</span>
        <div class="banner-body">
          <div class="banner-title">あと ${missingCount} 個 入れられます</div>
          <div class="banner-desc">入れたいツールにチェックを入れて「インストール開始」を押してください。</div>
        </div>
      </div>
    `;
  }
}

function renderToolListInstalling() {
  const list = document.getElementById("install-tool-list");
  if (!list) return;
  const tools = visibleTools().filter((t) => getState(t.id).selected);
  list.innerHTML = tools.map((t) => {
    const s = getState(t.id);
    const showProgress = s.status === "installing" || s.status === "done";
    const progressBar = showProgress
      ? `<div class="mini-progress"><div class="mini-progress-bar" style="width:${s.percent}%"></div></div>`
      : "";
    const logToggle = s.logs.length > 0
      ? `<button class="log-toggle" data-id="${t.id}" type="button">${s.logExpanded ? "▼" : "▶"} 詳細を見る (${s.logs.length})</button>`
      : "";
    const logBody = s.logExpanded && s.logs.length > 0
      ? `<pre class="log-body">${escapeHtml(s.logs.slice(-200).join("\n"))}</pre>`
      : "";
    return `
      <div class="tool" data-id="${t.id}">
        <div class="tool-row">
          <div class="tool-icon">${t.icon}</div>
          <div class="tool-meta">
            <div class="tool-name">${escapeHtml(t.name)}</div>
            <div class="tool-desc">${escapeHtml(s.message || t.description)}</div>
            ${progressBar}
          </div>
          <div class="tool-status">${badgeHtml(s.status, s.detected)}</div>
        </div>
        ${logToggle}
        ${logBody}
      </div>
    `;
  }).join("");
  document.querySelectorAll<HTMLButtonElement>(".log-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (!id) return;
      const s = getState(id);
      setState(id, { logExpanded: !s.logExpanded });
      renderToolListInstalling();
    });
  });
}

async function refreshDetection() {
  for (const t of visibleTools()) {
    try {
      const found = await invoke<boolean>("detect_tool", { id: t.id });
      const prev = getState(t.id);
      const wasDetected = prev.detected;
      setState(t.id, {
        detected: found,
        selected: found ? false : (prev.selected || t.recommended),
      });
      if (wasDetected !== found) {
        renderToolPicker();
      }
    } catch {
      // ignore detection errors
    }
  }
  renderToolPicker();
}

async function startInstall() {
  const queue = visibleTools().filter((t) => getState(t.id).selected);
  if (queue.length === 0) return;

  show("installing");
  errors.clear();
  for (const t of queue) {
    setState(t.id, {
      status: "queued",
      message: "待機中…",
      percent: 0,
      logs: [],
      logExpanded: false,
    });
  }
  renderToolListInstalling();

  for (const tool of queue) {
    setState(tool.id, { status: "installing", message: "開始中…", percent: 5 });
    renderToolListInstalling();
    try {
      await invoke("install_tool", { id: tool.id });
      const cur = getState(tool.id);
      if (cur.status !== "error") {
        setState(tool.id, { status: "done", message: "完了", percent: 100 });
      }
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      errors.set(tool.id, msg);
      setState(tool.id, { status: "error", message: msg, percent: 0 });
    }
    renderToolListInstalling();
  }

  setTimeout(() => {
    renderErrorSummary();
    renderDoneActions();
    show("done");
  }, 600);
}

function renderErrorSummary() {
  const el = document.getElementById("error-summary");
  if (!el) return;
  if (errors.size === 0) {
    el.innerHTML = "";
    return;
  }
  const items = Array.from(errors.entries())
    .map(([id, msg]) => {
      const t = TOOLS.find((x) => x.id === id);
      return `<li><b>${escapeHtml(t?.name ?? id)}</b>: ${escapeHtml(msg)}</li>`;
    })
    .join("");
  el.innerHTML = `
    <div class="error-box">
      <div class="error-title">⚠ 一部のインストールに失敗しました</div>
      <ul>${items}</ul>
      <p class="note">ネットワークや権限を確認してもう一度試してみてください。</p>
    </div>
  `;
}

interface QuickAction {
  label: string;
  description: string;
  kind: "open" | "copy" | "terminal";
  payload: string;
}

function quickActionsFor(id: string): QuickAction[] {
  const isMac = runningOS === "mac";
  switch (id) {
    case "vscode":
      return isMac
        ? [{
            label: "VS Code を開く",
            description: "コードを書くエディタ。まずは触ってみる",
            kind: "open",
            payload: "/Applications/Visual Studio Code.app",
          }]
        : [{
            label: "VS Code を開く",
            description: "コードを書くエディタ。まずは触ってみる",
            kind: "open",
            payload: "code",
          }];
    case "claude_code":
      return [{
        label: "Claude Code を起動",
        description: "ターミナルが開いて claude が動き出します。AIと対話開始",
        kind: "terminal",
        payload: "claude",
      }];
    case "obsidian":
      return isMac
        ? [{
            label: "Obsidian を開く",
            description: "メモ・ナレッジを書き溜めるアプリ",
            kind: "open",
            payload: "/Applications/Obsidian.app",
          }]
        : [];
    case "gh":
      return [{
        label: "GitHub にログイン",
        description: "Claude Code から GitHub を操作するため、1回だけログインが必要",
        kind: "terminal",
        payload: "gh auth login",
      }];
    case "homebrew":
      return [{
        label: "Homebrew を最新に更新",
        description: "入っているツールをまとめてアップデート（時々やると安心）",
        kind: "terminal",
        payload: "brew update && brew upgrade",
      }];
    default:
      return [];
  }
}

function renderDoneActions() {
  const el = document.getElementById("done-actions");
  if (!el) return;
  const done = visibleTools().filter((t) => getState(t.id).status === "done" || getState(t.id).detected);
  const actions: { tool: Tool; action: QuickAction }[] = [];
  for (const t of done) {
    for (const a of quickActionsFor(t.id)) {
      actions.push({ tool: t, action: a });
    }
  }
  if (actions.length === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `
    <div class="done-actions-grid">
      ${actions.map((a, i) => `
        <button class="done-action" data-idx="${i}" type="button">
          <span class="done-action-icon">${a.tool.icon}</span>
          <span class="done-action-body">
            <span class="done-action-label">${escapeHtml(a.action.label)}</span>
            <span class="done-action-desc">${escapeHtml(a.action.description)}</span>
          </span>
        </button>
      `).join("")}
    </div>
  `;
  document.querySelectorAll<HTMLButtonElement>(".done-action").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.idx);
      const entry = actions[idx];
      if (!entry) return;
      try {
        if (entry.action.kind === "open") {
          await invoke("open_path", { path: entry.action.payload });
          flashLabel(btn, "✓ 開きました");
        } else if (entry.action.kind === "terminal") {
          await invoke("open_terminal_with_command", { command: entry.action.payload });
          flashLabel(btn, "✓ ターミナルを開きました");
        } else {
          await invoke("copy_to_clipboard", { text: entry.action.payload });
          flashLabel(btn, "✓ コピーしました");
        }
      } catch (e) {
        const msg = typeof e === "string" ? e : JSON.stringify(e);
        console.warn("quick action failed", msg);
      }
    });
  });
}

function flashLabel(btn: HTMLButtonElement, text: string) {
  const label = btn.querySelector(".done-action-label");
  if (!label) return;
  const original = label.textContent;
  btn.classList.add("copied");
  label.textContent = text;
  setTimeout(() => {
    if (original) label.textContent = original;
    btn.classList.remove("copied");
  }, 1500);
}

void listen<ProgressEvent>("install:progress", (event) => {
  const p = event.payload;
  if (!TOOLS.find((t) => t.id === p.tool)) return;
  if (p.phase === "done") {
    setState(p.tool, { status: "done", message: p.message, percent: 100 });
  } else if (p.phase === "error") {
    setState(p.tool, { status: "error", message: p.message, percent: 0 });
  } else {
    setState(p.tool, { status: "installing", message: p.message, percent: p.percent });
  }
  renderToolListInstalling();
});

void listen<LogEvent>("install:log", (event) => {
  const p = event.payload;
  const cur = getState(p.tool);
  const next = [...cur.logs, p.line];
  if (next.length > 500) next.splice(0, next.length - 500);
  setState(p.tool, { logs: next });
  if (cur.logExpanded) renderToolListInstalling();
});

window.addEventListener("DOMContentLoaded", () => {
  runningOS = detectOS();
  for (const t of visibleTools()) {
    setState(t.id, { selected: t.recommended });
  }
  renderToolPicker();
  void refreshDetection();

  document.getElementById("btn-start")?.addEventListener("click", () => {
    void startInstall();
  });
  document.getElementById("btn-finish")?.addEventListener("click", () => {
    void invoke("quit_app");
  });
  document.getElementById("btn-open-nix")?.addEventListener("click", () => {
    void invoke("open_path", { path: "https://nixos.org/" });
  });
  document.getElementById("btn-select-missing")?.addEventListener("click", () => {
    for (const t of visibleTools()) {
      const s = getState(t.id);
      setState(t.id, { selected: !s.detected });
    }
    renderToolPicker();
  });
  document.getElementById("btn-select-none")?.addEventListener("click", () => {
    for (const t of visibleTools()) {
      setState(t.id, { selected: false });
    }
    renderToolPicker();
  });
  document.getElementById("btn-recheck")?.addEventListener("click", () => {
    void refreshDetection();
  });
  show("welcome");
});
