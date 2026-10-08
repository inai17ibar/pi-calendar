# 07 セキュリティ・運用

## 保護対象と境界

Google予定、OAuth token、設定、SSH/Tailscale認証を保護する。
本機は本人が管理する家庭内機器。OSログイン/ローカル物理アクセスを持つ人から完全に隠す仕組みではない。
画面を見える場所へ置く以上、予定が周囲から見える点も認識する。
任意のWebサイトやカレンダーdescriptionは未信頼であり、コード/シェルとして実行しない。

## 具体策

Web/APIはloopbackのみ。ネット公開、CORS *、--no-sandbox、TLS無検証は使わない。
Host allowlistでDNS rebinding対策、状態変更はOrigin検証＋JSON限定＋適切なCSRF対策。
CSPは本番でself中心、不要な外部リンク/HTMLを除去。開発HMR用の設定と本番を分ける。
全イベント文字列をescape。GoogleのエラーやURLにtokenが含まれる可能性を考慮しredactする。
secretは0600、directory0700。読み取り専用Google scopeは漏洩対策の代替にならない。
SDカード単体盗難に対する暗号化はMVPに含まない。file permissionは暗号化ではない。
秘密鍵を同じディスクに置いただけの暗号化で盗難保護が完成したと言わない。

## ログ

時刻・イベント件数・内部分類エラー・処理時間・release IDは記録可。
件名、説明、場所、メール、access/refresh token、OAuth code/state、秘密を含むURLは記録しない。
journald利用、保存上限/期間を実機で設定。Workerの成功ログを毎秒出さない。
診断共有はredacted出力のみ。Google/SSHの認証ファイルをAIに読ませない。

## バックアップ

DBのSQLite backup APIによる整合したsnapshot、非秘密設定、必要ならsecretsを別の暗号化保管先へ。
同じSDのbackupは更新失敗への対策であり、SD故障への対策にはならない。
backupは初期7世代を目安とし、容量を監視。公開repo/配布ZIPに含めない。
復元前に現在のstateを退避し、service停止、schema互換確認、復元、権限修正、再起動確認。
OAuthだけ失効した場合にDB全体を消さない。

## 典型的な障害

| 症状 | 最初の確認 | してはいけないこと |
|---|---|---|
| 画面が真っ黒 | 画面電源/HDMI、GUI、kiosk、ローカルhealthの順 | すぐOS再インストール |
| キャッシュは出るが同期しない | status/auth状態、ネット、時計、Worker | DB削除、tokenをチャットへ貼る |
| 7日程度で認証が切れる | OAuth Testing等の設定 | 永久tokenと決めつける |
| 更新で旧版に戻った | release journal、health、schema | currentでgit pullして再試行 |
| Tailscaleで接続できない | tailnetログイン/ACL/SSH状態 | ルーターの22番を公衆公開 |
| タッチしない | USB dataケーブル/給電/入力認識 | 初期にrootドライバーを大量導入 |
| SQLite locked | 二重Worker、短いtransaction、busy timeout | WALを手で削除 |

## 秘密操作はユーザーが行う

Google認証、Tailscale加入、SSH鍵配布はユーザー操作。
AIエージェントには画面/コマンドの案内と構成レビューを任せ、秘密値を渡さない。
```
journalctl -u pi-calendar-web -u pi-calendar-sync --since "30 minutes ago"
systemctl status pi-calendar-web pi-calendar-sync
curl --fail http://127.0.0.1:3000/api/health/ready
```

上記はM3インストール後の例。health結果に予定を含めない。
