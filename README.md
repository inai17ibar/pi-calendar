# Pi Calendar

Raspberry Pi向け卓上カレンダーの開発プロジェクト。添付スターターを取り込み、**M0基盤とM1の合成データUI**を実装しました。Google同期・永続キャッシュ・Pi自動起動・リリース更新は未実装です。

## 起動

Node.js 24系とnpm 11.9.0で検証済み。依存は固定版、package-lock.jsonを同梱しています。

```bash
cd /workspace/pi-calendar
export npm_config_cache=/workspace/.cache/npm
npm ci
npm run dev
```

開発サーバーは127.0.0.1:3100のみで待受けます。開発用stateは`.local/dev`で、本番stateは使いません。Google認証情報は不要です。通常は現在日付に合わせた合成予定を表示し、時刻・表示日はAsia/Tokyoを使います。

- Googleカレンダー風の月グリッド、時間軸付き週表示、日別一覧、予定詳細。
- 週表示は0–24時、終日欄、現在時刻線、前週/翌週、月を跨ぐデータ取得。同時刻予定は列分け。
- 終日・複数日・跨日・海外offset・長い件名・件名なし。
- 空の日と未取得を区別。通信失敗時、同じ月の表示済みサンプルを保持。
- 設定から明暗、文字サイズ、週始まり、起動時表示、デモ取得状態を変更。
- 表示設定のみブラウザに保存。Google予定やDBを保存する機能は未実装。
- 毎15秒の時計更新。今日追従中は0時に日付・月を更新し、手動選択日は保持。

設定は環境変数で渡せます。`.env.example`は参考であり、コピーせず起動可能です。

| 変数 | 既定値 / 用途 |
|---|---|
| CALENDAR_MODE | mockのみ。Googleモードは明確にエラー |
| CALENDAR_TIMEZONE | Asia/Tokyo。有効なIANA timezone |
| CALENDAR_PORT | 3100。ループバック待受け固定 |
| CALENDAR_STATE_DIR | .local/dev。開発state用、本番stateは拒否 |
| CALENDAR_MOCK_NOW | 未設定なら現在時刻。固定デモならoffset付きISO日時 |

スターターの同期関連環境変数・systemd設定は将来の実装契約です。現在のWebにWorkerはありません。

## 検証

```bash
npm run check                  # lint、strict型チェック、unit/integration
npm run build                  # Nextビルド、dist/webへstandalone出力
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
npm run test:e2e               # 4画面サイズ、合成fixture固定Clock
npm run test:runtime           # build後。standalone APIと実時計の月末跨ぎ
```

クラウドでは既存のChromiumを使用しました。他の開発環境はPlaywright公式のブラウザ導入手順に従い、環境変数を未設定にしてバンドルブラウザを使えます。テスト用ポート3310/3311は起動・終了をPlaywrightが管理します。認証情報は不要です。

`npm run build`はWebのみを出力します。Worker/CLI/OAuth/deploy/rollbackは未実装で、成功するダミーコマンドは設けていません。Pi/Linux arm64での再ビルド、実機タッチ、OS起動、24時間動作は未検証です。

## 記録と仕様

[実装・検証記録](docs/STATUS.md)、[実画面](docs/screenshots/calendar-1280x853.png)。
元の仕様は[要件](docs/01_REQUIREMENTS.md)、[画面](docs/02_UI_SPEC.md)、[アーキテクチャ](docs/03_ARCHITECTURE.md)、[実装計画](docs/08_IMPLEMENTATION_PLAN.md)。[元のREADME](docs/STARTER_README.md)は実装前の設計資料として保存しました。

APIはread-onlyかつno-storeで、Hostをlocalhost/127.0.0.1に制限します。health/readyはmock機能の準備だけを示し、GoogleやSQLiteの準備完了を意味しません。versionのcommit/builtAtは未生成のためnullで、m1-mockはデモ識別子です。

実際の予定・token・client JSON・SSH鍵をリポジトリやログへ入れないでください。Next工程はM2のGoogle read-onlyアダプターとSQLite/Workerです。クラウドのセットアップ設定を保存しても、GitHubへのcommit/pushや環境の公開は行われません。

## PiでPRブランチを試す

[Pi実機の試験手順](docs/PI_TRIAL.md)を参照してください。`feat/mock-calendar-ui`を専用の開発ディレクトリへcloneし、Pi自身で`npm ci` → `npm run check` → `npm run build` → `npm start`を実行します。実機のOS設定や本番サービスは変更しません。
