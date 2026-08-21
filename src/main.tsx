import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { BASE_PATH } from './lib/basePath.ts'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element not found')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={BASE_PATH || '/'}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
