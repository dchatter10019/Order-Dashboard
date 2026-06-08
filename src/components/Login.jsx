import React, { useState } from 'react'
import { Eye, EyeOff, Sparkles, Truck, BarChart3 } from 'lucide-react'
import Logo from './Logo'
import { BRAND } from '../constants/brand'

const Login = ({ onLogin }) => {
  const [showPassword, setShowPassword] = useState(false)
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  })
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    if (credentials.username === 'Bevvi_User' && credentials.password === 'Bevvi_123#') {
      setTimeout(() => {
        onLogin('bevvi_auth_token_' + Date.now())
        setIsLoading(false)
      }, 1000)
    } else {
      setError('Invalid credentials. Please use Bevvi_User / Bevvi_123#')
      setIsLoading(false)
    }
  }

  const handleInputChange = (e) => {
    setCredentials({
      ...credentials,
      [e.target.name]: e.target.value
    })
    if (error) setError('')
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="bevvi-gradient relative flex flex-col justify-between px-6 py-10 sm:px-10 lg:w-[44%] lg:min-h-screen lg:px-12 lg:py-14">
        <div>
          <Logo size="large" onDark />
          <p className="bevvi-tagline mt-8 text-3xl sm:text-4xl font-semibold leading-tight">
            {BRAND.tagline}
          </p>
          <p className="mt-4 max-w-md text-base text-white/80 leading-relaxed">
            {BRAND.platformSubtitle}
          </p>
        </div>

        <ul className="mt-10 space-y-4 lg:mt-0">
          {[
            { icon: Truck, text: 'Track orders seamlessly across retailers and fulfillment partners' },
            { icon: Sparkles, text: 'AI-powered insights for faster decisions' },
            { icon: BarChart3, text: 'Curated reporting for GMV, fees, and performance' }
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-white/85">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <Icon className="h-4 w-4" />
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ul>

      </div>

      {/* Sign-in panel */}
      <div className="flex flex-1 flex-col justify-center bg-bevvi-cream px-6 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8">
            <h1 className="font-display text-2xl font-semibold text-bevvi-900 sm:text-3xl">
              Sign in
            </h1>
            <p className="mt-2 text-bevvi-dark-600">
              Access the {BRAND.platformTitle} to manage orders, products, and partners.
            </p>
          </div>

          <div className="card !p-6 sm:!p-8">
            <form className="space-y-5" onSubmit={handleSubmit}>
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="username" className="bevvi-label">Username</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  className="input-field"
                  placeholder="Enter your username"
                  value={credentials.username}
                  onChange={handleInputChange}
                />
              </div>

              <div>
                <label htmlFor="password" className="bevvi-label">Password</label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="input-field pr-10"
                    placeholder="Enter your password"
                    value={credentials.password}
                    onChange={handleInputChange}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex items-center pr-3"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5 text-bevvi-dark-400" />
                    ) : (
                      <Eye className="h-5 w-5 text-bevvi-dark-400" />
                    )}
                  </button>
                </div>
              </div>

              <div className="bevvi-callout">
                <p className="font-medium text-bevvi-900">Demo credentials</p>
                <p className="mt-1 text-bevvi-dark-600">
                  Username: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">Bevvi_User</code>
                  <br />
                  Password: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">Bevvi_123#</code>
                </p>
              </div>

              <button type="submit" disabled={isLoading} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center">
                {isLoading ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}

export default Login
