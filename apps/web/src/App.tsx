import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { Layout } from './components/Layout'
import { ToastProvider } from './components/overlays'
import { LoadingBlock } from './components/ui'
import { ContractDetailPage } from './pages/ContractDetailPage'
import { ContractFormPage } from './pages/ContractFormPage'
import { ContractListPage } from './pages/ContractListPage'
import { SettingsPage } from './pages/SettingsPage'
import { LoginPage } from './pages/LoginPage'

function RequireAuth({ children }: { children: ReactNode }): ReactNode {
  const { user, restoring } = useAuth()
  const location = useLocation()

  if (restoring) return <LoadingBlock label="正在恢复登录状态…" />
  // 记住原本要去哪，登录后直接送回去，而不是一律回首页
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />

  return <Layout>{children}</Layout>
}

function AppRoutes(): ReactNode {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/contracts"
        element={
          <RequireAuth>
            <ContractListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/contracts/new"
        element={
          <RequireAuth>
            <ContractFormPage />
          </RequireAuth>
        }
      />
      <Route
        path="/contracts/:id"
        element={
          <RequireAuth>
            <ContractDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/contracts/:id/edit"
        element={
          <RequireAuth>
            <ContractFormPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/contracts" replace />} />
    </Routes>
  )
}

export function App(): ReactNode {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </AuthProvider>
  )
}
