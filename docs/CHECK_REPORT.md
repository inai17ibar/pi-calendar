# 雛形検査レポート

検査日：2026-10-03。Linux x86_64の作業環境で実行。**Pi実機、Google認証、Tailscale接続、Next.jsアプリのテストではありません。**

結果：21/21項目が合格。

| 検査 | 結果 | 備考 |
|---|---|---|
| JSON parse | PASS | 8 files |
| Internal Markdown links | PASS | 18 links; missing=[] |
| Bash syntax: scripts/doctor.sh | PASS |  |
| Bash syntax: scripts/ssh-tunnel.sh | PASS |  |
| Bash syntax: ops/kiosk/kiosk-supervisor.sh | PASS |  |
| doctor read-only sandbox run | PASS | Linux/x86_64; not Raspberry Pi |
| SSH tunnel argument construction (stub) | PASS |  |
| SSH rejects ['-oBad'] | PASS |  |
| SSH rejects ['pi-calendar;touch BAD'] | PASS |  |
| SSH rejects ['pi-calendar', '0'] | PASS |  |
| SSH rejects ['pi-calendar', '65536'] | PASS |  |
| SSH rejects ['pi-calendar', '0080'] | PASS |  |
| Kiosk launcher + maintenance (stub) | PASS |  |
| Kiosk rejects no-GUI session (stub) | PASS |  |
| Kiosk rejects root (stub) | PASS |  |
| systemd syntax: pi-calendar-sync.service | PASS |  |
| systemd syntax: pi-calendar-web.service | PASS |  |
| Fixture timezone conversion | PASS | 2026-10-04T01:00:00+09:00 |
| Fixture DST day duration | PASS | 25.0 hours |
| Known credential-pattern scan | PASS | No matching real key/token forms; not a security guarantee |
| No app/lockfile falsely included | PASS |  |

## 未検証

アプリ本体、Google API/OAuth、Node24/Linux arm64でのbuild、実画面/タッチ、自動ログイン、systemd起動、デプロイ/rollback、電源断、長時間連続稼働。

SSH/browser/curlをstubへ差し替えたテストは実通信の検証ではありません。unitテンプレートはNodeパスを作業環境へ置換して構文を検証したのみで、インストールもサービス起動もしていません。

doctorは作業環境での実行を確認したのみ。ユーザーのPiの機種/RAM/OSを確認したという意味ではありません。

[機械可読の結果](check-results.json)
