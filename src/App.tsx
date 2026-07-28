import { Navigate, Route, Routes } from 'react-router-dom'
import CollagePage from './pages/CollagePage.tsx'
import { COLLAGE_ROUTE, collagePath } from './routes.ts'

// Each time window is its own URL at the root (`/1h`, `/24h`, …). The `:window`
// route renders the collage for that window; anything else — including the bare
// root — redirects to the default window. nginx and the Vite dev server both
// fall back to index.html, so these deep links resolve directly.
export default function App() {
  return (
    <Routes>
      <Route path={COLLAGE_ROUTE} element={<CollagePage />} />
      <Route path="*" element={<Navigate to={collagePath('24H')} replace />} />
    </Routes>
  )
}
