import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/ui/app-error-boundary'

// No <StrictMode>: its development-only double mount runs every effect twice,
// which opens two runtime WebSockets per project and trips the backend's
// single-session lock ("Owned by another browser") while doubling fetches.
createRoot(document.getElementById('root')!).render(<AppErrorBoundary><App /></AppErrorBoundary>)
