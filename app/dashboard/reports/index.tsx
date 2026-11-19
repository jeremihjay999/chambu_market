'use client'

import Link from 'next/link'
import {
  CalendarClock,
  CalendarRange,
  FileText,
  ArrowRight,
} from 'lucide-react'
import { PermissionGuard } from '@/components/auth/permission-guard'

export default function ReportsIndexPage() {
  return (
    <PermissionGuard requiredPermission="pos.reports">
      <ReportsIndex />
    </PermissionGuard>
  )
}

function ReportsIndex() {
  return (
    <div className="p-4 space-y-4 max-w-xl">
      <div>
        <h1 className="text-xl font-bold">Reports</h1>
        <p className="text-xs text-muted-foreground">Choose a report type to view</p>
      </div>

      {/* Period Report */}
      <Link href="/dashboard/reports/period">
        <div className="border border-green-200 bg-green-50/50 hover:bg-green-50 hover:border-green-300 transition-colors cursor-pointer rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-green-100 p-2">
                <CalendarRange className="h-5 w-5 text-green-700" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-green-900">Financial Report</h3>
                <p className="text-xs text-green-700">
                  Sales, collections, expenses &amp; credit — any date range (defaults to this month)
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-green-600 flex-shrink-0" />
          </div>
        </div>
      </Link>

      {/* End-of-Day Report */}
      <Link href="/dashboard/reports/end-of-day">
        <div className="border border-blue-200 bg-blue-50/50 hover:bg-blue-50 hover:border-blue-300 transition-colors cursor-pointer rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-blue-100 p-2">
                <CalendarClock className="h-5 w-5 text-blue-700" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-blue-900">End-of-Day Report</h3>
                <p className="text-xs text-blue-700">
                  Full daily breakdown — payment methods, deposits, stock purchases &amp; pending expenses
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-blue-600 flex-shrink-0" />
          </div>
        </div>
      </Link>

      {/* Data Export Reports */}
      <Link href="/dashboard/reports/export">
        <div className="border border-gray-200 bg-gray-50/50 hover:bg-gray-50 hover:border-gray-300 transition-colors cursor-pointer rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-gray-100 p-2">
                <FileText className="h-5 w-5 text-gray-700" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Data Export</h3>
                <p className="text-xs text-gray-600">
                  Sales, inventory, profit, stock movements — download as JSON or CSV
                </p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-gray-500 flex-shrink-0" />
          </div>
        </div>
      </Link>
    </div>
  )
}
