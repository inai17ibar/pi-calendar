# 実装状況

最終更新：2026-10-08（クラウドLinux x86_64、Node 24.19.0、npm 11.9.0）

| 段階 | 状態 | 証跡 |
|---|---|---|
| スターター仕様/テンプレート | 取り込み済み | 元のREADMEはSTARTER_README.md、既存docs/ops/fixturesを保持 |
| M0 基盤 | 実装・検証済み | pin/lock、strict TS、config検証、Clock/Provider/Repository境界 |
| M1 合成UI | クラウド検証済み | 月/日/詳細/設定/状態/時計、4viewport |
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
