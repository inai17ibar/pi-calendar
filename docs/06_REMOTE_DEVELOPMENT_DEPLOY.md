# 06 Mac / リモート開発 / アップデート

**ここに定義するdeploy/rollbackプログラムは未実装。M4で実装する契約。**
Tailscaleはネットワーク経路であり、アプリの更新エンジンではない。
最初はTailscale上の通常SSH鍵認証で十分。Tailscale SSHは別機能であり、導入は任意。[S14,S15]

## 1. 3つのワークフロー

### A: Macで編集 → Piでビルド → 本番へ

MacでClaude Code/Codexを使い、mock UIとテストを実行する。
確認済みcommitをrelease候補に指定し、ソースのみをSSHでPiへ転送。
Piの非root staging workspaceで `npm ci`、check、buildを実行し、Linux arm64用成果物を作る。
Mac側のDarwin向けnode_modules/.nextを転送しない。

### B: MacからPi内で編集 → 本番へ

SSHまたはVS Code Remote-SSHで `/home/<developer>/src/pi-calendar` を開く。[S16]
`npm run dev` をport3100、開発専用state directoryで起動する。
本番port3000は常に分離し、完成したcommitだけを同じreleaseコマンドで昇格する。
PiのRAMが不明なので、重い複数AIプロセス/ビルドの並列実行は初期状態でしない。

### C: 出先からTailscale → A/Bと同じ

MacとPiが同じtailnetに入り、本人の端末からPiのSSHだけ到達可能にする。
ルーターのポート開放は要求しない。Funnelによるpublic公開はしない。
Tailscale接続不可でもPiのカレンダー表示とGoogleの通常インターネット同期は独立して動く。

## 2. SSHとブラウザの確認

`ops/ssh/config.example`を実環境へ合わせる。ホスト名/IP/ユーザーを決め打ちしない。
鍵のホスト検証を無効にしない。SSH password無効化は鍵ログインを別セッションで確認してから。

```bash
# SSH設定がある場合。配布済みの実スクリプト。
bash scripts/ssh-tunnel.sh pi-calendar 3300 3000
# Macのブラウザで http://127.0.0.1:3300 を開く

# Pi内の開発版をMacで確認する場合
bash scripts/ssh-tunnel.sh pi-calendar 3310 3100
```

同じportへ別アプリがいる場合は停止させず、空きlocal portを選び、許可Origin設定も合わせる。
Tailscale SSHを選ぶ場合は通常SSHの鍵設定と同一視せず、SSHポリシー/接続権限/forwardingを検証する。
Webは127.0.0.1のみで待機。Tailscale IPへ直接公開する設計に変える場合は認証/権限設計を追加する。

## 3. コマンド契約（M4で実装）

```bash
npm run deploy -- --host pi-calendar --ref <full-commit-sha>
npm run deploy:local -- --ref <full-commit-sha>
npm run deploy:status -- --host pi-calendar
npm run rollback -- --host pi-calendar --previous
```

GitHubを使う場合でもPiに個人用のwrite権限付きtokenを置かない。
初期はMacが `git archive` 相当のtracked sourceを転送するpush型。
Pi内更新も同じアーカイブ形式にする。submodule/LFSは初期非対応とし明示エラー。
refはcommitへ解決してSHAを表示し確認。任意のbranch名をシェル文字列へ連結しない。
dirty treeは拒否し、未コミット修正は含めない。履歴/sourceと成果物のSHA対応を記録する。

## 4. release状態機械

```text
REQUESTED → STAGING → BUILT → PREFLIGHT_OK
                               ↓
                     STOP_SYNC → BACKUP → MIGRATING
                                            ↓
                                      SWITCHED → VERIFYING
                                                   ├─ 成功 → COMMITTED
                                                   └─ 失敗 → ROLLBACK → RESTORED
```

### 準備

deploy lockを取り同時更新を拒否。空き容量を確認（必要量は実測buildとbackupから算定）。
`releases/<timestamp>-<sha>`候補を作るが、ビルドは本番tokenを読めない非rootのstagingで実施する。
転送はコード・lockfile・manifestのみ。展開時に絶対パス/..//外部symlinkを拒否しSHA-256で転送整合性を検証。
署名検証まではMVP対象外。SSH接続先と開発者が信頼できるという境界を明記する。

### ビルド・事前検証

Piで依存解決/compile/test。失敗したら本番リンクもserviceも変えず終了。
リリース成果物をrootが管理する読取専用領域へ昇格し、copy中は候補としても起動しない。
一時state DB（本番backupのcopy、tokenなし・sync無効）とport3002でcandidateを起動。
root page/health/静的JS/CSSが出るか確認。public/.next/static抜けも検出する。
候補のschema min/maxと前版互換性をmanifestで検査。前版が読めない破壊的DB変更は自動適用を拒否。
preflight成功はGoogle接続成功を要しない。

### 切替

Workerを止めて重複token refresh/DB書込みを止める。Webも短時間停止して状態を静止させる。
SQLite online backup APIまたは全writer停止後の整合性を確認したbackupを作る。
WAL稼働中の `.sqlite` 単体をcpするだけのbackupは不可。[S17]
失敗したら旧版Web/Workerを再開。認証ファイルをログや通常ソースZIPへ混ぜない。
明示的なmigration CLIを一度実行。MVPはadditive/backward-compatible migrationのみ。
候補へのsymlinkを同一filesystemでatomic renameし、Web/Workerを同じreleaseで起動。

### 検証・復旧

60秒以内にready＋candidate release ID＋DB/schema＋ローカルroot pageを検証。
WorkerはGoogle接続とは別のprocess heartbeatで確認する。
UIが/api/versionで版変更を検知しreloadすることを確認。旧画面が残るだけなら成功扱いにしない。
成功後にprevious/currentを確定し、最低3つの成功版を保持。失敗ログは秘密をredactする。
失敗時は旧symlinkへ戻し両serviceを再開。DB互換性がなければ停止してbackup復元が必要。
backup復元は現行stateを退避し、ユーザー承認を得る。設定/認証更新が巻き戻ることを説明する。
通常の前版rollbackは互換性がある限りDB/tokenを巻き戻さない。

## 5. SSH切断・電源断

長いbuild/release処理はPi上のtmux、または承認済みのsystemdジョブとしてSSH接続から独立させる。
ジョブIDとsecret-free journalを保存し、再接続で状態が読めること。
ルート権限でソースをnpm buildする方式は不可。buildと特権switch helperは分離する。
更新の各段階は同一filesystemのjournalへatomic write＋必要なfsyncを行う。
再起動時は未確定transactionを検出し、最後のCOMMITTED releaseへ戻すrecoveryをWebより先に実行する。
これが未実装なら「電源断に自動復旧可能」と称さず、M4の未完了項目とする。
容量不足や壊れたSDからの完全回復は保証しない。手動復旧と別媒体backupを残す。

## 6. 権限

初期インストール/切替は限定的sudoを用いるが、`NOPASSWD: ALL`やWebからのsudoを設けない。
sudoが必要な手順はTTY付き手動確認から始める。自動化用helperを作るなら引数/許可pathを固定・検証する。
SSH鍵/Tailscale auth key/Google tokenをCIやアーカイブに入れない。
GitHub Actionsから自宅Piへ勝手に常駐runnerを置く方式は今回不要。

## 7. アプリ更新とOS更新の分離

apt更新、Node major更新、Chromium更新、Pi再起動は別メンテナンス作業。
アプリ更新コマンドに `apt full-upgrade` を含めない。
今回のリリース方式は短い表示/通信中断を許容し、無停止デプロイとは呼ばない。
