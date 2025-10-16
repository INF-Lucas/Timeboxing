import AppLayout from './components/AppLayout';
import Link from 'next/link';

export default function Home() {
  return (
    <AppLayout>
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8">
          <h1 className="text-4xl font-bold mb-4 text-gray-900">欢迎使用时间盒</h1>
          <p className="text-gray-600 mb-8 text-lg">高效的时间管理应用</p>
          <div className="space-y-4">
            <div>
              <Link 
                href="/plan" 
                className="inline-block bg-blue-600 text-white px-8 py-3 rounded-full hover:bg-blue-700 transition-colors text-lg font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                开始计划
              </Link>
            </div>
            <div>
              <Link 
                href="/focus" 
                className="inline-block bg-green-600 text-white px-8 py-3 rounded-full hover:bg-green-700 transition-colors text-lg font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                专注模式
              </Link>
            </div>
            <div>
              <Link 
                href="/review" 
                className="inline-block bg-purple-600 text-white px-8 py-3 rounded-full hover:bg-purple-700 transition-colors text-lg font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                回顾总结
              </Link>
            </div>
            <div>
              <Link 
                href="/settings" 
                className="inline-block bg-gray-600 text-white px-8 py-3 rounded-full hover:bg-gray-700 transition-colors text-lg font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                设置
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
