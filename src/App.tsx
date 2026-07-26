import { Navigate, Route, Routes } from 'react-router-dom'
import { presetToPath } from './domain/window.ts'
import CollagePage from './pages/CollagePage.tsx'

// Each time window is its own URL (`/1h`, `/12h`, `/24h`, `/7d`, `/all`). The
// `:window` route renders the collage for that window; anything else — the bare
// root or an unknown path — redirects to the default window. nginx and the Vite
// dev server both fall back to index.html, so these deep links resolve directly.
export default function App() {
  return (
    <Routes>
      <Route path="/:window" element={<CollagePage />} />
      <Route path="*" element={<Navigate to={presetToPath('24H')} replace />} />
    </Routes>
  )
}
