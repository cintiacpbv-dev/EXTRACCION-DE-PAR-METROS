import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/tema.js'
import App from './App.jsx'
import Puerta from './components/Puerta.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Puerta>
      <App />
    </Puerta>
  </StrictMode>,
)
