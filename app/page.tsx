import AppLayout from './components/AppLayout';

export default function Home() {
  return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">欢迎使用时间盒</h1>
          <p className="text-gray-600 mb-8">高效的时间管理应用</p>
          <div className="space-x-4">
            <a 
              href="/plan" 
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
            >
              开始计划
            </a>
            <a 
              href="/focus" 
              className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
            >
              专注模式
            </a>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
