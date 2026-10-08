# 04 Google Calendar 同期と認証

## 1. 認証方針

個人用インストール型アプリとして、Google OAuthクライアントを **Desktop app** で作成する。
CLIはAuthorization Code + PKCE(S256) + stateを使用し、loopback callbackで認可コードを受け取る。[S01]
APIキー単体、Googleパスワード保存、一般的なDevice Flow、OOBコードの手コピーは採用しない。
サービスアカウントに個人カレンダーを共有する方式も初期案では採用しない。

要求scopeは次の2個。[S02]

```text
https://www.googleapis.com/auth/calendar.events.readonly
https://www.googleapis.com/auth/calendar.calendarlist.readonly
```

1アカウントから開始。全カレンダー編集権限は不要。
Google CloudでCalendar APIを有効化し、同意画面とテストユーザーを設定し、Desktop client JSONを作る。
JSONはユーザー自身がPiのsecretsへ配置。値をチャットやGitへ貼らない。
Cloud UIの位置/文言は変わるため、実装時の公式画面を確認する。

## 2. Macのブラウザで、PiのCLIを認証する

**以下のCLIはM2の実装契約で、まだこの雛形には存在しない。**

```bash
# Mac：Piのloopback callbackをMacへ転送。接続を維持する。
ssh -L 127.0.0.1:42813:127.0.0.1:42813 pi-calendar

# この後のシェルはPi。実装済みの認証CLIを必要なユーザーで起動する。
# 本番認証の前には同期Workerを停止し、token書込みの競合を避ける。
# 実行例のnodeパスとユーザーはbootstrap後に確定する。
sudo -u calendar-app /usr/bin/node /opt/pi-calendar/current/dist/cli.mjs \
  auth google --port 42813 --no-open --state-dir /var/lib/pi-calendar
```

CLIは `http://127.0.0.1:42813`（パスなし）をredirect URIとして認証URLを出す。
そのURLを**ユーザーが**Macの通常ブラウザで開く。これはOOBの認可コード手入力とは異なる。
認証後のMacのloopback接続がSSH経由でPiのCLIへ届き、token交換/保存はPiだけで行う。
Pi直結キーボード/通常ブラウザでも同じCLIを使用可。ポートは変更可能だがMac/Piで一致させる。

listenerは127.0.0.1のみ、10分timeout、ワンショット。port使用中なら自動で別portに逃げず明確に終了。
callback path/stateを検証し、code/state/verifierをログへ残さない。認証URLも長期ログへ保存しない。
CLI終了後にWorkerを再開。キャンセル時に既存の有効tokenを削除しない。
Desktop client secretは配布ソフトの機密保持保証には使えない。PKCE/stateとtokenの保護を主な防御とする。

## 3. トークンのライフサイクル

refresh tokenを取得して0600でatomic write。親secrets directoryは0700。
更新応答にrefresh_tokenがない場合は既存の値を維持する。access tokenは主にメモリ保持。
通常再起動でユーザー再ログイン不要。ただし失効・取消・Google側制約で再認証は起こり得る。
`invalid_grant`は再認証状態にし、無限リトライしない。キャッシュは維持する。
端末紛失時のGoogle側アクセス取消手順を運用資料に残す。読取権限でも予定は個人情報。

**外部・TestingのOAuthでは、Calendar scopeを使うrefresh tokenが7日で失効する条件がある。** [S03]
常用前にPublishing status等を確認。Productionへの切替だけで審査/警告が必ず不要になると保証しない。
組織アカウントは管理者の制限があり得る。回避せず管理者へ確認する。

## 4. 同期方式：月ごとの完全スナップショット

MVPは短い対象期間を定期的に取り直す。**syncTokenは使用しない。**
Googleのlistは `singleEvents=true` で繰り返しを展開でき、`nextPageToken`を最後まで処理する必要がある。
timeMin/timeMaxとsyncTokenを混在させない。[S07,S08]

1組の `(calendarId,monthKey,displayTimezone)` に対して：

```text
表示timezoneで月初と翌月初を計算
  → events.list(singleEvents=true, showDeleted=false,
                orderBy=startTime, timeMin, timeMax, timeZone,
                maxResults=2500)
  → nextPageTokenがなくなるまで全ページを取得
  → 正規化・検証・cancelled除外・重複除外
  → transactionでこの月のsnapshot全体を置換
  → lastSuccessを更新
```

timeMin/timeMaxはoffset付きRFC3339。全ページ成功前に既存snapshotを消さない。
成功した空配列は「予定ゼロ」で置換。失敗は以前のsnapshotを維持し、エラー状態のみ更新。
最大100,000イベント/月を初期安全上限とし、超過時は不完全な結果を保存せず明示エラーにする。
取得中に選択calendar/timezoneが変更されたらgenerationを確認し、古い設定の結果を反映しない。

削除や月外への移動は、成功した完全置換により旧イベントが消える。
別月へ移動した予定は移動先snapshotの更新後に表示。選択範囲外まで瞬時同期する保証はしない。
同一月の複数calendarは独立に更新可。UIは一部失敗を明示する。

## 5. 周期・キャッシュ範囲

CalendarListも全ページ取得し、初回・手動更新・6時間ごとを目安に名前/権限/色を再確認する。
初回：現在月を最優先し、前月/翌月/翌々月の4か月を順次取得。
通常：現在月＋現在画面の月を60秒ごと。残りの4か月基本範囲は5分ごと。
月グリッドの前後月セルに必要な月もrequestし、未取得は保留表示。
過去/未来閲覧は現在月±12か月までを初期上限に、必要な月だけ取得し24時間程度保持。
Worker同時通信は2件以下から始め、同一snapshotの重複取得は排他。
手動同期は10秒以内の連打をまとめる。API失敗中はジッター付きbackoff（初期30秒、上限15分）。[S09]
ネット復帰時は前回失敗の再試行、0時/月初は同期対象の再計算。端末時刻の巻き戻りでもループしない。

## 6. 正規化

`TimedEvent`と`AllDayEvent`を判別可能なunionにする。
時刻付きは元offset付きdatetimeを保持しUTC instantでも比較する。
終日は `YYYY-MM-DD` のdateのまま保持し、安易にnew DateでUTC化しない。
endは排他。例えば開始10/3・終了10/4の終日は10/3だけに表示する。[S10]
繰り返しinstanceのrecurringEventId/originalStartTimeを保存し、展開済みinstanceへRRULEを再適用しない。
表示日との区間重なりは start < dayEnd && end > dayStart。終日はdate区間で同様に判定。
取消イベントは表示しない。空summaryは「（件名なし）」、権限で伏せられた予定は「予定あり」。
非表示/解除calendarのキャッシュは画面から直ちに除外。認可取消/403権限喪失はデータを隠す運用を優先。

詳細HTML・参加者一覧はMVPで保存しない。location等も画面に必要な分だけ。
Google生レスポンスを無制限に保存しない。fixturesのみ安全な合成データを使用する。

## 7. 将来の差分同期

全期間のイベントミラーが必要ならsyncToken＋マスターイベント/例外管理へ別ADRで移行する。
410での再同期、最後のpageでtoken確定、deletedの反映を必須にする。[S08]
現行の月スナップショットにsyncTokenだけ足す変更は禁止。
