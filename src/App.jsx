import React, { useState, useEffect, useCallback } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import Login from './components/Login'
import MainDashboard from './components/MainDashboard'
import OrderDetailsPage from './components/OrderDetailsPage'
import AppFooter from './components/AppFooter'
import { OrdersFooterProvider } from './context/OrdersFooterContext'
import { OrderNotificationsProvider } from './context/OrderNotificationsContext'
import OrderNotificationToasts from './components/OrderNotificationToasts'
import BrowserNotificationPrompt from './components/BrowserNotificationPrompt'
import './App.css'
import { createAIAssistantInitialState } from './utils/aiAssistantInitialState'

function DashboardLayout({ onLogout, aiAssistantState, onAIAssistantStateChange }) {
  return (
    <MainDashboard
      onLogout={onLogout}
      aiAssistantState={aiAssistantState}
      onAIAssistantStateChange={onAIAssistantStateChange}
    />
  )
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [aiAssistantState, setAIAssistantState] = useState(createAIAssistantInitialState)

  useEffect(() => {
    const token = localStorage.getItem('bevvi_token')
    if (token) {
      setIsAuthenticated(true)
    }
    setIsLoading(false)
  }, [])

  const handleLogin = (token) => {
    localStorage.setItem('bevvi_token', token)
    setIsAuthenticated(true)
  }

  const handleLogout = useCallback(() => {
    localStorage.removeItem('bevvi_token')
    setIsAuthenticated(false)
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bevvi-primary-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-bevvi-primary-600 mx-auto mb-4"></div>
          <p className="text-bevvi-primary-600">Loading...</p>
        </div>
      </div>
    )
  }

  const authDashboardLayout = isAuthenticated ? (
    <DashboardLayout
      onLogout={handleLogout}
      aiAssistantState={aiAssistantState}
      onAIAssistantStateChange={setAIAssistantState}
    />
  ) : (
    <Navigate to="/login" replace />
  )

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <OrdersFooterProvider>
      <OrderNotificationsProvider isAuthenticated={isAuthenticated}>
      <div className="App min-h-screen bevvi-page-bottom-padding">
        <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated ?
              <Navigate to="/orders" replace /> :
              <Login onLogin={handleLogin} />
            }
          />
          <Route
            path="/orders/:orderNumber"
            element={
              isAuthenticated ?
              <OrderDetailsPage /> :
              <Navigate to="/login" replace />
            }
          />
          <Route element={authDashboardLayout}>
            <Route path="/" element={<Navigate to="/orders" replace />} />
            <Route path="/dashboard" element={<Navigate to="/orders" replace />} />
            <Route path="/settings" element={<Navigate to="/orders" replace />} />
            <Route path="/orders" element={<Outlet />} />
            <Route path="/products" element={<Outlet />} />
            <Route path="/retailers" element={<Outlet />} />
            <Route path="/gopuff" element={<Outlet />} />
            <Route path="/manual-order" element={<Outlet />} />
            <Route path="/ai-assistant" element={<Outlet />} />
          </Route>
          <Route
            path="*"
            element={
              isAuthenticated ?
              <Navigate to="/orders" replace /> :
              <Navigate to="/login" replace />
            }
          />
        </Routes>
        <BrowserNotificationPrompt />
        <OrderNotificationToasts />
        <AppFooter />
      </div>
      </OrderNotificationsProvider>
      </OrdersFooterProvider>
    </Router>
  )
}

export default App
