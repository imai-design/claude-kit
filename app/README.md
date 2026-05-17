# Claude Kit

Claude を使い始めるのに必要な道具を、ボタン一つでまとめてインストールするGUIインストーラ。

対象ツール:
- 🌿 Git
- 📝 Visual Studio Code
- ⌨️ Claude Code (ターミナル版)

対象OS: macOS / Windows 10+

---

## 開発

依存: Rust (rustup) + Bun

```bash
cd app
bun install
bun run tauri dev
```

---

## ビルド

### Mac版 (.dmg)

```bash
cd app
bun run tauri build
```

成果物: `src-tauri/target/release/bundle/dmg/Claude Kit_0.1.0_aarch64.dmg`

Intel Mac向けも欲しい場合:
```bash
rustup target add x86_64-apple-darwin
bun run tauri build --target x86_64-apple-darwin
```

両方統合 (universal):
```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
bun run tauri build --target universal-apple-darwin
```

### Windows版 (.msi)

Windows機で:
```powershell
cd app
bun install
bun run tauri build
```

成果物: `src-tauri/target/release/bundle/msi/Claude Kit_0.1.0_x64_en-US.msi`

> ⚠ Macからクロスコンパイル不可。Windows 10/11 機で別途ビルド要。

---

## 配布

### 未署名で配る (お試し)

**Mac受け取り側の手順**:
1. `.dmg` を開いて `Claude Kit.app` を `/Applications` にドラッグ
2. 起動しようとすると「開発元未確認」警告
3. **Finderで右クリック → 「開く」 → ダイアログで「開く」**
4. 以降は普通に起動可能

**Win受け取り側の手順**:
1. `.msi` をダブルクリック
2. 「WindowsによってPCが保護されました」 → 「**詳細情報**」 → 「実行」

### 正式版 (署名 + 公証)

**Mac** (Apple Developer Program $99/年):
1. https://developer.apple.com/programs/ に登録
2. Developer ID Application 証明書を作成
3. `src-tauri/tauri.conf.json` に追加:
   ```json
   "bundle": {
     "macOS": {
       "signingIdentity": "Developer ID Application: 名前 (TEAM_ID)"
     }
   }
   ```
4. 環境変数を設定してビルド:
   ```bash
   export APPLE_ID="your@email.com"
   export APPLE_PASSWORD="app-specific-password"
   export APPLE_TEAM_ID="TEAM_ID"
   bun run tauri build
   ```
   詳細: https://tauri.app/distribute/sign/macos/

**Windows** (Code Signing Cert $150〜/年):
1. SSL.com / DigiCert で証明書購入
2. `src-tauri/tauri.conf.json` に追加:
   ```json
   "bundle": {
     "windows": {
       "certificateThumbprint": "THUMBPRINT",
       "digestAlgorithm": "sha256",
       "timestampUrl": "http://timestamp.digicert.com"
     }
   }
   ```
   詳細: https://tauri.app/distribute/sign/windows/

### 配布チャネル

- サブドメイン (例: `setup.〜`) に `.dmg` / `.msi` を置く
- OS自動判定で適切な方を提供
- 自動アップデート: https://tauri.app/distribute/updater/

---

## アーキテクチャ

- **フロント**: Vanilla TS + Vite
- **バックエンド**: Rust (Tauri 2)

### 検出 (`detect_tool`)

| ツール | Mac | Win |
|---|---|---|
| Git | `which git` + 既知パス | `where git.exe` + Program Files |
| VS Code | `/Applications/Visual Studio Code.app` | `LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe` |
| Claude Code | `which claude` + 既知パス | `where claude.cmd/exe` |

### インストール (`install_tool`)

| ツール | Mac | Win |
|---|---|---|
| Git | `xcode-select --install` (OSダイアログ) | `winget install Git.Git` |
| VS Code | 公式zip DL → `/Applications/` 展開 | `winget install Microsoft.VisualStudioCode` |
| Claude Code | `curl -fsSL claude.ai/install.sh \| bash` | `irm claude.ai/install.ps1 \| iex` |

進捗は Rust → フロント の `install:progress` Tauri event で配信。
