import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Tool = {
  id: string;
  name: string;
  description: string;
  icon: string;
};

const TOOLS: Tool[] = [
  { id: "git", name: "Git", description: "コードのバージョン管理ツール", icon: "🌿" },
  { id: "vscode", name: "Visual Studio Code", description: "コードエディタ", icon: "📝" },
  { id: "claude_code", name: "Claude Code", description: "ターミナル版Claude", icon: "⌨️" },
];

type Status = "queued" | "installing" | "done" | "error";
type ToolState = {
  status: Status;
  message: string;
  percent: number;
};

const state = new Map<string, ToolState>();
const errors = new Map<string, string>();

function setState(id: string, patch: Partial<ToolState>) {
  const prev = state.get(id) ?? { status: "queued", message: "", percent: 0 };
  state.set(id, { ...prev, ...patch });
}

function show(screenId: string) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(`screen-${screenId}`)?.classList.add("active");
}

function badgeHtml(s: Status): string {
  switch (s) {
    case "queued":     return '<span class="badge checking">待機中</span>';
    case "installing": return '<span class="badge installing">作業中</span>';
    case "done":       return '<span class="badge done">✓ 完了</span>';
    case "error":      return '<span class="badge error">⚠ 失敗</span>';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c] as string);
}

function renderToolList() {
  const list = document.getElementById("install-tool-list");
  if (!list) return;
  list.innerHTML = TOOLS.map((t) => {
    const s = state.get(t.id) ?? { status: "queued" as Status, message: "", percent: 0 };
    const progressBar = (s.status === "installing" || s.status === "done")
      ? `<div class="mini-progress"><div class="mini-progress-bar" style="width:${s.percent}%"></div></div>`
      : "";
    return `
      <div class="tool" data-id="${t.id}">
        <div class="tool-icon">${t.icon}</div>
        <div class="tool-meta">
          <div class="tool-name">${t.name}</div>
          <div class="tool-desc">${escapeHtml(s.message || t.description)}</div>
          ${progressBar}
        </div>
        <div class="tool-status">${badgeHtml(s.status)}</div>
      </div>
    `;
  }).join("");
}

async function startInstall() {
  show("installing");
  errors.clear();
  for (const t of TOOLS) {
    setState(t.id, { status: "queued", message: "待機中…", percent: 0 });
  }
  renderToolList();

  for (const tool of TOOLS) {
    setState(tool.id, { status: "installing", message: "開始中…", percent: 5 });
    renderToolList();
    try {
      await invoke("install_tool", { id: tool.id });
      const cur = state.get(tool.id);
      if (cur?.status !== "error") {
        setState(tool.id, { status: "done", message: "完了", percent: 100 });
      }
    } catch (e) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      errors.set(tool.id, msg);
      setState(tool.id, { status: "error", message: msg, percent: 0 });
    }
    renderToolList();
  }

  setTimeout(() => {
    renderErrorSummary();
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
      return `<li><b>${t?.name ?? id}</b>: ${escapeHtml(msg)}</li>`;
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

type ProgressEvent = { tool: string; phase: string; percent: number; message: string };
void listen<ProgressEvent>("install:progress", (event) => {
  const p = event.payload;
  if (!TOOLS.find((t) => t.id === p.tool)) return; // ignore events for removed tools
  if (p.phase === "done") {
    setState(p.tool, { status: "done", message: p.message, percent: 100 });
  } else if (p.phase === "error") {
    setState(p.tool, { status: "error", message: p.message, percent: 0 });
  } else {
    setState(p.tool, { status: "installing", message: p.message, percent: p.percent });
  }
  renderToolList();
});

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-start")?.addEventListener("click", () => {
    void startInstall();
  });
  document.getElementById("btn-finish")?.addEventListener("click", () => {
    void invoke("quit_app");
  });
  show("welcome");
});
