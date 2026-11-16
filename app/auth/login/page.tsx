'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { clearCachedProducts } from '@/lib/indexeddb'
import { LoginPanda, type PandaState } from '@/components/auth/login-panda'

export default function LoginPage() {
  const router = useRouter()

  const [loading, setLoading]           = useState(false)
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError]               = useState('')
  const [pandaState, setPandaState]     = useState<PandaState>('idle')

  /* ── panda state helpers ──────────────────────────────────────────── */
  function onEmailFocus()    { setPandaState('email') }
  function onEmailBlur()     { setPandaState(password ? 'password' : 'idle') }
  function onPasswordFocus() { setPandaState(showPassword ? 'peek' : 'password') }
  function onPasswordBlur()  { setPandaState('idle') }

  function toggleShowPassword() {
    const next = !showPassword
    setShowPassword(next)
    setPandaState(next ? 'peek' : 'password')
  }

  /* ── login ────────────────────────────────────────────────────────── */
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setPandaState('loading')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!response.ok) {
        const data = await response.json()

        const offlineOk = await tryOfflineLogin(email, password)
        if (offlineOk) {
          setPandaState('success')
          toast.success('Login successful (offline mode)')
          setTimeout(() => router.push('/dashboard'), 600)
          return
        }

        const msg = data.error || 'Login failed'
        setError(msg)
        setPandaState('error')
        toast.error(msg)
        setTimeout(() => setPandaState('idle'), 1200)
        return
      }

      sessionStorage.clear()
      await clearCachedProducts()

      const credentialHash = await hashPassword(password)
      localStorage.setItem('cachedCredentials', JSON.stringify({
        email,
        passwordHash: credentialHash,
        timestamp: Date.now(),
      }))

      setPandaState('success')
      toast.success('Welcome back!')
      setTimeout(() => router.push('/dashboard'), 600)
    } catch {
      const offlineOk = await tryOfflineLogin(email, password)
      if (offlineOk) {
        setPandaState('success')
        toast.success('Login successful (offline mode)')
        setTimeout(() => router.push('/dashboard'), 600)
        return
      }
      setError('Unable to connect. Check your internet connection.')
      setPandaState('error')
      toast.error('Connection error')
      setTimeout(() => setPandaState('idle'), 1200)
    } finally {
      setLoading(false)
    }
  }

  async function tryOfflineLogin(email: string, password: string): Promise<boolean> {
    try {
      const cached = localStorage.getItem('cachedCredentials')
      if (!cached) return false
      const { email: cachedEmail, passwordHash } = JSON.parse(cached)
      if (cachedEmail !== email) return false
      return (await hashPassword(password)) === passwordHash
    } catch {
      return false
    }
  }

  async function hashPassword(pw: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /* ── render ───────────────────────────────────────────────────────── */
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-16"
      style={{ background: 'linear-gradient(145deg, #f0fdf4 0%, #f8fafc 50%, #ecfdf5 100%)' }}
    >
      {/* Card wrapper — panda peeks over the top */}
      <div className="relative w-full max-w-sm">

        {/* Panda — absolutely placed above the card */}
        <LoginPanda state={pandaState} />

        {/* Card */}
        <div
          className="relative bg-white rounded-2xl px-8 pt-10 pb-8 shadow-xl"
          style={{ border: '1px solid #e5e7eb' }}
        >
          {/* Logo + title */}
          <div className="flex flex-col items-center mb-7">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center mb-3"
              style={{ background: '#0f172a' }}
            >
              <img src="/chambu-logo.svg" alt="Chambu Digital" className="w-7 h-7 object-contain" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Chambu Digital POS</h1>
            <p className="text-sm text-gray-500 mt-0.5">Sign in to continue</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onFocus={onEmailFocus}
                onBlur={onEmailBlur}
                disabled={loading}
                required
                className="w-full h-11 px-4 rounded-xl border border-gray-200 bg-gray-50 text-sm
                           placeholder:text-gray-400 text-gray-900
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent focus:bg-white
                           disabled:opacity-50 transition-all"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={onPasswordFocus}
                  onBlur={onPasswordBlur}
                  disabled={loading}
                  required
                  className="w-full h-11 px-4 pr-11 rounded-xl border border-gray-200 bg-gray-50 text-sm
                             placeholder:text-gray-400 text-gray-900
                             focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent focus:bg-white
                             disabled:opacity-50 transition-all"
                />
                <button
                  type="button"
                  onClick={toggleShowPassword}
                  disabled={loading}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400
                             hover:text-gray-600 transition-colors disabled:opacity-50"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                <span className="mt-0.5 shrink-0 w-4 h-4 rounded-full bg-red-100 flex items-center justify-center text-xs font-bold">!</span>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2
                         bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2
                         disabled:opacity-70 transition-colors duration-150"
            >
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Signing in…</>
                : <>Sign In <ArrowRight size={15} /></>
              }
            </button>
          </form>

          {/* Support */}
          <div className="mt-6 rounded-xl bg-gray-50 border border-gray-100 p-3.5 text-center space-y-1">
            <p className="text-xs font-medium text-gray-600">Need access or support?</p>
            <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
              <a href="tel:+254748069158" className="hover:text-emerald-600 transition-colors">
                📞 +254 748 069 158
              </a>
              <span className="text-gray-200">|</span>
              <a
                href="https://wa.me/254748069158"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-emerald-600 transition-colors"
              >
                💬 WhatsApp
              </a>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-gray-400">
            Powered by{' '}
            <a
              href="https://www.chambudigital.co.ke/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-emerald-600 hover:text-emerald-700"
            >
              Chambu Digital
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
