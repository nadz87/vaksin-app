import type { ReactNode } from 'react'
import { createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router'
import { apiReady } from './lib/api'
import { useAuth } from './lib/auth'
import { useI18n } from './lib/i18n'
import { Centered, Loading, Shell } from './components/Layout'
import { RequireParentProfile } from './components/CompleteProfile'
import { AddChild, CancelAppointments, JoinSchool, ParentHome, ParentProfile, SchoolLanding, Welcome } from './pages/parent'
import { AdminSchools, OfficerHome, StaffGate } from './pages/officer'
import { BookFlow } from './pages/book'
import { StudentProfile } from './pages/officer-students'
import { ChildEdit } from './pages/child'

// Hash routes (/#/book) because GitHub Pages cannot rewrite URLs to index.html.
const router = createHashRouter([
  {
    element: <Shell><Outlet /></Shell>,
    children: [
      { path: '/', element: <Home /> },
      { path: '/s/:slug', element: <SchoolLanding /> },
      { path: '/join', element: <SignedIn><JoinSchool /></SignedIn> },
      { path: '/children/new', element: <SignedIn><AddChild /></SignedIn> },
      { path: '/children/:id', element: <SignedIn><ChildEdit /></SignedIn> },
      { path: '/book', element: <SignedIn><BookFlow /></SignedIn> },
      { path: '/profile', element: <SignedIn><ParentProfile /></SignedIn> },
      { path: '/cancel', element: <SignedIn><CancelAppointments /></SignedIn> },
    ],
  },
  {
    element: <Shell wide><Outlet /></Shell>,
    children: [
      { path: '/officer', element: <StaffGate allow={['officer']}><OfficerHome /></StaffGate> },
      { path: '/officer/student/:id', element: <StaffGate allow={['officer']}><StudentProfile /></StaffGate> },
      { path: '/admin', element: <StaffGate allow={['platform_admin']}><AdminSchools /></StaffGate> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  if (!apiReady) return <SetupPending />
  return <RouterProvider router={router} />
}

function Home() {
  const { loading, session, profile } = useAuth()
  if (loading) return <Loading />
  if (!session) return <Welcome />
  if (profile?.role === 'officer') return <Navigate to="/officer" replace />
  if (profile?.role === 'platform_admin') return <Navigate to="/admin" replace />
  return (
    <RequireParentProfile>
      <ParentHome />
    </RequireParentProfile>
  )
}

function SignedIn({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth()
  if (loading) return <Loading />
  if (!session) return <Navigate to="/" replace />
  return <RequireParentProfile>{children}</RequireParentProfile>
}

function SetupPending() {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-md px-4 pt-16">
      <Centered>
        <h1 className="text-xl font-bold">{t('setup.title')}</h1>
        <p className="text-muted">{t('setup.body')}</p>
      </Centered>
    </div>
  )
}
