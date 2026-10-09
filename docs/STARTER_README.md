# Pi Calendar — Raspberry Pi 5 卓上カレンダー

**ステータス：実装前のリポジトリ雛形。アプリ本体・Google認証・デプロイ機能はまだ実装していません。**
この一式はClaude Code／Codexが実装を始めるための仕様・運用契約・設定テンプレートです。
作成日：2026-10-03。名称 `pi-calendar` は仮称で、Google/Nestの公式製品ではありません。

## 目標

Raspberry Pi 5を起動すると、12.3インチのタッチ画面に今日の予定と月間カレンダーが全画面表示される。
Google Calendarの変更を自動取得し、ネットワークが切れても最後に取得した予定は残す。
Macで開発した版、またはSSH/Tailscale経由でPi内で開発した版を、明示的な更新操作で本番へ反映する。

## 確認済みの利用環境と、設計上の仮定

| 区分 | 内容 |
|---|---|
| ユーザー確認済み | 手持ちのRaspberry Pi 5を使用。モニターはクレードルに適合。USB接続を追加してタッチ動作を確認 |
| これまでの選定 | HAILESI S123E相当、12.3インチ、1920×1280、3:2、HDMI映像＋USBタッチ |
| 設計前提 | Raspberry Pi OS **64-bit・デスクトップ付き**。Wayland/labwcを第一候補とするが現物のOS/セッションは未確認 |
| 開発 | Macローカル、またはMacからPiへSSH/VS Code Remote-SSH。AIエージェントは任意 |
| 未確認 | PiのRAM/空き容量、OS版、ユーザー名、ホスト名、表示スケール、Node/Chromium/Tailscale導入状況 |

実機へのセットアップ前に `bash scripts/doctor.sh` をPi上で実行する。既存OSの再インストールを前提にしない。
SSH内の `XDG_SESSION_TYPE=tty` だけを見て、実際の画面がX11/Waylandではないと断定しない。

## 読む順番

1. [開始ガイド](START_HERE.md) → [エージェント共通指示](AGENTS.md)
2. [要件](docs/01_REQUIREMENTS.md) → [画面仕様](docs/02_UI_SPEC.md)
3. [アーキテクチャ](docs/03_ARCHITECTURE.md) → [Google同期/認証](docs/04_GOOGLE_SYNC_AUTH.md)
4. [Pi起動](docs/05_PI_KIOSK.md) → [開発・更新](docs/06_REMOTE_DEVELOPMENT_DEPLOY.md)
5. [タスク](docs/08_IMPLEMENTATION_PLAN.md) と [受入テスト](docs/09_ACCEPTANCE_TESTS.md)

最初にエージェントへ渡す文章は [prompts/01_BOOTSTRAP.md](prompts/01_BOOTSTRAP.md)。
設計変更は [判断記録](docs/10_DECISIONS.md) に理由と影響を記録する。

## 採用する初期構成

```text
Mac: 開発 / AIエージェント / ブラウザ / SSH
          │  家庭内LAN または Tailscale
          ▼
Raspberry Pi 5
  Chromium kiosk ── HTTP(loopback) ── Next.js UI/API (systemd)
                                             │
                                         SQLiteキャッシュ
                                             │
                                  同期Worker (systemd)
                                             │ HTTPS
                                         Google Calendar
```

Next.js + TypeScript、Node.js 24 LTS系、SQLite、独立した同期Worker。
依存の正確なpatch版とnpm版は実装時に確認・固定し、`package-lock.json` をコミットする。
Webサーバーは `127.0.0.1:3000`、開発は `127.0.0.1:3100` を基本とする。
Calendar/Node/Next/Piの参照資料は [SOURCES.md](docs/SOURCES.md)。

## この雛形に含む／含まないもの

| 種類 | 状態 |
|---|---|
| 要件・画面・同期・更新・テスト仕様 | 作成済み。仕様であって実装済み機能ではない |
| AGENTS.md / CLAUDE.md / 段階別プロンプト | そのまま開発開始に利用可能 |
| doctor.sh / ssh-tunnel.sh | 小さな補助スクリプト。OSをインストール・変更しない |
| kiosk-supervisor.sh | 参考実装。実アプリとPi GUIセッションでの検証は未実施 |
| systemd / labwc / SSH設定 | テンプレート。自動インストールしない |
| ダミー予定・テストケース | 個人情報を含まない合成データ |
| カレンダーUI、同期Worker、OAuth CLI、deploy/rollback | **未実装。タスクとして定義** |
| package.json / lockfile | **未作成**。M0で実際の依存を解決して作る |

この時点で `npm run dev` や `npm run deploy` は動かない。
後述のコマンド契約をエージェントが実装してから使用する。
ユーザーのGoogle/Tailscale/GitHubに接続したり、リポジトリを作成したりする処理は実行していない。

## 完成時の重要な契約

Googleへのアクセスは読み取り専用。MVPで予定の作成/編集/削除、音声、天気、Tasksは扱わない。
同期とソフトウェア更新を混同しない。Google同期は自動、アプリ更新はユーザーが明示的に実行する。
更新は別ディレクトリへ準備→動作確認→切替→失敗時復旧。本番ディレクトリで直接 `git pull` しない。
ネット断・認証失効は「同期が古い」状態であり、キャッシュ表示可能ならアプリ起動失敗とはしない。

## 公開と秘密情報

まずprivate repositoryを推奨。ライセンスは未決定のためLICENSEを勝手に付与しない。
`.env`、Google client JSON、token、DB、バックアップ、実際の予定、SSH鍵をGit/LLMへ渡さない。
[セキュリティと運用](docs/07_SECURITY_OPERATIONS.md) を参照。
