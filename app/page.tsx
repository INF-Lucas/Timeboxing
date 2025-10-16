export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center p-8">
        <h1 className="text-4xl font-bold mb-4 text-gray-900">欢迎使用时间盒</h1>
        <p className="text-gray-600 mb-8 text-lg">高效的时间管理应用</p>
        <div className="space-y-4">
          <div>
            <a 
              href="/plan" 
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors text-lg font-medium"
            >
              开始计划
            </a>
          </div>
          <div>
            <a 
              href="/focus" 
              className="inline-block bg-green-600 text-white px-8 py-3 rounded-lg hover:bg-green-700 transition-colors text-lg font-medium"
            >
              专注模式
            </a>
          </div>
          <div>
            <a 
              href="/review" 
              className="inline-block bg-purple-600 text-white px-8 py-3 rounded-lg hover:bg-purple-700 transition-colors text-lg font-medium"
            >
              回顾总结
            </a>
          </div>
          <div>
            <a 
              href="/settings" 
              className="inline-block bg-gray-600 text-white px-8 py-3 rounded-lg hover:bg-gray-700 transition-colors text-lg font-medium"
            >
              设置
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
