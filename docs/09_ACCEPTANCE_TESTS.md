# 09 受入テスト・故障注入

状態は実行日/環境/コマンド/結果/証跡で記録する。以下は全てテスト計画であり合格記録ではない。
Mac実行のPlaywright成功とPi実機の操作は別に記録する。

| ID | 対応要件 | 操作・入力 | 期待結果 |
|---|---|---|---|
| A01 | CAL-01/02 | 月/日/今日/前後月をタップ | 正しい日付、選択と見出しが一致 |
| A02 | CAL-05 | start.date=10/3,end.date=10/4 | 10/3だけ終日表示 |
| A03 | CAL-05 | 10/3 23:30→10/4 00:30 JST | 両日へ継続表示、二重イベント扱いなし |
| A04 | CAL-05 | 海外timezone/夏時間切替 | UTC順と表示日が正しく、1日=24h固定計算なし |
| A05 | CAL-03/05 | Google側で一回だけ移動/取消 | 元のinstanceが残らない |
| A06 | CAL-03 | nextPageToken付き、2ページ目空/失敗 | 最終まで取得。途中失敗で既存キャッシュを保持 |
| A07 | CAL-03 | 完全取得成功で空配列 | 旧イベント消去、予定ゼロと表示 |
| A08 | CAL-04 | 同event IDが別calendarに存在 | 両方表示、誤って重複除外しない |
| A09 | UI-02 | 一calendarだけ403/ネット失敗 | 他calendarは表示、部分失敗が分かる |
| A10 | CAL-05 | 翌月に移動した予定＋古い隣月cache | 削除済みの古いcopyで復活させない |
| A11 | BOOT-01 | ネットありcold boot | 手操作なしに90秒目標で表示、実測記録 |
| A12 | BOOT-02 | 取得済みDBでネットなしcold boot | ローカル予定表示。未取得と空を区別 |
| A13 | BOOT-03 | 専用Chromiumだけ終了 | supervisorが復帰。他のブラウザに影響なし |
| A14 | BOOT-03 | Web/Workerを個別異常終了 | 自動復帰。重複Worker/token更新なし |
| A15 | UI-02 | invalid_grant/アクセス取消 | 再認証案内、retry stormなし、仕様通りcache保護 |
| A16 | UPD-01/03 | 型errorまたはbuild失敗のcommit | current/前版/サービスが変化しない |
| A17 | UPD-03 | candidate root/assets/health失敗 | 本番切替なし |
| A18 | UPD-03 | 切替後ready失敗 | 旧版へ復旧しユーザーの予定/設定を維持 |
| A19 | UPD-03 | DB非互換migration | 自動適用を拒否。明示手順を要求 |
| A20 | UPD-04 | release変更とAPI一時停止 | 新IDで1回reload。停止中は旧表示維持、loopなし |
| A21 | DEV-01/02 | MacとPi dev port3100 | 本番port3000とDB/tokenが不変 |
| A22 | UPD-01/02 | 同時deploy、途中SSH切断 | lockで拒否、既存jobに再接続可能 |
| A23 | UPD-03 | 各stateで更新job停止/再起動 | journalから最終成功版/手動復旧。実Pi試験は承認後 |
| A24 | UI-01 | 実機指操作/小viewport/長文 | 操作対象に触れ、スクロールと詳細が使える |
| A25 | CAL-02 | 23:59→00:01、月末/年末 | 今日/対象月/同期範囲が更新 |
| A26 | SEC | 不正Host/Origin、descriptionのscript | API拒否/文字列escape、コード実行なし |
| A27 | SEC | bundle/ログ/エラー/ZIPの検索 | token/client secret/個人予定なし |
| A28 | BOOT-03 | 24時間常用 | ハング、過大ログ、画面消灯、メモリ増大を点検 |
| A29 | SEC | deploy archiveに../ /外部symlink | 拒否。本番/他ファイル不変 |
| A30 | UPD-03 | 空き容量不足/backup失敗 | 切替拒否、旧版のサービス再開 |

## fixtureの使い方

`fixtures/google/`は合成のGoogle応答形状。ページング、終日、跨日、繰り返しinstanceを含む。
`fixtures/cases.json`に期待値の要点を記載。実ユーザーの予定をfixtureとしてコミットしない。
mockモードは固定Clockを使い、見た目の確認用には日付を相対化する別seedを用意してもよい。
相対seedと正確なtimezone境界テストを混在させない。

## 受入証跡

`docs/STATUS.md`に結果を記録し、個人予定が映るスクリーンショットはrepoへ入れない。
実機でのみ可能なテストをCIが合格したと称さない。
