import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Pi Calendar', description: '卓上カレンダー · 合成データのデモ' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="ja"><body>{children}</body></html>; }
