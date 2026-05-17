use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "macos")]
const VSCODE_MACOS_URL: &str = "https://update.code.visualstudio.com/latest/darwin-universal/stable";
#[cfg(target_os = "macos")]
const CLAUDE_CODE_UNIX_INSTALLER: &str = "https://claude.ai/install.sh";

#[derive(Clone, Serialize)]
struct InstallProgress {
    tool: String,
    phase: String,
    percent: u32,
    message: String,
}

fn emit_progress(app: &AppHandle, tool: &str, phase: &str, percent: u32, message: &str) {
    let _ = app.emit(
        "install:progress",
        InstallProgress {
            tool: tool.to_string(),
            phase: phase.to_string(),
            percent,
            message: message.to_string(),
        },
    );
}

#[tauri::command]
fn detect_tool(id: String) -> bool {
    #[cfg(target_os = "macos")]
    {
        return detect_macos(&id);
    }
    #[cfg(target_os = "windows")]
    {
        return detect_windows(&id);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = id;
        false
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(target_os = "macos")]
fn detect_macos(id: &str) -> bool {
    match id {
        "git" => {
            which_bin("git").is_some()
                || PathBuf::from("/usr/bin/git").exists()
                || PathBuf::from("/opt/homebrew/bin/git").exists()
                || PathBuf::from("/usr/local/bin/git").exists()
        }
        "vscode" => PathBuf::from("/Applications/Visual Studio Code.app").exists(),
        "claude_code" => {
            which_bin("claude").is_some()
                || home_path(".claude/local/claude").exists()
                || home_path(".local/bin/claude").exists()
                || PathBuf::from("/usr/local/bin/claude").exists()
                || PathBuf::from("/opt/homebrew/bin/claude").exists()
        }
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn detect_windows(id: &str) -> bool {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    let app_data = std::env::var("APPDATA").unwrap_or_default();
    let program_files = std::env::var("ProgramFiles").unwrap_or_default();
    let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

    let path_exists = |p: String| PathBuf::from(p).exists();

    match id {
        "git" => {
            which_bin("git.exe").is_some()
                || path_exists(format!("{}\\Git\\bin\\git.exe", program_files))
                || path_exists(format!("{}\\Git\\cmd\\git.exe", program_files))
                || path_exists(format!("{}\\Git\\bin\\git.exe", program_files_x86))
                || path_exists(format!("{}\\Git\\cmd\\git.exe", program_files_x86))
                || path_exists(format!(
                    "{}\\scoop\\apps\\git\\current\\bin\\git.exe",
                    user_profile
                ))
                || path_exists(format!("{}\\Programs\\Git\\bin\\git.exe", local_app_data))
                || registry_display_name_contains("Git ")
        }
        "vscode" => {
            which_bin("code.cmd").is_some()
                || which_bin("code.exe").is_some()
                || path_exists(format!(
                    "{}\\Programs\\Microsoft VS Code\\Code.exe",
                    local_app_data
                ))
                || path_exists(format!("{}\\Microsoft VS Code\\Code.exe", program_files))
                || path_exists(format!(
                    "{}\\Microsoft VS Code\\Code.exe",
                    program_files_x86
                ))
                || path_exists(format!(
                    "{}\\scoop\\apps\\vscode\\current\\Code.exe",
                    user_profile
                ))
                || registry_display_name_contains("Microsoft Visual Studio Code")
                || registry_display_name_contains("Visual Studio Code")
        }
        "claude_code" => {
            which_bin("claude.cmd").is_some()
                || which_bin("claude.exe").is_some()
                || which_bin("claude").is_some()
                || path_exists(format!("{}\\.local\\bin\\claude.exe", user_profile))
                || path_exists(format!("{}\\.local\\bin\\claude.cmd", user_profile))
                || path_exists(format!("{}\\.local\\bin\\claude", user_profile))
                || path_exists(format!("{}\\.claude\\local\\claude.cmd", user_profile))
                || path_exists(format!("{}\\.claude\\local\\claude.exe", user_profile))
                || path_exists(format!("{}\\npm\\claude.cmd", app_data))
                || path_exists(format!("{}\\npm\\claude.exe", app_data))
        }
        _ => false,
    }
}

/// Scan Windows Uninstall registry hives for an app whose DisplayName contains the substring.
/// Matches what "Add or Remove Programs" shows — authoritative source on Windows.
#[cfg(target_os = "windows")]
fn registry_display_name_contains(substring: &str) -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let needle = substring.to_lowercase();
    let paths: [(winreg::HKEY, &str); 3] = [
        (
            HKEY_LOCAL_MACHINE,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];

    for (hive, path) in paths {
        let root = RegKey::predef(hive);
        let Ok(key) = root.open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for subkey_name in key.enum_keys().flatten() {
            let Ok(subkey) = key.open_subkey_with_flags(&subkey_name, KEY_READ) else {
                continue;
            };
            if let Ok(name) = subkey.get_value::<String, _>("DisplayName") {
                if name.to_lowercase().contains(&needle) {
                    return true;
                }
            }
        }
    }
    false
}

fn which_bin(bin: &str) -> Option<PathBuf> {
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    let output = Command::new(cmd).arg(bin).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8(output.stdout).ok()?;
    let first = s.lines().next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(PathBuf::from(first))
    }
}

#[cfg(target_os = "macos")]
fn home_path(rel: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join(rel)
}

#[tauri::command]
async fn install_tool(app: AppHandle, id: String) -> Result<(), String> {
    let result: Result<(), String> = {
        #[cfg(target_os = "macos")]
        {
            install_macos(&app, &id).await
        }
        #[cfg(target_os = "windows")]
        {
            install_windows(&app, &id).await
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = (&app, &id);
            Err("Unsupported OS".to_string())
        }
    };
    if let Err(ref e) = result {
        emit_progress(&app, &id, "error", 0, e);
    }
    result
}

#[cfg(target_os = "macos")]
async fn install_macos(app: &AppHandle, id: &str) -> Result<(), String> {
    match id {
        "git" => install_git_macos(app).await,
        "vscode" => install_vscode_macos(app).await,
        "claude_code" => install_claude_code_unix(app).await,
        _ => Err(format!("不明なツール: {}", id)),
    }
}

#[cfg(target_os = "macos")]
async fn install_git_macos(app: &AppHandle) -> Result<(), String> {
    if which_bin("git").is_some() {
        emit_progress(app, "git", "done", 100, "すでにインストール済み");
        return Ok(());
    }
    emit_progress(app, "git", "installing", 10, "Apple のダイアログを表示します...");
    let _ = Command::new("xcode-select").arg("--install").output();
    emit_progress(
        app,
        "git",
        "installing",
        30,
        "画面のダイアログで「インストール」をクリックしてください",
    );
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(900) {
        tokio::time::sleep(Duration::from_secs(3)).await;
        if which_bin("git").is_some() {
            emit_progress(app, "git", "done", 100, "完了");
            return Ok(());
        }
        let elapsed_pct = (start.elapsed().as_secs() as f64 / 900.0 * 60.0) as u32 + 30;
        emit_progress(
            app,
            "git",
            "installing",
            elapsed_pct.min(95),
            "Xcode Command Line Tools をインストール中...",
        );
    }
    Err("Git インストールがタイムアウトしました".to_string())
}

#[cfg(target_os = "macos")]
async fn install_vscode_macos(app: &AppHandle) -> Result<(), String> {
    let zip = download_with_progress(app, "vscode", VSCODE_MACOS_URL, "vscode.zip").await?;
    emit_progress(app, "vscode", "extracting", 90, "VS Code を展開中...");
    let _ = Command::new("rm")
        .arg("-rf")
        .arg("/Applications/Visual Studio Code.app")
        .output();
    let status = Command::new("unzip")
        .arg("-q")
        .arg(&zip)
        .arg("-d")
        .arg("/Applications/")
        .status()
        .map_err(|e| format!("unzip 実行失敗: {}", e))?;
    if !status.success() {
        return Err("VS Code の展開に失敗しました".to_string());
    }
    let _ = std::fs::remove_file(&zip);
    let _ = Command::new("xattr")
        .args([
            "-dr",
            "com.apple.quarantine",
            "/Applications/Visual Studio Code.app",
        ])
        .output();
    emit_progress(app, "vscode", "done", 100, "完了");
    Ok(())
}

#[cfg(target_os = "macos")]
async fn install_claude_code_unix(app: &AppHandle) -> Result<(), String> {
    emit_progress(app, "claude_code", "installing", 30, "Claude Code をインストール中...");
    let script = format!("curl -fsSL {} | bash", CLAUDE_CODE_UNIX_INSTALLER);
    let output = Command::new("sh")
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| format!("シェル実行失敗: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Claude Code のインストールに失敗: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    emit_progress(app, "claude_code", "done", 100, "完了");
    Ok(())
}

#[cfg(target_os = "windows")]
async fn install_windows(app: &AppHandle, id: &str) -> Result<(), String> {
    match id {
        "git" => winget_install(app, "git", "Git.Git", None).await,
        "vscode" => winget_install(app, "vscode", "Microsoft.VisualStudioCode", None).await,
        "claude_code" => install_claude_code_windows(app).await,
        _ => Err(format!("不明なツール: {}", id)),
    }
}

/// Run `winget install` for a package, optionally pinning scope (user/machine).
#[cfg(target_os = "windows")]
async fn winget_install(
    app: &AppHandle,
    tool: &str,
    package_id: &str,
    scope: Option<&str>,
) -> Result<(), String> {
    emit_progress(app, tool, "installing", 30, "winget でインストール中...");
    let mut args: Vec<String> = vec![
        "install".into(),
        "--id".into(),
        package_id.into(),
        "-e".into(),
        "--accept-source-agreements".into(),
        "--accept-package-agreements".into(),
        "--silent".into(),
    ];
    if let Some(s) = scope {
        args.push("--scope".into());
        args.push(s.into());
    }
    let output = Command::new("winget")
        .args(&args)
        .output()
        .map_err(|e| format!("winget 実行失敗: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "winget install {} 失敗: {}",
            package_id,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    emit_progress(app, tool, "done", 100, "完了");
    Ok(())
}

#[cfg(target_os = "windows")]
async fn install_claude_code_windows(app: &AppHandle) -> Result<(), String> {
    emit_progress(app, "claude_code", "installing", 30, "Claude Code をインストール中...");
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "irm https://claude.ai/install.ps1 | iex",
        ])
        .output()
        .map_err(|e| format!("PowerShell 実行失敗: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "Claude Code インストール失敗: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    emit_progress(app, "claude_code", "done", 100, "完了");
    Ok(())
}

async fn download_with_progress(
    app: &AppHandle,
    tool: &str,
    url: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    let tmp_dir = std::env::temp_dir().join("claude-kit");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("tmp dir 作成失敗: {}", e))?;
    let dest = tmp_dir.join(file_name);

    emit_progress(app, tool, "downloading", 0, "ダウンロード開始...");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|e| format!("HTTP クライアント作成失敗: {}", e))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("HTTP リクエスト失敗: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), url));
    }
    let total = resp.content_length().unwrap_or(0);

    use std::io::Write;
    let mut file =
        std::fs::File::create(&dest).map_err(|e| format!("ファイル作成失敗: {}", e))?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut last_emit: u32 = 0;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("ダウンロードチャンク失敗: {}", e))?;
        file.write_all(&bytes)
            .map_err(|e| format!("書き込み失敗: {}", e))?;
        downloaded += bytes.len() as u64;
        let pct = if total > 0 {
            ((downloaded as f64 / total as f64) * 80.0) as u32
        } else {
            ((downloaded as f64 / 100_000_000.0) * 80.0).min(80.0) as u32
        };
        if pct != last_emit {
            last_emit = pct;
            let mb = downloaded / 1_048_576;
            let total_mb = total / 1_048_576;
            let msg = if total > 0 {
                format!("ダウンロード中 {}/{} MB", mb, total_mb)
            } else {
                format!("ダウンロード中 {} MB", mb)
            };
            emit_progress(app, tool, "downloading", pct, &msg);
        }
    }
    Ok(dest)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![detect_tool, install_tool, quit_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
