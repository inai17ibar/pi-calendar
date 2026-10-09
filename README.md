# Pi Calendar

Raspberry Pi向け卓上カレンダーの開発プロジェクト。**M0基盤、M1の合成データUI、M2のGoogle読み取り同期（SQLite・Worker・OAuth CLI）**を実装しました。Pi自動起動（systemd/kiosk）・リリース更新は未実装です。

Google Calendarへの接続手順は[GOOGLE_SETUP](docs/GOOGLE_SETUP.md)を参照してください。

## 起動

Node.js 24系とnpm 11.9.0で検証済み。依存は固定版、package-lock.jsonを同梱しています。

```bash
cd /workspace/pi-calendar
export npm_config_cache=/workspace/.cache/npm
npm ci
npm run dev
```

開発サーバーは127.0.0.1:3100のみで待受けます。開発用stateは`.local/dev`で、本番stateは使いません。Google認証情報は不要です。通常は現在日付に合わせた合成予定を表示し、時刻・表示日はAsia/Tokyoを使います。

- 月の6週グリッド、前月・翌月・今日、日別表示、予定詳細。
- 終日・複数日・跨日・海外offset・長い件名・件名なし。
- 空の日と未取得を区別。通信失敗時、同じ月の表示済みサンプルを保持。
- 設定から明暗、文字サイズ、週始まり、起動時表示、デモ取得状態を変更。
- 表示設定はブラウザに保存。googleモードの予定キャッシュは`CALENDAR_STATE_DIR/calendar.sqlite`。
- 毎15秒の時計更新。今日追従中は0時に日付・月を更新し、手動選択日は保持。

設定は環境変数で渡せます。`.env.example`は参考であり、コピーせず起動可能です。

| 変数 | 既定値 / 用途 |
|---|---|
| CALENDAR_MODE | mock（既定、合成データ）または google（SQLiteキャッシュを表示。Workerが同期） |
| CALENDAR_TIMEZONE | Asia/Tokyo。有効なIANA timezone |
| CALENDAR_PORT | 3100。ループバック待受け固定 |
| CALENDAR_STATE_DIR | .local/dev。開発state用、本番stateは拒否 |
| CALENDAR_MOCK_NOW | 未設定なら現在時刻。固定デモならoffset付きISO日時 |

スターターの同期関連環境変数・systemd設定は将来の実装契約です。現在のWebにWorkerはありません。

## 検証

```bash
npm run check                  # lint、strict型チェック、unit/integration
npm run build                  # Nextビルド(dist/web)、Worker/CLI(dist/worker.mjs, dist/cli.mjs)
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
npm run test:e2e               # 4画面サイズ、合成fixture固定Clock
npm run test:runtime           # build後。standalone APIと実時計の月末跨ぎ
```

クラウドでは既存のChromiumを使用しました。他の開発環境はPlaywright公式のブラウザ導入手順に従い、環境変数を未設定にしてバンドルブラウザを使えます。テスト用ポート3310/3311は起動・終了をPlaywrightが管理します。認証情報は不要です。

`npm run build`はWeb・Worker・CLIを出力します。deploy/rollbackは未実装で、成功するダミーコマンドは設けていません。Pi/Linux arm64での再ビルド、実機タッチ、OS起動、24時間動作は未検証です。

## 記録と仕様

[実装・検証記録](docs/STATUS.md)、[実画面](docs/screenshots/calendar-1280x853.png)。
元の仕様は[要件](docs/01_REQUIREMENTS.md)、[画面](docs/02_UI_SPEC.md)、[アーキテクチャ](docs/03_ARCHITECTURE.md)、[実装計画](docs/08_IMPLEMENTATION_PLAN.md)。[元のREADME](docs/STARTER_README.md)は実装前の設計資料として保存しました。

APIはno-storeで、Hostをlocalhost/127.0.0.1に制限します。POST（`/api/cache/request-month`、`/api/sync/request`）はOrigin allowlistとJSONを要求し、Workerへの要求を記録するだけです。health/readyはGoogle接続を必須条件にしません。versionのcommit/builtAtは未生成のためnullです。

実際の予定・token・client JSON・SSH鍵をリポジトリやログへ入れないでください。次の工程はM3（systemd常駐・kiosk自動起動）です。クラウドのセットアップ設定を保存しても、GitHubへのcommit/pushや環境の公開は行われません。

## PiでPRブランチを試す

[Pi実機の試験手順](docs/PI_TRIAL.md)を参照してください。`feat/mock-calendar-ui`を専用の開発ディレクトリへcloneし、Pi自身で`npm ci` → `npm run check` → `npm run build` → `npm start`を実行します。実機のOS設定や本番サービスは変更しません。
