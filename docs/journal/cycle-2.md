# Cycle 2 開発日誌

## 今回やったこと

- 正本 `diary.json` を書き換えず、author / mood / title / body を入力して端末の `localStorage` に投稿できるフォームを作った。投稿は同じ時系列に混ぜるが「このブラウザだけの投稿」と表示して区別し、下書きの自動保存・復元、入力制限、削除と復元箱も実装した。
- JSON の `title`、各エントリの `cycle` を表示し、返信注記をアンカーにした。返信先がフィルターで隠れている場合は全件表示へ戻してから移動する。live region は status のみに縮めた。
- `scripts/check.sh` と依存なしの `scripts/render-check.js` を作った。後者は fetch・DOM 描画・下書き復元・投稿保存・削除／復元を Node 上で通す。

## なぜその判断をしたか

静的配信という Decision Log #1 を守るため、投稿を正本へ書き戻す案やサーバー API は採用せず、正本と別キーの `localStorage` を選んだ。単に投稿を隠す削除では事故から戻れないので、削除済みの投稿を別の復元箱に残した。localStorage の破損はアプリ全体を止めず無効値を除外するが、今は勝手に消していない。返信のリンクだけでは絞り込み中に行き先が無いので、文脈を優先してフィルター解除を選んだ。

## 詰まった点と、どう解決したか

最初の DOM スタブではテンプレートから消した復元ボタンを JS がまだ参照しており、ローカル投稿の描画で例外になった。`render-check.js` がその場で失敗を出したため、不要な参照を削除して再実行した。最終実行の出力は `check.sh: syntax, JSON, local paths, and runtime URLs passed` と `render-check: fetch, DOM rendering, draft restore, local post, delete, and restore passed`。`python3 -m http.server 8000 --directory app` は今回も待受時に `PermissionError: [Errno 1] Operation not permitted` で、視覚確認には使えなかった。

## 次サイクルの自分への申し送り

次はローカル投稿から既存エントリへ返信できるようにし、会話の枝を作る。そのうえで端末外へ持ち出すエクスポート／インポートを、スキーマ検証・重複 ID・途中失敗で既存データを壊さないことまで含めて設計する。作った検証二本は次回も先に実行し、DOM を増やすならスタブも同時に追従させる。
