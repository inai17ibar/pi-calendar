# 最初の進め方

このフォルダ自体をリポジトリのルートにする。新しい空のフォルダに展開して使い、既存リポジトリを上書きしない。

## 1. Macで仕様をリポジトリ化

```bash
cd pi-calendar-starter
# まだGitリポジトリではない場合だけ実行
git init
git add .
git commit -m "docs: define Pi Calendar requirements and operations"
```

GitHubへのpushは任意。GitHubアカウントやSSH鍵はこの雛形には含まれない。
`.gitignore`を維持し、秘密情報を置いてから `git add .` しない。

## 2. 最初のエージェント依頼

リポジトリをClaude CodeまたはCodexで開き、[初回プロンプト](prompts/01_BOOTSTRAP.md)を渡す。
最初はM0＋M1（ダミーデータで日/月の画面）だけ実装する。Googleアカウントなしで着手できる。

## 3. Piの現状確認

LANまたは設定済みTailscaleでSSH接続し、Pi側にこのリポジトリを置いてから次を実行。

```bash
bash scripts/doctor.sh
```

スクリプトは読み取り専用。出力のユーザー名/ローカルパスは必要に応じて伏せて共有する。
OS再導入、SSH設定変更、パッケージ導入、再起動を勝手に実行させない。

## 4. 段階的に完成させる

| 順序 | 終了条件 |
|---|---|
| M0–M1 | Macでダミーの月表示・日表示、タッチ相当操作、テストが動く |
| M2 | Google読み取り同期＋SQLite。ネット断と認証切れでも画面が消えない |
| M3 | Piで電源投入→自動表示、ブラウザ終了→復帰を実測 |
| M4 | Mac→Pi/Pi内開発の更新とロールバックを故障注入で検証 |
| M5 | 24時間連続表示・日付跨ぎ・オフライン再起動・現物タッチを検証 |

## 完成後に実装されるコマンドのイメージ（現在は未実装）

```bash
npm run dev                       # Macのダミーモード、port 3100
npm run check                     # lint/type/unit/integration
npm run test:e2e                   # ブラウザテスト
npm run deploy -- --host pi-calendar --ref <full-commit-sha>
npm run rollback -- --host pi-calendar --previous
```

`pi-calendar` はSSHの別名の例。[SSH設定例](ops/ssh/config.example)を自分の環境に合わせる。
`--ref` は意図したコミットを指定し、作業ツリーの未コミット変更を本番へ流さない。
配布済みの補助スクリプトは次の通り。

```bash
# Piの本番画面をMacの127.0.0.1:3300から見る。SSH接続設定が必要。
bash scripts/ssh-tunnel.sh pi-calendar 3300 3000
```

## 変更したくなったら

技術変更は可能だが、まず要件への影響を記録する。
特に「双方向編集」「公開Web」「画面からアップデート」「複数Googleアカウント」はMVPとは別タスク。
この一式だけではPi上にソフトはインストールされない。
