import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme'
import './index.css'
import { ShareApp } from './share/share-app'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShareApp />
  </StrictMode>,
)
