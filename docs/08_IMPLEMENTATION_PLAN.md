# 08 実装計画

全て未着手から開始。1段階ごとにレビューし、実機変更は承認後。

## M0: リポジトリと境界

| ID | 作業 | 完了条件 |
|---|---|---|
| T001 | Node24/Next/React/TSとnpm scripts | pin/lockfile、strict、lint/typecheck/buildが動く |
| T002 | config検証・dev stateの分離 | 設定不足を安全に通知。mockでGoogle資格不要 |
| T003 | 型/Clock/Provider/Repository境界 | 日付unionと注入可能Clock、依存方向のテスト |
| T004 | check pipeline | private credentials不要のunit/integration/e2e雛形 |

## M1: ダミーUI

| ID | 作業 | 完了条件 |
|---|---|---|
| T101 | 月グリッド | 6週・前後月・today・選択日・件数overflow |
| T102 | 日一覧/詳細 | 終日/時刻/跨日・長文・空/未取得の区別 |
| T103 | タッチ/設定/レスポンシブ | viewport4種、hoverなし、文字サイズ |
| T104 | 状態バー・clock・ErrorBoundary | 切断/再認証mock、日付跨ぎ、表示が消えない |

**M1完了時に一度止めて、実スクリーンショットとテスト結果を報告。**

## M2: Googleと永続化

| ID | 作業 | 完了条件 |
|---|---|---|
| T201 | OAuth CLI/TokenStore | PKCE/state/loopback、0600、cancelと失効、安全な再認証 |
| T202 | CalendarProviderと正規化 | pages/終日/offset/例外/取消/権限エラーをテスト |
| T203 | SQLite repositories | month snapshot atomic swap、WAL、バックアップ |
| T204 | 独立Worker | 排他、60秒/5分、retry、設定generation、heartbeat |
| T205 | API/画面への接続 | no-store、Host/Origin、fresh/stale/partial、無認証起動 |
| T206 | Google実確認 | ユーザー自身のテストcalendarで操作。AIは予定値を取得しない |

## M3: Pi実行と起動

| ID | 作業 | 完了条件 |
|---|---|---|
| T301 | Linux arm64 package | standalone assets/worker/CLI/ネイティブ依存がroot-readonlyで動く |
| T302 | bootstrap実装 | dry-run、OS検査、限定sudo、既存設定backup、再実行安全 |
| T303 | systemd＋GUI auto login/kiosk | 新旧GUI差異対応、ブラウザ終了復旧、maintenance |
| T304 | offline reboot | Googleなしでもキャッシュ。モニター電源復帰/タッチを実機確認 |

## M4: 開発・更新

| ID | 作業 | 完了条件 |
|---|---|---|
| T401 | source archive/remote runner | commit固定、SHA検査、安全展開、非root build |
| T402 | preflight/release manifest | tokenなしcandidate、schema互換、資産抜け検出 |
| T403 | switch/rollback/journal | lock、backup、両service切替、起動失敗復旧 |
| T404 | power-loss recovery | 未確定journalから最終成功版。手動復旧runbook |
| T405 | front-end版追従 | version changed→reload、API障害ではreload stormなし |
| T406 | Mac/Remote-SSH/Tailscale手順 | 公開port不要でA/B両経路が使える |

## M5: 常用前確認

24時間表示、0時/月初、ネット断/復帰、認証取消、低容量、繰り返し変更、失敗release、rollback、GUI再起動。
[受入テスト](09_ACCEPTANCE_TESTS.md)のMUSTを満たしてv0.1.0候補。
UI確認だけで「専用端末完成」と呼ばない。

## 実装するnpmコマンド契約

| 名前 | 役割 |
|---|---|
| dev | mock初期値、port3100、開発state、webと必要なdev workerの終了管理 |
| lint / typecheck / test | 個別チェック |
| check | lint + typecheck + unit/integration |
| test:e2e | Playwright、合成fixtureのみ |
| build | Web/Worker/CLI、秘密不要、runtime成果物を生成 |
| auth:google | 開発用OAuth CLI（ユーザー実行） |
| deploy / deploy:local / deploy:status / rollback | M4で実装する運用コマンド |

最初は未実装コマンドを成功exitのダミーにしない。必要なら明確な未実装errorを返す。
