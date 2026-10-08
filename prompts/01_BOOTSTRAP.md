このリポジトリのAGENTS.md、README.md、docs/01_REQUIREMENTS.md、docs/02_UI_SPEC.md、
docs/03_ARCHITECTURE.md、docs/08_IMPLEMENTATION_PLAN.mdを読んでください。

Raspberry Pi 5の12.3インチ1920×1280タッチ画面で常時表示するGoogle Calendar端末を作ります。
今回はM0とM1だけ実装してください。Google認証・OS設定・リモート更新にはまだ着手しないでください。

最初に計画を簡潔に示し、Node24 LTS系で使えるNext/React/TypeScriptの実際の依存版を確認・pinし、
package-lock.jsonを作成してください。既存のドキュメント/テンプレートは保持してください。
mock providerと注入可能Clockで、今日の一覧と月表示を実装してください。
終日、複数日、日付跨ぎ、海外timezone、長い件名、予定ゼロ、未取得、通信失敗を見分けられるようにしてください。

npm run devはport3100かつ開発用stateで起動し、Google資格情報なしで動くようにしてください。
lint/typecheck/unit/integration/Playwrightを作り、4つの指定viewportで画面を確認してください。
READMEとSTATUSを更新し、変更ファイル・実行結果・実スクリーンショット・未検証点を報告してください。

予定データ/SSH鍵/.env/tokenを私から受け取ろうとせず、合成fixtureを使ってください。
完了したらM1で止め、M2以降を勝手に進めないでください。
