# PiでPR版を試す（M0/M1 mockのみ）

この手順は本番へのデプロイではなく、専用の開発ディレクトリでの実機確認です。Google認証、systemd、kiosk、OS/SSH/firewallの設定変更は行いません。Piの64-bit OSとNode.js 24が必要です。クラウドで検証したのはLinux x86_64で、Pi arm64の結果はまだありません。

## 1. ソースを取得

Piの一般ユーザーで実行してください。既存の本番ディレクトリにはclone/pullしません。以下のclone先が既に存在する場合は、その作業を保存してから、別の空の開発ディレクトリを選んでください。

```bash
mkdir -p ~/src
git clone --branch feat/mock-calendar-ui https://github.com/inai17ibar/pi-calendar.git ~/src/pi-calendar-trial
cd ~/src/pi-calendar-trial
bash scripts/doctor.sh
node --version
npm --version
```

private repositoryの場合は、Piの既存GitHubアクセスを使ってください。認証値をチャットに貼らないでください。`doctor.sh`は読取り専用で、ソフトウェアをインストールしません。Nodeが24系でない場合は、Nodeの導入を別作業として済ませてから続けてください。

## 2. Pi自身で導入・ビルド

```bash
cd ~/src/pi-calendar-trial
npm ci
npm run check
npm run build
npm start
```

`npm start`はビルド済み`dist/web/server.js`を起動します。127.0.0.1:3100待受け、mockモード、stateは`.local/dev`が既定値です。別のアプリが3100を使う場合は、それを停止せず`CALENDAR_PORT=3110 npm start`などで空きポートを選び、以下のURLも合わせてください。

Mac/クラウドのnode_modules・.next・distをPiにコピーしないでください。`npm ci`とbuildはPi側で行います。失敗した場合は先へ進まず、認証値を含まないエラーと`doctor.sh`の必要な項目を確認してください。メモリ不足が疑われる場合も、OS/swap変更を勝手に行わないでください。

## 3. 画面とAPIを確認

サーバーのターミナルを開いたまま、Piの別ターミナルで実行します。

```bash
curl --fail http://127.0.0.1:3100/api/health/ready
curl --fail http://127.0.0.1:3100/api/events?month=2026-10
chromium http://127.0.0.1:3100
```

Chromiumのコマンド名が違う場合は、Piの通常のブラウザから同じローカルURLを開いてください。sandboxやTLS検証を無効にするフラグは不要です。healthの`status:ok, mode:mock`は合成UIの準備だけを示し、Google/SQLite/Workerが動いているという意味ではありません。

- 月/週/日/今日/前後月・週、日付タップと見出しの一致。
- 月を跨ぐ週の全7日、終日欄、複数日の継続矢印、跨日の両日表示と詳細日時。
- 週の時間軸を指で上下へスクロールし、固定日付見出し・予定タップ・詳細の閉じる操作を確認。
- 右側の予定一覧の縦スクロール、予定詳細を開閉。
- 設定の明暗・文字サイズ・週始まり。文字拡大時も操作できること。
- デモ状態を未取得/オフライン/再認証に切替。予定ゼロと未取得が区別されること。
- モニター実機でのタッチ、見やすさ。Googleは未接続なので予定はすべて合成データ。

Macからの表示は、既存の許可済みSSH設定で3100へのローカル転送を使ってください。PiのLANへWebを直接公開する手順はありません。

## 4. PRブランチを更新

自分で起動したWebをCtrl+Cで停止してから実行します。ローカル変更がある場合は保存してから進め、reset/cleanで消さないでください。

```bash
cd ~/src/pi-calendar-trial
git status --short
git pull --ff-only origin feat/mock-calendar-ui
npm ci
npm run check
npm run build
npm start
```

ビルド後にブラウザを再読み込みします。自動リリース切替・rollback・版変更の自動reloadはM4で実装するため、現段階ではこの試験手順で確認します。結果はPi OS版、arm64、Node版、commit、成功したチェック、実機操作の結果を分けて記録してください。実際の個人予定や認証情報は不要です。
