import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Polza — компании',
  description: 'База компаний (тестовое задание)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <header className="header">
          <div className="header-inner">
            <Link href="/companies" className="logo">
              Polza<span> Agency</span>
            </Link>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
