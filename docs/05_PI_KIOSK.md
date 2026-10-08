# 05 Raspberry Pi 自動起動

## 前提確認

`bash scripts/doctor.sh` でOS/arch/RAM/Node/Chromiumの有無を確認。
デスクトップセッションはPi画面またはloginctlで確認。SSHの環境変数だけでは確定しない。
Nodeは24 LTS系の実際のpatchへ固定。OS/Node導入はユーザーの承認後。
GUIは既存のRaspberry Pi OS desktopを活用し、セットアップのためにディスクを初期化しない。

## 起動順序

```text
OS起動
 ├─ systemd: pi-calendar-web.service   → SQLite/設定を読めれば起動
 ├─ systemd: pi-calendar-sync.service  → ネットがなくても待機可能
 └─ GUI自動ログイン
      └─ labwc autostart
            └─ kiosk-supervisor.sh
                 ├─ ローカル /api/health/ready を待つ
                 └─ 専用profileでChromiumを全画面起動
```

ネット到達やGoogle認証をweb readinessの条件にしない。`network-online.target`待ちを起動の必須条件にしない。
ネットなしならキャッシュを表示し、Workerはbackoffで接続を待つ。
GUI自動ログインは設定画面/raspi-configでユーザーが許可して有効化する。[S11]

## 提供しているテンプレート

`ops/systemd/pi-calendar-web.service.in` と `pi-calendar-sync.service.in`。
`@NODE_BIN@` を実際のroot管理Node絶対パスへ置き換え、専用user/ディレクトリ作成後に使う。
`.in`をそのままsystemctl enableしない。実アプリのdistが揃ってから動作確認する。
自動再起動は異常終了に対応するもので、アプリの無限ループ/フリーズ検知とは別。[S12]

既存 `.config/labwc/autostart` をバックアップし、`ops/kiosk/labwc-autostart.fragment`の1行を追加する。
既存内容を上書きしない。スクリプトは `~/.local/bin/pi-calendar-kiosk` へコピーして実行権限を与える。
labwc以外なら勝手に同じ設定を置かず、OSに応じて起動経路を調整する。[S11]

`ops/kiosk/kiosk-supervisor.sh` は参考実装。rootでは実行しない。
rootサービスからDISPLAY=:0を決め打ちしてChromiumを起動しない。
Chromiumが終了したら再起動、二重起動をlockで防止、localhostが起動するまで待つ。
ログはjournaldまたは回転上限付きにし、ブラウザdebugログを無制限に保存しない。

## 保守モード

参考supervisorは次のファイルの存在で終了する。

```bash
# GUIログインユーザー自身として実行
mkdir -p ~/.config/pi-calendar
touch ~/.config/pi-calendar/maintenance
```

起動中の専用Chromiumにも終了を要求する。他のChromiumを一括killしない。
再開はmaintenanceを除去し、通常のGUIセッションでsupervisorを再実行するかログインし直す。
本番Web/Workerはこの操作では止めない。

## 常時点灯

Screen Blanking/スクリーンセーバー/省電力での画面OFFは現在のGUI設定に合わせて無効化する。[S11]
Waylandでxsetが必ず効くと仮定しない。DPMS/輝度制御はモニター対応を実機確認。
今回はモニターHDMI＋USBタッチが動作済み。起動後のタッチ座標/回転を確認する。
勝手に人感センサーやPWM配線を追加しない。

## 電源と終了

常時運用でも停止はOSシャットダウン後を基本にする。電源断耐性は完全には保証できない。
DBを保存するため、ルートFSを一括read-only overlayへ切り替えることはMVPに含めない。
バックアップ・安全なDB書込み・冷却を優先。電源復帰でモニターも自動点灯するか実機確認する。

## 実機チェック

ネットあり再起動/ネットなし再起動/ブラウザ終了/Web停止/Worker停止をそれぞれ試す。
初回起動、時計、月初、画面OFF、タッチ、ログ増加量を測る。
再起動試験は作業中のPiセッションを失うため、ユーザーの承認を得て実行する。
