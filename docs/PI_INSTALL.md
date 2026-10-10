# Pi本番インストール（M3：常駐・自動起動・全画面）

開発ディレクトリ（port 3100、`.local/dev`）とは別に、本番（port 3000、`/var/lib/pi-calendar`）を作ります。インストーラは既定で**dry run**（実行内容の表示のみ）です。

## 1. ビルド（通常ユーザー、sudoなし）

```bash
cd ~/src/pi-calendar
git status --untracked-files=all # 未commit・未追跡の変更があると --apply は拒否されます
npm ci && npm run check && npm run build
```

`next-env.d.ts`はGitで追跡します。型チェックやビルドで更新された場合は差分を確認してcommitし、適用前にワークツリーがクリーンであることを再確認してください。Gitで除外した`dist/`等の生成物は変更検出の対象外です。dry runは変更があっても警告を出して計画を表示します。

## 2. 本番インストール（sudo）

開発用Worker（`npm run worker`）と開発Webを先に止めてください。同じrefresh tokenを2つのWorkerが使うと、更新時に競合します。

```bash
sudo bash ops/install/install-production.sh --import-dev-state .local/dev          # 内容確認
sudo bash ops/install/install-production.sh --import-dev-state .local/dev --apply  # 実行
```

行うこと：公式Node（SHA256検証）を`/opt/pi-calendar/node-v24.21.0`へ、専用ユーザー`calendar-app`、`/opt/pi-calendar/releases/<id>`（root所有・読取専用）と`current`リンク、`/etc/pi-calendar/runtime.env`（既存なら維持）、client JSON/tokenのコピー（0600、値は表示しない）、`/usr/local/bin/pi-calendar`、systemd 2サービスの有効化と起動、`/api/health/ready`の確認。`--import-dev-state`を省いた場合は `sudo pi-calendar auth google` で本番用に認証します（Workerを一時停止して実行）。

## 3. 全画面表示（GUIユーザー、sudoなし）

```bash
bash ops/kiosk/install-kiosk.sh            # 内容確認
bash ops/kiosk/install-kiosk.sh --apply
~/.local/bin/pi-calendar-kiosk &           # 再ログインせず今すぐ起動する場合
```

`~/.config/labwc/autostart`に1行追加します（既存行は残し、バックアップを作成）。このPiのlabwcは`-m`（設定マージ）で起動しているため、システムのパネル等の自動起動は維持されます。Chromiumは専用プロファイル・`--kiosk`で起動し、終了しても自動で再起動します。sandbox/TLS検証は無効化しません。

## 運用

| 操作 | コマンド |
|---|---|
| 状態 | `systemctl status pi-calendar-web pi-calendar-sync` / `sudo pi-calendar status` |
| ログ | `journalctl -u pi-calendar-web -u pi-calendar-sync --since "30 min ago"` |
| 表示カレンダー | `sudo pi-calendar calendars list` / `sudo pi-calendar calendars select ...` |
| 再認証 | `sudo pi-calendar auth google`（Piのブラウザ、またはMacからSSH転送） |
| 全画面を止める | `touch ~/.config/pi-calendar/maintenance`（再開はファイル削除後に再ログイン） |
| kiosk解除 | `bash ops/kiosk/install-kiosk.sh --uninstall --apply` |

画面OFF（スクリーンブランキング）は、このPiでは現在無効です（user autostartにswayidleなし）。有効にした場合はraspi-config → Display → Screen Blankingで戻せます。

## まだないもの（M4）

自動更新（毎日3:00）、更新失敗時の自動rollback、電源断時のrelease journal復旧、画面の版変更reload。M3のインストーラを再実行すると新しいreleaseへ切り替わり、`previous`に直前版を残しますが、検証失敗時の自動切り戻しはまだありません。
