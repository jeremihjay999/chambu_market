'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Building2 } from 'lucide-react'

interface Props {
  shopName: string
  onComplete: () => void  // kept for layout compatibility; not called after logout
}

export function SetupBranchModal({ shopName }: Props) {
  const [name, setName] = useState(shopName || '')
  const [code, setCode] = useState(() => deriveCode(shopName || ''))
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  function deriveCode(value: string) {
    return value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6) || 'MAIN'
  }

  function handleNameChange(value: string) {
    setName(value)
    setCode(deriveCode(value))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const trimmedName = name.trim()
    const trimmedCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')

    if (!trimmedName) { setError('Branch name is required'); return }
    if (!trimmedCode) { setError('Branch code is required'); return }

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: trimmedName, code: trimmedCode }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create branch')
        return
      }

      // Log out so the new session JWT includes the branch context.
      setDone(true)
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      window.location.href = '/auth/login'
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open modal>
      {/* No onOpenChange — modal is intentionally uncloseable until a branch exists */}
      <DialogContent
        className="sm:max-w-md"
        // Prevent closing via Escape or clicking the overlay
        onEscapeKeyDown={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="h-5 w-5 text-green-600" />
            <DialogTitle>Set up your first branch</DialogTitle>
          </div>
          <DialogDescription>
            Your account has no branches yet. Create one to start using the POS — you can add more later in Settings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label htmlFor="branch-name">Branch name</Label>
            <Input
              id="branch-name"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="e.g. Main Branch, Nairobi CBD"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="branch-code">
              Branch code
              <span className="ml-1 text-xs text-muted-foreground">(short, uppercase)</span>
            </Label>
            <Input
              id="branch-code"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="e.g. MAIN, NBI01"
              maxLength={6}
              required
            />
            <p className="text-xs text-muted-foreground">
              Up to 6 alphanumeric characters. Used on receipts and stock transfers.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={saving || done}>
            {done ? 'Redirecting…' : saving ? 'Creating…' : 'Create branch & log in'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
