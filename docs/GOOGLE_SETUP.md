# Google Calendar接続（開発環境・M2）

読み取り専用で接続する手順です。**ここに出てくるclient JSON・token・認証URLの値をチャット、Issue、ログ、Gitへ貼らないでください。** 操作はすべてユーザー自身がPi上（またはMacのブラウザ）で行います。

要求するscopeは次の2つだけです。予定の作成・変更・削除のAPIは実装していません。

```text
https://www.googleapis.com/auth/calendar.events.readonly
https://www.googleapis.com/auth/calendar.calendarlist.readonly
```

## 1. Google Cloudでclientを作る（初回のみ）

Cloud ConsoleのUI名は変わることがあります。実際の画面を確認しながら進めてください。

1. https://console.cloud.google.com/ でプロジェクトを作成（既存の個人用プロジェクトでも可）。
2. 「APIとサービス」→「ライブラリ」で **Google Calendar API** を有効化。
3. 「Google Auth Platform」（旧OAuth同意画面）でアプリ名・サポートメールを設定。対象は「外部」、**テストユーザーに自分のGoogleアカウント**を追加。
4. 「クライアント」→「クライアントを作成」→種類 **デスクトップアプリ** → 作成後にJSONをダウンロード。

**注意：** 公開ステータスが「テスト」のままだと、Calendar scopeのrefresh tokenは**7日程度で失効**します。失効すると画面は「再認証が必要」になり、保存済みの予定は残ります。常用する場合は公開ステータスの変更を検討してください（未確認アプリの警告が出る等の条件はGoogleの現行ルールを確認）。

## 2. client JSONをPiに置く

ダウンロードしたJSONをPiの開発stateへ置きます（パスは`CALENDAR_STATE_DIR`、既定`.local/dev`）。

```bash
cd ~/src/pi-calendar
mkdir -p -m 700 .local/dev/secrets
mv ~/Downloads/client_secret_*.json .local/dev/secrets/oauth-client.json
chmod 600 .local/dev/secrets/oauth-client.json
```

`.local/`はGit対象外です。本番の`/var/lib/pi-calendar`は開発では使えません（helperが拒否します）。

## 3. 認証（PKCE + loopback）

```bash
npm run build                 # dist/web, dist/worker.mjs, dist/cli.mjs
npm run cli -- auth google    # 127.0.0.1:42813 で10分だけ待受け
```

表示されたURLを開いて許可します。

- **Piのデスクトップのブラウザ**で開く場合：そのまま開くだけ。
- **Macのブラウザ**で開く場合：先にMacで `ssh -L 127.0.0.1:42813:127.0.0.1:42813 <pi>` を開いたままにしてから、URLをMacで開く。

「Googleはこのアプリを確認していません」と出た場合は、自分で作ったclientであることを確認して続行します。2つの読み取り権限を両方許可してください。成功すると`.local/dev/secrets/tokens.json`（0600）にrefresh tokenだけが保存されます。キャンセル・タイムアウト時は既存tokenを変更しません。ポートが使用中なら`--port 42814`等を指定し、SSH転送も同じ番号にします。

## 4. 同期Workerと画面を起動

ターミナルを2つ使います。

```bash
npm run worker                          # 単一インスタンス。Ctrl+Cで停止
CALENDAR_MODE=google npm start          # http://127.0.0.1:3100
```

Workerは起動直後にカレンダー一覧を取得し、今月→前月/翌月/翌々月の順に月単位で全ページ取得してからSQLite（`.local/dev/calendar.sqlite`、0600）へ置き換えます。今月と表示中の月は60秒、それ以外は5分ごとに更新します。通信失敗時は前回の予定を保持し、30秒〜15分のbackoffで再試行します。画面の「再取得」はWorkerへ要求するだけで、ブラウザからGoogleへは通信しません。

## 5. 表示するカレンダー

既定では、Googleカレンダー側でチェックが入っているカレンダー（とメイン）を表示します。変更する場合：

```bash
npm run cli -- calendars list           # [x] が表示中。名前とIDはこの端末にだけ表示
npm run cli -- calendars select <id> [<id>...]
npm run cli -- calendars select --google  # 既定に戻す
npm run cli -- status                   # 認証/Worker/件数のみ（予定内容は出さない）
```

## 6. 接続をやめる・再認証

- 再認証：Workerを止めずに`npm run cli -- auth google`を再実行すれば、Workerが新しいtokenを自動で読み直します。
- 接続解除：https://myaccount.google.com/permissions でアプリのアクセスを削除し、`.local/dev/secrets/tokens.json`を削除。
- キャッシュ削除：Worker/Webを停止してから`.local/dev/calendar.sqlite*`を削除（Googleの予定には影響しません）。

## 未実装（M3以降）

systemdでのWeb/Worker常駐、kiosk自動起動、本番state（`/var/lib/pi-calendar`）でのCLI運用、DBバックアップCLIは未実装です。
