import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import HomePage from '@/features/home/HomePage'
import { Toaster } from '@/components/ui'

// Heavy routes are code-split so the home page loads fast (Mediabunny is big).
const QuickEditorPage = lazy(() => import('@/features/quick-editor/QuickEditorPage'))
const QuickToolPage = lazy(() => import('@/features/quick-editor/QuickToolPage'))
const AdvancedEditorPage = lazy(() => import('@/features/advanced-editor/AdvancedEditorPage'))

function Loading() {
  return <div className="grid h-full place-items-center text-sm text-muted">Loading…</div>
}

function NotFound() {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <p className="text-lg font-semibold">Page not found</p>
        <Link to="/" className="mt-2 inline-block text-accent underline">
          Back to home
        </Link>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/quick" element={<QuickEditorPage />} />
          <Route path="/quick/:tool" element={<QuickToolPage />} />
          <Route path="/editor/:id" element={<AdvancedEditorPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  )
}
