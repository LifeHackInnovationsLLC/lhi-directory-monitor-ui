import React from 'react'
import ReactDOM from 'react-dom/client'
import { DirectoryMonitor } from './components/DirectoryMonitor'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="min-h-screen bg-background text-foreground p-6">
      <DirectoryMonitor />
    </div>
  </React.StrictMode>,
)
