'use client';

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DateProvider, useDate } from './components/DateProvider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

function TopBar() {
  const { selectedDate, setDate, goToToday, formatForInput } = useDate();

  return (
    <header className="col-span-2 flex items-center justify-between px-4 py-2 border-b bg-white/90 backdrop-blur-sm border-white/20">
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-700">日期：</label>
        <input
          type="date"
          className="border rounded-full px-3 py-1.5 text-sm bg-white/80 border-slate-200/60"
          value={formatForInput(selectedDate)}
          min="2000-01-01"
          max="2099-12-31"
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const d = new Date(`${v}T00:00:00`);
            const min = new Date('2000-01-01T00:00:00');
            const max = new Date('2099-12-31T00:00:00');
            if (d < min || d > max) {
              alert('可选日期范围：2000-01-01 至 2099-12-31');
              return;
            }
            setDate(d);
          }}
        />
        <button
          className="ml-2 px-3 py-1.5 text-sm rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-200"
          onClick={goToToday}
        >
          今天
        </button>
      </div>
      <div className="text-2xl font-black bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
        时间盒 TIMEBOXING
      </div>
    </header>
  );
}

function SideNav() {
  const pathname = usePathname();
  const links = [
    { href: '/plan', label: 'Plan 计划' },
    { href: '/focus', label: 'Focus 执行' },
    { href: '/review', label: 'Review 复盘' },
    { href: '/settings', label: 'Settings 设置' },
  ];
  return (
    <aside className="border-r bg-white/80 backdrop-blur-sm border-white/20 flex flex-col">
      <nav className="flex flex-col p-3 gap-1 flex-1">
        {links.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={
                'px-3 py-2 rounded-full text-base font-semibold transition-colors duration-200 ' +
                (active ? 'bg-blue-500/20 text-blue-700 backdrop-blur-sm' : 'hover:bg-white/60 text-slate-700')
              }
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      
      {/* 版权信息 */}
      <div className="p-3 border-t border-white/20">
        <div className="text-[10px] font-bold text-black/30 text-center whitespace-nowrap">
          时间盒 TIMEBOXING v1.0 © 2025 版权所有
        </div>
      </div>
    </aside>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // 如果是首页，不显示导航布局
  if (pathname === '/') {
    return <>{children}</>;
  }

  return (
    <DateProvider>
      <div className="h-screen grid grid-rows-[auto_1fr] grid-cols-[16rem_1fr] overflow-hidden">
        <TopBar />
        <SideNav />
        <main className="capsule-ui bg-white/95 backdrop-blur-sm p-4 overflow-hidden min-h-0 m-4 rounded-3xl shadow-2xl border border-white/20">{children}</main>
      </div>
    </DateProvider>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh">
      <head>
        <title>时间盒 TIMEBOXING</title>
        <meta name="description" content="高效的时间管理应用" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
