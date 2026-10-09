# 実装状況

最終更新：2026-10-09（Raspberry Pi・Debian 12 bookworm・aarch64、Node 24.21.0、npm 11.19.0）
最終更新：2026-10-09（クラウドLinux x86_64、Node 24.19.0、npm 11.9.0）

| 段階 | 状態 | 証跡 |
|---|---|---|
| スターター仕様/テンプレート | 取り込み済み | 元のREADMEはSTARTER_README.md、既存docs/ops/fixturesを保持 |
| M0 基盤 | 実装・検証済み | pin/lock、strict TS、config検証、Clock/Provider/Repository境界 |
| M1 合成UI | クラウド検証済み | 月/日/詳細/設定/状態/時計、4viewport |
| M2 Google同期/SQLite/Worker | 実装・fake Googleで検証済み | T201–T205。実アカウント接続（T206）はユーザー操作待ち |
| M3 Pi起動 | 実装済み・実機適用待ち | installer/kiosk/unit。sudo適用と再起動試験はユーザー承認後 |
| M1 合成UI | クラウド検証済み | 月/週/日/詳細/設定/状態/時計、4viewport |
| M2 Google同期/SQLite/Worker | 未着手 | Google通信/認証なし、mockメモリのみ |
| M3 Pi起動 | 未着手 | 実機OS・arm64・タッチ・自動起動未検証 |
| M4 update/rollback | 未着手 | 未実装 |
| M5 実機長時間 | 未着手 | 未実施 |

## 実行結果

- `npm ci --no-audit --no-fund`：固定lockfileから再導入成功。
- `npm run check`：lint/strict型チェック成功、unit/integration **36件合格**。
- `npm run build`：成功。`dist/web`へstandaloneと静的アセットを配置。ビルドはGoogle/DB/外部フォント不要。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`：**12件合格**。1920×1280、1536×1024、1280×853、1024×683 CSS px。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:runtime`：**1件合格**。production standaloneのready/events、月末0時の今日追従、手動選択日の保持。
- `npm audit --omit=dev`：実行時点のproduction依存の既知脆弱性0件。開発依存はこの監査対象外。
- 開発Webを127.0.0.1:3100で起動し、ready/events/画面をローカルHTTPで確認。

初回の型チェック失敗はテストでのenv型定義を修正して解消。初回runtime Clockテストはhydration前に時刻を進めていたため、fixture読み込みを待つよう修正して再実行合格。未解決のテスト失敗はありません。

[1920×1280](screenshots/calendar-1920x1280.png) / [1536×1024](screenshots/calendar-1536x1024.png) / [1280×853](screenshots/calendar-1280x853.png) / [1024×683](screenshots/calendar-1024x683.png)。実際のブラウザ画面であり、予定はすべて合成データ。

## 対応範囲

T001–T004、T101–T104のmock段階を実装。CAL-01/02、CAL-05の表示境界、DEV-01、UI-01/02/03のブラウザ操作を検証。Google繰り返し・ページング・削除の同期、SQLite永続化、GoogleなしのPi再起動は未実装なので、この検証をCAL-03/BOOT/UPDの合格とは扱いません。

主な追加：package/lock/tool設定、src/app、src/components、src/domain、src/server、Web起動/package helper、unit/integration/e2e/runtimeテスト。README/STATUSを更新。元の仕様・テンプレートを保持し、OSやGoogle設定は変更していません。

APIのreadyはmockのみ。同期状態切替はデモで、ネット状態やGoogle接続を実測していません。キャッシュ保持はブラウザ内の同一月サンプルで、リロードを跨ぐ永続キャッシュではありません。snapshot repositoryはmemoryの境界実装、表示設定はlocalStorageです。

Gitリポジトリは元々空であったため、スターターをmainの初期コミットとし、実装はfeat/mock-calendar-uiブランチへ分離。commit/push/PRの最終状態は作業報告を参照。ユーザー確認済みのモニター/USBタッチの事実は、このソフトウェアのPi実機動作を証明しません。

次の最小タスク：M2のread-only Google adapterと月スナップショットSQLiteの実装。認証値はチャットで収集しない。

## Pi試験用の追加確認（2026-10-08）

現在の開発Webを再取得し、ready HTTP 200、日別events 5件、HTML HTTP 200、Chromiumページエラー0件を確認。[現在の実画面](screenshots/current-cloud-1280x853.png)を追加。`npm start`をstandalone出力の起動に統一し、runtimeテストも同じコマンドを使う。Piのclone/pull/build手順は[PI_TRIAL](PI_TRIAL.md)に記録。Piでの実行結果はまだ未確認。

## Pi実機 + M2（2026-10-09、ブランチ feat/google-sync）

環境：Raspberry Pi（aarch64）、Debian 12 bookworm、labwc/Wayland、RAM 8GB、NVMe。Nodeが未導入だったため、公式 `node-v24.21.0-linux-arm64.tar.xz` をSHA256検証のうえ `~/.local/node` へ展開し、`~/.bashrc` にPATHを1行追加（sudo・aptは不使用）。

M1（変更前のcommit caf9ed0）のPi結果：`npm ci` 成功、`npm run check` 36件合格、`npm run build` 成功、`test:e2e` 12件合格、`test:runtime` 1件合格（`/usr/bin/chromium` 154）。`npm start` で ready/events のHTTP 200を確認。

M2の実装：
- `src/server/storage/db.ts`：`node:sqlite`、WAL、schema_version=1、月スナップショットのtransaction置換、generation検査、失敗時は状態のみ更新、DBファイル0600。
- `src/server/google/client.ts`：CalendarList/Eventsの読み取りのみ。singleEvents、showDeleted=false、全ページ取得後にのみ返す、10万件上限、HTTPエラーの内部分類（生メッセージは保存しない）、正規化（cancelled除外、終日date、offset保持、件名なし/予定あり）。
- `src/server/auth/`：Desktop OAuth、PKCE S256＋state、127.0.0.1限定のワンショットloopback（10分）、余分なscopeの拒否、tokenの0600 atomic write、refresh_token欠落時は保持、invalid_grant→auth_required。
- `src/worker/`：単一インスタンスlock、今月→前後月の優先順、60秒/5分、jitter付きbackoff（30秒〜15分）、手動同期の10秒集約、表示月の要求（±12か月、24時間）、範囲外の月の削除、token更新の自動再読込。
- `src/cli/main.ts`：`auth google`、`calendars list|select`、`status`。
- API：googleモードで `/api/events` がSQLiteを返す（complete/available/state/calendars）。`/api/status`、POST `/api/cache/request-month`・`/api/sync/request`（Origin＋JSON必須）。
- UI：googleモードではDEMO表示を外し、実状態・カレンダー凡例・最終取得時刻・30秒ごとの再読込を表示。

Pi上の実行結果：
- `npm run check`：lint/型 成功、unit/integration **66件合格**（M2の30件を追加）。
- `npm run build`：成功（dist/web、dist/worker.mjs、dist/cli.mjs）。
- `test:e2e` **12件合格**、`test:runtime` **1件合格**（mockモードの回帰）。
- 認証情報なしのgoogleモード：health/ready・status・events がno-store、`not_configured`表示、Originなし POST は403。ダミーclientでのCLI：誤stateは400、拒否時はtokenを作らず終了。
- 合成fixtureをSQLiteへ入れたgoogleモード画面をPlaywrightで確認（予定3件、pageerror 0、未取得カレンダーを凡例で表示）。

未検証：実Googleアカウントでの認証と同期（ユーザー操作。手順は[GOOGLE_SETUP](GOOGLE_SETUP.md)）、Testing公開状態での7日失効、長時間稼働、systemd常駐、kiosk、オフライン再起動。Worker稼働中にCLIで再認証した場合、Workerはtokenを読み直すが、同時にGoogleがrefresh tokenをrotateした場合の競合は本番（M3）でWorker停止手順にする。

### 実アカウント確認とレビュー修正（2026-10-09）

ユーザーが自分のGoogleアカウントで認証し、画面「接続済み」、`cli status` の auth=ok を確認（T206。AIは予定内容を取得していない）。

コードレビュー指摘10件を修正：lockに boot_id を記録（停電後のPID再利用・自PIDで詰まらない、旧形式lockはPIDで判定）、カレンダー一覧取得の失敗にbackoff、heartbeatを15秒の独立タイマー化、手動「再取得」はbackoff中でも実行、画面の月移動を±12か月に制限（API/Workerと共通定数）、表示中の月の要求を1時間ごとに更新、壊れたtokens.jsonは「再認証が必要」、状態表示/凡例は表示中の月の応答だけを使用、access token更新を1本に集約、`/api/version` のschemaVersionを定数参照。期限切れの月要求の削除はprune時のみに整理。

Pi上の結果：`npm run check` **74件合格**、`npm run build` 成功、`test:e2e` 12件・`test:runtime` 1件合格。googleモードの一時stateで、翌月ボタンが12回で無効化（2027年10月）されpageerror 0件を確認。

次の最小タスク：M3（systemd unit・kiosk自動起動）。
## PR #5 デザイン・週表示の追加確認（2026-10-09）

GitHubの `feat/mock-calendar-ui`、`caf9ed0` を取得して実装。前環境の未push変更は使用していない。CAL-01/02/05、UI-01/02/03に関連するGoogleカレンダー風のデザインと時間軸付き週表示を追加。主な変更は `Calendar.tsx`、`WeekCalendar.tsx`、`globals.css`、週境界/重複時間帯のdomain計算、unit/e2e、画面仕様とPi試験手順。

- `npm run check`：lint・型チェック成功、unit/integration **39件合格**。月/年境界の週、跨日のクリップ、終端排他、重複時間帯の列分けを含む。
- `npm run build`：成功、standaloneと静的アセットを出力。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:runtime`：**1件合格**。production API・月末0時の今日追従と手動選択保持。
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`：**20件合格**。1920×1280、1536×1024、1280×853、1024×683 CSS px。月跨ぎの両月取得、重複コピーの除去、終日終了排他・複数日・跨日、週始まり/起動時週表示の保存、未取得と通信失敗、Chromiumタッチエミュレーションでの週移動・詳細開閉・時間軸スクロール。
- 実ブラウザのスクリーンショットを保存し、月/日/週の配置、跨日の0時側と複数日の終日欄を目視確認。

[月](screenshots/calendar-1280x853.png) / [日](screenshots/day-1280x853.png) / [週](screenshots/week-1280x853.png) / [跨日](screenshots/week-midnight-1280x853.png) / [複数日](screenshots/week-multiday-1280x853.png)。月/日/週は4viewportの証跡を保存。旧 `current-cloud` は以前のデザインの記録。

タッチ検証はChromiumのエミュレーションであり、Pi実機・arm64実行・実機タッチは未確認。短い時刻予定は48pxの操作領域を確保するため実時間より高さが大きくなる。同期データはmockのみで、同じ要求月範囲の通信失敗時にブラウザ内のサンプルを保持し、異なる未取得範囲へ流用しない。Google同期・認証・Pi OS設定は変更していない。

次の最小確認：Pi上でこのPRブランチを取得し、`docs/PI_TRIAL.md` の月/週/日・タッチ操作を実機確認する。

### 週表示の統合（2026-10-09）

`feat/mock-calendar-ui` の週表示（c4c32a2）を本ブランチへmerge。週が2か月に跨る場合の応答統合を `mergeSnapshots`（最悪状態・最古取得・全月取得済みのみ表示）としてdomainへ移し、googleモードの表示月要求も週の全月に対して行う。Pi上で `npm run check` 79件、`test:e2e` 20件、`test:runtime` 1件合格。googleモード（合成データの一時DB）で週表示の時刻予定5件・終日2件、pageerror 0件を確認。

## M3 常駐・全画面（2026-10-09、ブランチ feat/m3-kiosk）

実機確認（読取のみ）：labwc `-m`（設定マージ）、lightdm自動ログイン=inatani、user autostartなし・swayidleなし（画面OFF無効）、calendar-appユーザー・/opt・/var/lib・/etcは未作成、passwordless sudo可。

追加：`ops/install/install-production.sh`（既定dry run、`--apply`で実行、未commitならapply拒否、Node SHA256検証、専用ユーザー、root所有release＋atomic `current`切替＋`previous`、runtime.env維持、dev token取込、unit描画とバックアップ、ready確認）、`ops/install/pi-calendar-cli.sh`（本番CLI。auth中はWorker停止）、`ops/kiosk/install-kiosk.sh`（user、バックアップ、重複追加なし、uninstall）、supervisorのkiosk用フラグ（keyringプロンプト・スワイプ戻り防止。sandbox/TLSは既定のまま）、web unitに`HOSTNAME=127.0.0.1`固定。手順は[PI_INSTALL](PI_INSTALL.md)。

Pi上の結果：`npm run check` **87件合格**（ops 8件追加：kiosk installerを一時HOMEでapply/冪等/uninstall、GUI外での起動拒否、危険フラグなし、unitの非root・hardening・network-online非依存、installerのapply拒否）。読取専用にしたdistのコピーからgoogleモードのWeb（`/`・ready・version・events・静的JS すべて200、書込みエラーなし）とWorker `--once`を起動確認。installer dry runの全手順を出力確認。

未検証：sudo適用、systemd上での起動、kiosk表示、ネットあり/なし再起動、ブラウザ終了復帰、タッチ。
