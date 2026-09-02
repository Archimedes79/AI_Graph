import React from 'react'
import ReactDOM from 'react-dom/client'
import RuntimeApp from './RuntimeApp.tsx'
import '../index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RuntimeApp />
  </React.StrictMode>,
)
