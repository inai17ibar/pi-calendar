AGENTS.mdとdocs/05_PI_KIOSK.md、docs/06_REMOTE_DEVELOPMENT_DEPLOY.mdを読み、M3/M4を小さく分けて実装してください。
最初はdoctor結果をもとに実OS/Nodeパス/GUIを確認し、変更案を示してください。OS再導入は不要です。
Linux arm64 build、systemd、kiosk、source archive、別release staging、health、backup、rollback、version reloadを実装してください。
更新処理はWebから任意シェルを実行しないCLI方式。npm buildは非root・本番tokenに触れない環境で行ってください。
DB互換/途中SSH切断/二重実行/起動失敗/未確定journalをテストしてください。
実機のsudo/SSH/Tailscale/再起動の操作は承認を得るまで実行しないでください。
未実装の電源断recoveryがある場合はM4完了とせず明示してください。
