# 03 アーキテクチャ

## 技術選択（初期案）

Node.js 24 LTS系 + Next.js App Router + React + TypeScript strict。
SQLiteはbetter-sqlite3を第一候補とし、採用版のNode24/Linux arm64動作を確認する。
Google公式Nodeクライアント、Luxon等のIANA timezone対応ライブラリ、Zod、Vitest、Playwright。
正確な依存版はM0でpin。最新主張をドキュメントに固定せず、実装日に確認する。[S04–S06,S13]

選定理由：ユーザーのNext/React経験を活かし、HTTP/Webを1つのアプリにまとめる。
ただし周期同期はNextのリクエスト/Server Actionに埋め込まず、独立Workerで管理する。
常時稼働端末なのでEdge/serverless前提にしない。Redisや外部DBは不要。

## プロセス

| プロセス | 実行者 | 役割 |
|---|---|---|
| Next Web | calendar-app（専用非root） | localhost UI/API、キャッシュ閲覧、設定保存 |
| Sync Worker | calendar-app | Google通信、token refresh、キャッシュ更新、次回実行管理 |
| CLI | 開発ユーザー、必要な管理操作のみ限定的sudo | OAuth初回認証、DB移行/backup、release操作 |
| Chromium | Pi GUIログインユーザー | kiosk表示。Googleのrefresh tokenを渡さない |

WebとWorkerは同じSQLiteをWALモードで共有し、busy timeoutと短いtransactionを使う。
Webの起動だけで同期Workerが二重起動してはいけない。Workerは単一プロセスロックを取る。
プロダクションsyncとCLI再認証が同じtokenファイルを競合更新しないよう、再認証時はWorkerを停止する。

## 推奨ソース構造（M0で作成する）

```text
src/
  app/                  # page, layout, API route handlers
  components/           # MonthGrid, DayAgenda, StatusBar, Settings
  domain/               # event types, date calculations, filtering
  server/
    google/             # API adapter, normalization
    storage/            # schema, repositories, atomic snapshots
    auth/               # OAuth/TokenStore (server-only)
    security/           # host/origin validation, redaction
  worker/               # sync scheduler; separate entry point
  cli/                  # google-auth, db-backup, migrate, health
  shared/               # DTO only; no secrets
fixtures/
tests/{unit,integration,e2e}/
scripts/                # dev/build/release helpers
ops/                    # systemd, kiosk, SSH templates
```

`domain`はDB/Google/Reactを直接importしない。Clock / CalendarProvider / Repository / TokenStoreで境界を切る。
API routeはNode runtime。ブラウザにgoogleapis/better-sqlite3やserver-onlyモジュールをbundleしない。

## ディレクトリと権限

```text
/home/<developer>/src/pi-calendar/       # 編集するworkspace
  .local/dev/                           # 開発用DB/token（Git除外）
/opt/pi-calendar/releases/<release-id>/  # 検証済み・root管理・実行コード
/opt/pi-calendar/current -> releases/... # 本番リンク
/opt/pi-calendar/previous -> releases/...# 直前の成功版
/etc/pi-calendar/runtime.env            # root:calendar-app 0640
/var/lib/pi-calendar/                    # calendar-app:calendar-app 0700
  calendar.sqlite                       # キャッシュ、設定、状態
  secrets/{oauth-client.json,tokens.json}# 0600
  locks/                                # Worker/CLI排他
/var/backups/pi-calendar/                # root管理 0700
```

systemdの実行Nodeはrootが管理する絶対パスへ固定。ユーザーのnvm配下をそのまま`ProtectHome=true`のserviceから使わない。
開発者がreleaseを直書きできる設計にしない。新ソースのnpm install/buildは非rootかつ本番tokenを読めない環境で行う。

## 永続化の最小スキーマ案

| テーブル | 主な列/キー | 注意 |
|---|---|---|
| app_settings | id=1, schema_version, timezone, week_start, startup_view, selected_calendar_ids | 書込みを低頻度化 |
| calendars | calendar_id PK, display_name, timezone, color, access_role | 個人情報。ログに出さない |
| month_snapshots | (calendar_id, month_key, timezone) PK, events_json, fetched_at, generation | 一月の完全取得結果をatomic swap |
| month_interest | month_key, expires_at | 画面が要求した月の同期優先度 |
| sync_status | (calendar_id, month_key, timezone), status, last_success, last_error_code, retry_at | 件名/Google生errorを保存しない |
| app_metadata | key PK, value | schema compatibility等 |

単純な月別JSONスナップショットで開始し、必要性が判明するまで複雑なイベント正規化DBにしない。
イベント量が大きい場合は上限エラーを出し、ページを勝手に切り捨てない。
monthly snapshotsを結合する時は `(calendarId,eventId)` をキーに重複を除去する。
当該表示月のスナップショットを正とし、古い隣月のコピーを優先して移動/削除イベントを復活させない。

## API契約（実装対象）

| メソッド/パス | 内容 |
|---|---|
| GET /api/health/live | プロセス応答。秘密/予定なし |
| GET /api/health/ready | schema互換、DB可読、設定/ローカル機能の準備。Google接続は必須条件にしない |
| GET /api/version | releaseId, commit, builtAt, schemaVersion。no-store |
| GET /api/calendars | 選択可能カレンダーと選択状態 |
| GET /api/events?date=YYYY-MM-DD または month=YYYY-MM | キャッシュ結果＋calendarごとの鮮度/未取得状態 |
| POST /api/cache/request-month | 正規化した月の取得要求。許可範囲/頻度を制限 |
| POST /api/sync/request | 手動取得要求。即時Google通信ではなくWorkerへ要求 |
| GET/PATCH /api/settings | 非秘密設定のみ。許可キーを列挙 |
| GET /api/status | 同期・Worker heartbeat・バージョン概要 |

全APIは`Cache-Control: no-store`。events responseは`complete: false`や未取得calendarを明示。
ブラウザからGoogleへ直接アクセスしない。予定の説明はescapeしHTMLとして挿入しない。
Host allowlist＋状態変更時Origin検証＋JSON content-type。CORS wildcardなし。read endpointもHost検証する。
HTTPはloopback限定、リモートはSSHトンネル。公衆ネット向けの認証済みAPIとしては設計しない。

## buildの契約

`next build`のstandalone出力を `dist/web/` にpackageし、`public`と`.next/static`を正しい位置へコピーする。[S06]
Worker/CLIはNode向け `dist/worker.mjs`, `dist/cli.mjs` にcompile。
ネイティブ依存は外部化し、Linux arm64で解決したruntime dependenciesをreleaseに含める。
root読取り専用releaseで動くよう動的API中心・ISR不使用・画像最適化不使用を初期方針にする。
起動時書込みが必要なキャッシュを追加する場合は明示的にstate directoryへ配置し、releaseを書込み可能にして解決しない。
ビルドは本番token/ネット上のフォント/本番DBがなくても成功すること。
