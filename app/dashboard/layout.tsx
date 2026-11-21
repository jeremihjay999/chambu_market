'use client'

import { ReactNode, useEffect, useState } from 'react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { TopNav } from '@/components/dashboard/top-nav'
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register'
import { BackupPermissionDialog } from '@/components/pwa/backup-permission-dialog'
import { ConflictNotification } from '@/components/pwa/conflict-notification'
import { InstallPrompt } from '@/components/pwa/install-prompt'
import { DemoBanner } from '@/components/demo/demo-banner'
import { NetworkStatusProvider } from '@/components/network-status-provider'
import { Toaster } from 'sonner'
import PaymentNotificationOverlay from '@/components/payment-notification-overlay'
import { SetupBranchModal } from '@/components/dashboard/setup-branch-modal'
import { initAutoSync } from '@/lib/sync'

const SIDEBAR_STORAGE_KEY = 'sidebar-collapsed'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const [paymentNotification, setPaymentNotification] = useState<{
    enabled: boolean
    paymentUrl: string
    message: string
    daysOverdue: number
  } | null>(null)
  const [loading, setLoading] = useState(true)

  // Branch setup gate — shown to owners who have no branch yet
  const [requiresBranchSetup, setRequiresBranchSetup] = useState(false)
  const [shopName, setShopName] = useState('')

  // Rehydrate from localStorage on mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY)
      if (stored !== null) setSidebarCollapsed(stored === 'true')
    } catch {}
  }, [])

  // Register the online / background-sync listeners once for the whole dashboard
  useEffect(() => { initAutoSync() }, [])

  function handleCollapsedChange(v: boolean) {
    setSidebarCollapsed(v)
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(v)) } catch {}
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/tenant/config').then(res => res.ok ? res.json() : null),
      fetch('/api/auth/me', { credentials: 'include' }).then(res => res.ok ? res.json() : null),
    ]).then(([configData, meData]) => {
      if (configData?.paymentNotification) setPaymentNotification(configData.paymentNotification)
      if (meData?.user?.requiresBranchSetup) {
        setRequiresBranchSetup(true)
        setShopName(meData.user.shopName || meData.user.name || '')
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const showOverlay = !loading && paymentNotification?.enabled && paymentNotification?.paymentUrl

  return (
    <NetworkStatusProvider>
      <div className="flex h-screen bg-background">
        <ServiceWorkerRegister />
        <BackupPermissionDialog />
        <ConflictNotification />
        <InstallPrompt />
        <Toaster position="top-right" />

        {/* One-time branch setup gate — shown until the owner creates their first branch */}
        {requiresBranchSetup && (
          <SetupBranchModal
            shopName={shopName}
            onComplete={() => setRequiresBranchSetup(false)}
          />
        )}

        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={handleCollapsedChange} />
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <DemoBanner />
          <TopNav />
          <main className="flex-1 overflow-auto">
            <div className="container mx-auto p-6">
              {children}
            </div>
          </main>
        </div>

        {showOverlay && (
          <PaymentNotificationOverlay
            paymentUrl={paymentNotification.paymentUrl}
            message={paymentNotification.message}
            daysOverdue={paymentNotification.daysOverdue}
          />
        )}
      </div>
    </NetworkStatusProvider>
  )
}
