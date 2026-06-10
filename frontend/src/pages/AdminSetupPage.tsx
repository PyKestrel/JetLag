import { useState } from 'react'
import { Plane, Lock, User as UserIcon, AlertCircle, ShieldCheck } from 'lucide-react'
import { setupAdmin, setToken } from '@/lib/api'

interface AdminSetupPageProps {
  onComplete: () => void
}

export default function AdminSetupPage({ onComplete }: AdminSetupPageProps) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const res = await setupAdmin(username.trim(), password)
      setToken(res.access_token)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create admin account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center mb-3">
            <Plane className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Welcome to JetLag</h1>
          <p className="text-sm text-muted-foreground">Create an administrator account to continue</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6 shadow-sm">
          <div className="mb-4 flex items-start gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm text-foreground">
            <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
            <span>This account will be used to sign in to the admin console.</span>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Username</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="admin"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="At least 6 characters"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Confirm password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Re-enter password"
                  required
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating account…' : 'Create admin & continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
