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
  { id: "claude_desktop", name: "Claude (アプリ)", description: "デスクトップ版Claude", icon: "🤖" },
  { id: "claude_code", name: "Claude Code", description: "ターミナル版Claude", icon: "⌨️" },
];

type Status = "checking" | "installed" | "missing" | "installing" | "done" | "error";
type ToolState = {
  status: Status;
  message: string;
  percent: number;
};

const state = new Map<string, ToolState>();
const errors = new Map<string, string>();

function setState(id: string, patch: Partial<ToolState>) {
  const prev = state.get(id) ?? { status: "checking", message: "", percent: 0 };
  state.set(id, { ...prev, ...patch });
}

function show(screenId: string) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(`screen-${screenId}`)?.classList.add("active");
}

function badgeHtml(s: Status): string {
  switch (s) {
    case "checking":   return '<span class="badge checking">確認中…</span>';
    case "installed":  return '<span class="badge installed">✓ 入ってます</span>';
    case "missing":    return '<span class="badge missing">未インストール</span>';
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

function renderToolList(containerId: string, withProgress: boolean) {
  const list = document.getElementById(containerId);
  if (!list) return;
  list.innerHTML = TOOLS.map((t) => {
    const s = state.get(t.id) ?? { status: "checking" as Status, message: "", percent: 0 };
    const progressBar = withProgress && (s.status === "installing" || s.status === "done")
      ? `<div class="mini-progress"><div class="mini-progress-bar" style="width:${s.percent}%"></div></div>`
      : "";
    const subtext = withProgress
      ? `<div class="tool-desc">${escapeHtml(s.message || t.description)}</div>${progressBar}`
      : `<div class="tool-desc">${escapeHtml(t.description)}</div>`;
    return `
      <div class="tool" data-id="${t.id}">
        <div class="tool-icon">${t.icon}</div>
        <div class="tool-meta">
          <div class="tool-name">${t.name}</div>
          ${subtext}
        </div>
        <div class="tool-status">${badgeHtml(s.status)}</div>
      </div>
    `;
  }).join("");
}

async function detectAll() {
  TOOLS.forEach((t) => setState(t.id, { status: "checking", message: "", percent: 0 }));
  renderToolList("tool-list", false);
  for (const tool of TOOLS) {
    try {
      const installed = await invoke<boolean>("detect_tool", { id: tool.id });
      setState(tool.id, { status: installed ? "installed" : "missing" });
    } catch {
      setState(tool.id, { status: "missing" });
    }
    renderToolList("tool-list", false);
  }
  const btn = document.getElementById("btn-install") as HTMLButtonElement;
  const allInstalled = TOOLS.every((t) => state.get(t.id)?.status === "installed");
  if (allInstalled) {
    btn.textContent = "すでに全部入ってます ✓";
    btn.disabled = true;
  } else {
    const missingCount = TOOLS.filter((t) => state.get(t.id)?.status === "missing").length;
    btn.textContent = `足りない ${missingCount} 個をインストール`;
    btn.disabled = false;
  }
}

async function startInstall() {
  show("installing");
  errors.clear();
  for (const t of TOOLS) {
    const s = state.get(t.id);
    if (s?.status === "installed") {
      setState(t.id, { status: "done", message: "もとから入っていました", percent: 100 });
    } else {
      setState(t.id, { status: "missing", message: "待機中…", percent: 0 });
    }
  }
  renderToolList("install-tool-list", true);

  const missing = TOOLS.filter((t) => state.get(t.id)?.status === "missing");
  for (const tool of missing) {
    setState(tool.id, { status: "installing", message: "開始中…", percent: 5 });
    renderToolList("install-tool-list", true);
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
    renderToolList("install-tool-list", true);
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
      <p class="note">ネットワークやセキュリティ設定を確認して、もう一度試してみてください。</p>
    </div>
  `;
}

type ProgressEvent = { tool: string; phase: string; percent: number; message: string };
void listen<ProgressEvent>("install:progress", (event) => {
  const p = event.payload;
  if (p.phase === "done") {
    setState(p.tool, { status: "done", message: p.message, percent: 100 });
  } else if (p.phase === "error") {
    setState(p.tool, { status: "error", message: p.message, percent: 0 });
  } else {
    setState(p.tool, { status: "installing", message: p.message, percent: p.percent });
  }
  renderToolList("install-tool-list", true);
});

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn-start")?.addEventListener("click", () => {
    show("checking");
    void detectAll();
  });
  document.getElementById("btn-back-1")?.addEventListener("click", () => show("welcome"));
  document.getElementById("btn-install")?.addEventListener("click", () => void startInstall());
  document.getElementById("btn-finish")?.addEventListener("click", () => {
    void invoke("quit_app");
  });
  show("welcome");
});
