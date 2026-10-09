# 10 初期設計判断（ADRの要約）

| ID | 初期決定 | 理由 | 将来変更する条件 |
|---|---|---|---|
| ADR-001 | Next.js + 独立Worker | React経験を使い、同期をHTTP寿命から分離 | Node runtime/memory実測で別構成が明確に有利 |
| ADR-002 | Google読取専用 | 表示端末のMVP、誤編集/権限を減らす | 予定作成/編集をユーザーが明示要求 |
| ADR-003 | 月別full snapshot | 端末1台・小期間。削除反映/復旧が単純 | 同期量/長期横断検索の必要が実測で判明 |
| ADR-004 | Desktop OAuth CLI + loopback | Piでtoken保持、Macから初回認証可能 | 公開サービス化/管理UIが必要 |
| ADR-005 | SSH経由リリース更新 | 不要なWeb root権限/APIを増やさない | 一般ユーザー向け配布/複数台管理 |
| ADR-006 | Linux arm64でビルド | Mac成果物とOS/ネイティブ依存を分離 | 同等arm64 CIで署名成果物を作る |
| ADR-007 | systemd + GUI autostart | 小規模なLinux端末の運用を単純化 | コンテナ化が運用負荷を実測で減らす |
| ADR-008 | 外部SaaS/クラウド不要 | オフライン表示/自分で管理 | 端末外同期/複数ユーザーの要件追加 |
| ADR-009 | 自動main追従しない | 使っている画面を未確認変更で壊さない | staged rollout/署名自動更新を別設計 |
| ADR-010 | アプリDBとコードを別保存 | 更新/rollbackでキャッシュと認証を保つ | 原則維持 |

これらは今回の設計案。ユーザーが個別のライブラリや運用方式まで承認済みという意味ではない。
変更時は「背景/代案/選択理由/テスト/移行とrollback」を追記してから実装。

## ADR-011 M2の依存選択（2026-10-09）

- 背景：03_ARCHITECTUREはbetter-sqlite3と公式googleapisを第一候補としていた。Pi（Linux arm64）での再ビルドとrelease容量を減らしたい。
- 選択：SQLiteはNode 24内蔵の`node:sqlite`（DatabaseSync、WAL、busy_timeout）。Google APIは`fetch`でCalendarList.list / Events.list / tokenエンドポイントのみを直接呼ぶ。Worker/CLIは`rolldown`（devDependency、固定版）で`dist/worker.mjs`・`dist/cli.mjs`へ単一ファイル化。
- 理由：ネイティブaddonのarm64ビルドが不要。読み取り2endpointのみで、書込みAPIを呼ぶコードが存在しない。runtime依存はluxon/zodだけ。
- 代案：better-sqlite3（成熟、ただしネイティブビルド）、googleapis（大きい、全API面を含む）。
- テスト：tests/integration/google-sync.test.ts（ページング、途中失敗でのcache保持、空成功、401/403/429/5xx/network分類、上限、generation、PKCE/state、token 0600/保持/rotate、Origin/Content-Type）。Pi arm64 / Node 24.21.0で実行。
- 移行/rollback：schema_version=1。新しいschemaのDBを古いreleaseは開かず明示エラー。`node:sqlite`に問題が出た場合はCalendarStoreの実装差し替えで対応（呼び出し側は同期API前提）。
