<div align="center">

# do-code

**オープンソースのコーディングエージェント。**

コードの読解、ファイル編集、コマンド実行、結果検証を、ターミナルとワークスペースで行えます。

[![CI](https://github.com/tree201/do-code/actions/workflows/ci.yml/badge.svg)](https://github.com/tree201/do-code/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Español](README.es-ES.md) | [Français](README.fr-FR.md)

[クイックスタート](#installation) · [ドキュメント](docs/README.md) · [貢献](CONTRIBUTING.md) · [セキュリティ](SECURITY.md)

</div>

<p align="center">
  <img src="assets/terminal-preview.png" alt="do-code のターミナルプレビュー" width="100%">
</p>

---

## インストール

Node.js `20.19+` または `22.12+` が必要です。

ソースから実行する場合：

```bash
git clone https://github.com/tree201/do-code.git
cd do-code
npm install
npm run build:agent
npm link
```

続いて、既存のプロジェクトで起動します：

```bash
cd /path/to/your-project
do-code auth
do-code
```

`do-code auth` がプロバイダーのセットアップを案内します。API キーはローカルユーザー設定にのみ保存され、環境変数は保存済みの値を上書きします。

> [!NOTE]
> npm パッケージは `npm install -g @tree201/do-code` でインストールしてください。初回は Git リポジトリ内で起動し、デフォルトの権限モードを使用してください。

## できること

- **実際のリポジトリで作業** — ファイルの読み取りと添付、コード編集、シェルコマンド実行、Git 差分の確認、テスト実行を行えます。
- **お使いのモデルプロバイダーを利用** — Volcengine Ark、Alibaba ModelStudio、DeepSeek、MiniMax、Z.AI、ModelScope の組み込みセットアップに対応。Custom Provider は OpenAI 互換、Anthropic、Gemini API をサポートします。
- **実行を管理可能に維持** — 計画モードと権限モードは独立しており、組み込みのファイル編集とパッチには確認や復旧のためのローカルチェックポイントが作成されます。

`/` でコマンドを参照し、`@` でワークスペースのファイルを添付します：

```text
/plan · /permissions · /model · /resume
/status · /stats · /compact · /diff
/memory · /rewind · /export · /language
@src/app.ts           現在のコンテキストにファイルを追加
!npm test             現在の権限モードでコマンドを実行
```

セッション中の推論は `/thinking` と `/effort` で調整できます。`--persist` を追加すると、今後のセッションのデフォルトとして保存されます。インターフェースは `--language` または `/language` により、英語、簡体字中国語、日本語、韓国語、スペイン語、フランス語に対応します。

## 好みの方法で実行

### 対話型ターミナル

```bash
do-code
do-code --continue
do-code resume <session-id>
```

### セッションとコンテキスト

`do-code --continue` で最新のプロジェクトセッションを続行するか、`resume` と `/resume` で選択できます：

```bash
do-code sessions list
do-code sessions search "authentication"
do-code sessions rename <session-id> "Auth cleanup"
do-code sessions delete <session-id>
do-code sessions export <session-id> md ./session.md
```

`/stats` でコンテキスト使用量を確認し、必要に応じて `/compact` で圧縮します。コンテキスト上限が近づくと、重要なパス、コマンド、決定、検証状態を保持したまま do-code が自動的に圧縮します。

### プロジェクト指示と分離

階層化された `AGENTS.md` 指示はワークスペース階層に従います。`/memory` で確認または再読み込みできます。`do-code --worktree` または `do-code --worktree=<name>` で分離された Git worktree を開始し、`do-code worktrees` で do-code の worktree を確認できます。

### プロファイルと拡張機能

エージェントプロファイルでは、モデル、承認モード、指示、ステップ制限、ツールの許可/拒否リストを選択できます。`do-code agents` で確認し、`do-code --agent <name>` で選択してください。Markdown コマンドとスキルは `/extensions` で参照できます。`do-code extensions` ではコマンド、スキル、設定済み MCP サーバーの概要を確認できます。

### スクリプトと CI

`run` は自動化のために安定した JSON または JSONL 出力を生成します。タスクは引数または `--task-file` から指定でき、`--max-steps` と `--timeout` は実行予算を設定します。`--artifact-dir` は固定された設定、イベントストリーム、結果、パッチ成果物を保存します。

```bash
do-code run --yes --output-format stream-json \
  --task-file task.txt --artifact-dir ./artifacts \
  --max-steps 40 --timeout 600
```

ACP 標準入出力プロトコルには `do-code acp` を使用します。サポートされる自動化契約については、[ヘッドレス / JSONL プロトコル](docs/headless-protocol.md) を参照してください。

### 画像入力

ヘッドレスモードでは、`--image` を繰り返して最大 4 枚の PNG、JPEG、GIF、WebP 画像を添付できます。選択したモデルは画像入力に対応している必要があります。

```bash
do-code run --image screenshots/bug.png --image screenshots/diagram.webp "Describe these images"
```

対話型 TUI では、`@path/to/image.png` を入力するか、`/paste-image` を使ってシステムクリップボードから画像をインポートします。保留中の添付を削除するには `/remove-image <index|name>` を使用してください。各画像は 10 MB、プロンプト合計は 20 MB に制限されます。インポートされたファイルは `~/.local/share/do-code/projects/<project-key>/sessions/<session-id>/attachments/` にコピーされます。保存されるメッセージには `attachments/image_xxx.png` のような相対参照のみが含まれ、Base64 データや元の絶対パスは含まれません。グローバルデータルートを上書きするには `DO_CODE_DATA_DIR` を設定してください。既存のプロジェクトローカル `.do-code` データは、次回プロジェクトにアクセスしたときにユーザー管理のプロジェクトディレクトリへ移行されます。

### 便利な CLI コマンド

```bash
do-code config show          # 有効なモデル設定を確認
do-code doctor               # モデル、ワークスペース、ローカルツールを確認
do-code sessions list        # プロジェクトセッションを一覧表示
do-code extensions           # コマンド、スキル、MCP 設定を確認
do-code agents               # エージェントプロファイルを一覧表示
do-code worktrees            # 分離された worktree を一覧表示
do-code errors list          # 最近のエラーレポートを一覧表示
```

## 安全性とデータ

デフォルトの **Ask** モードでは、高リスクの操作に確認を求めます。**Auto** は通常のワークスペース変更を自動で処理します。**Full Access** は信頼できるワークスペースまたは CI 専用です。

設定は `~/.config/do-code/` に保存され、プロジェクトセッション、添付、チェックポイント、エラーレポートは `~/.local/share/do-code/projects/<project-key>/` に保存されます。`DO_CODE_DATA_DIR` はデータルートを上書きします。認証情報とプロジェクトデータは、デフォルトでお使いのマシンにとどまります。

サンドボックス設定では、構成とホストの対応状況に応じて、ローカル実行、macOS Seatbelt、コンテナを使用できます。権限モードとサンドボックス設定は別々の制御です。

失敗を確認するには：

```bash
do-code errors list
do-code errors show <error-id>
```

## ドキュメント

- [ドキュメント索引](docs/README.md)
- [不具合ケースのフィードバックと診断](docs/bad-case-feedback.md)
- [ヘッドレス / JSONL プロトコル](docs/headless-protocol.md)
- [アーキテクチャ](docs/architecture.md)
- [ローカル開発](docs/local-development.md)
- [個人向けリリースプロセス](docs/releasing.md)

## 貢献

Issue とプルリクエストを歓迎します。変更を送信する前に、[貢献ガイド](CONTRIBUTING.md) と [セキュリティポリシー](SECURITY.md) をお読みください。

```bash
npm run verify:local
npm run build:agent
```

## ライセンス

[Apache-2.0](LICENSE)
