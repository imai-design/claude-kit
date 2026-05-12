# Claude Kit

Claudeを使い始めるのに必要な道具を、**ボタン一つでまとめてインストール**するGUIインストーラ。

対象:
- 🌿 Git
- 📝 Visual Studio Code
- 🤖 Claude (デスクトップアプリ)
- ⌨️ Claude Code (ターミナル版Claude)

対応OS: macOS / Windows 10+

---

## 📥 ダウンロード

最新版は [Releases](../../releases/latest) からどうぞ。

- **Mac**: `Claude Kit_*.dmg`
- **Windows**: `Claude Kit_*_x64-setup.exe`

---

## 🛠 開発

`app/` 配下が本体プロジェクトです。詳細は [`app/README.md`](app/README.md) を参照。

```bash
cd app
bun install
bun run tauri dev
```

## 🚀 リリース

タグを切って push すると、GitHub Actions が Mac/Win 両方を自動ビルドして Release ページに添付します。

```bash
git tag v0.1.1
git push --tags
```

---

## License

MIT
