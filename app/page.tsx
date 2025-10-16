'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // 添加延迟确保路由器准备就绪
    const timer = setTimeout(() => {
      router.replace('/plan');
    }, 100);
    
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
        <p>正在跳转到计划页面...</p>
        <div className="mt-4 text-sm text-gray-600">
          <p>如果没有自动跳转，请点击：</p>
          <a href="/plan" className="text-blue-600 hover:underline">进入计划页面</a>
        </div>
      </div>
    </div>
  );
}
