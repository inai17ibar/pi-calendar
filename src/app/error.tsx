"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="setup-error"><h1>画面を再接続してください</h1><p>予定を変更する操作は行っていません。</p><button onClick={reset}>もう一度表示</button></main>; }
