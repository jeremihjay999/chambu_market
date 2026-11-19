'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Cluster {
  _id: string
  name: string
  uri1: string
  uri2: string
  maxTenants: number
  tenantCount: number
  isActive: boolean
  createdAt: string
}

interface Member {
  _id: string
  subdomain: string
  shopName: string
  isActive: boolean
  createdAt: string
}

interface ClusterDetail {
  cluster: Cluster
  members: Member[]
}

export default function ClustersPage() {
  const router = useRouter()
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [loading, setLoading] = useState(true)

  // Add-cluster form
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [uri1, setUri1] = useState('')
  const [uri2, setUri2] = useState('')
  const [maxTenants, setMaxTenants] = useState(5)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Expanded row state
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<ClusterDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [uri1Visible, setUri1Visible] = useState(false)
  const [uri2Visible, setUri2Visible] = useState(false)

  // URI editing state
  const [editingUris, setEditingUris] = useState(false)
  const [editUri1, setEditUri1] = useState('')
  const [editUri2, setEditUri2] = useState('')
  const [savingUris, setSavingUris] = useState(false)
  const [uriSaveError, setUriSaveError] = useState('')

  // Add-member panel
  const [showAddMember, setShowAddMember] = useState(false)
  const [allTenants, setAllTenants] = useState<Member[]>([])
  const [memberSearch, setMemberSearch] = useState('')
  const [addingMember, setAddingMember] = useState<string | null>(null)
  const [removingMember, setRemovingMember] = useState<string | null>(null)
  const [memberError, setMemberError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const res = await fetch('/api/admin/clusters')
    if (res.status === 401) { router.push('/admin/login'); return }
    const data = await res.json()
    setClusters(data.clusters || [])
    setLoading(false)
  }

  async function loadDetail(clusterId: string) {
    setDetailLoading(true)
    setUri1Visible(false)
    setUri2Visible(false)
    setShowAddMember(false)
    setMemberError('')
    setEditingUris(false)
    setUriSaveError('')
    const res = await fetch(`/api/admin/clusters/${clusterId}`)
    if (res.ok) {
      const data = await res.json()
      setDetail(data)
    }
    setDetailLoading(false)
  }

  async function loadAllTenants() {
    const res = await fetch('/api/admin/tenants')
    if (res.ok) {
      const data = await res.json()
      setAllTenants(data.tenants || [])
    }
  }

  function toggleExpand(clusterId: string) {
    if (expanded === clusterId) {
      setExpanded(null)
      setDetail(null)
    } else {
      setExpanded(clusterId)
      loadDetail(clusterId)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const res = await fetch('/api/admin/clusters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, uri1, uri2, maxTenants }),
    })
    if (res.ok) {
      setName(''); setUri1(''); setUri2(''); setMaxTenants(5); setShowForm(false)
      load()
    } else {
      const d = await res.json()
      setFormError(d.error || 'Failed to add cluster')
    }
    setSaving(false)
  }

  async function saveUris() {
    if (!expanded) return
    if (editUri1 && editUri2 && editUri1.trim() === editUri2.trim()) {
      setUriSaveError('URI 1 and URI 2 must be different')
      return
    }
    setSavingUris(true)
    setUriSaveError('')
    const res = await fetch(`/api/admin/clusters/${expanded}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri1: editUri1.trim(), uri2: editUri2.trim() }),
    })
    if (res.ok) {
      setEditingUris(false)
      await Promise.all([load(), loadDetail(expanded)])
    } else {
      const d = await res.json()
      setUriSaveError(d.error || 'Failed to save URIs')
    }
    setSavingUris(false)
  }

  async function toggleActive(id: string, current: boolean) {
    await fetch(`/api/admin/clusters/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !current }),
    })
    load()
    if (expanded === id) loadDetail(id)
  }

  async function handleAddMember(tenantId: string) {
    if (!expanded) return
    setAddingMember(tenantId)
    setMemberError('')
    const res = await fetch(`/api/admin/clusters/${expanded}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    })
    if (res.ok) {
      setShowAddMember(false)
      setMemberSearch('')
      await Promise.all([load(), loadDetail(expanded)])
    } else {
      const d = await res.json()
      setMemberError(d.error || 'Failed to add member')
    }
    setAddingMember(null)
  }

  async function handleRemoveMember(tenantId: string) {
    if (!expanded) return
    if (!confirm('Remove this tenant from the cluster? The tenant will not be deleted.')) return
    setRemovingMember(tenantId)
    setMemberError('')
    const res = await fetch(`/api/admin/clusters/${expanded}/members/${tenantId}`, { method: 'DELETE' })
    if (res.ok) {
      await Promise.all([load(), loadDetail(expanded)])
    } else {
      const d = await res.json()
      setMemberError(d.error || 'Failed to remove member')
    }
    setRemovingMember(null)
  }

  const memberIds = new Set((detail?.members || []).map(m => m._id))
  const availableTenants = allTenants.filter(t => {
    if (memberIds.has(t._id)) return false
    if (!memberSearch.trim()) return true
    const q = memberSearch.toLowerCase()
    return t.subdomain.toLowerCase().includes(q) || t.shopName?.toLowerCase().includes(q)
  })

  function UriRow({ label, uri, visible, onToggle }: {
    label: string
    uri: string
    visible: boolean
    onToggle: () => void
  }) {
    if (!uri) return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400 w-14">{label}</span>
        <span className="text-xs text-gray-300 italic">Not configured</span>
      </div>
    )
    return (
      <div className="flex items-start gap-2">
        <span className="text-xs font-semibold text-gray-500 w-14 shrink-0 mt-2">{label}</span>
        <code className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-xs font-mono text-gray-700 break-all">
          {visible ? uri : '•'.repeat(Math.min(uri.length, 60))}
        </code>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onToggle}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium border border-blue-200 rounded px-2 py-1 bg-white"
          >
            {visible ? 'Hide' : 'Reveal'}
          </button>
          {visible && (
            <button
              onClick={() => navigator.clipboard.writeText(uri)}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1 bg-white"
            >
              Copy
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Clusters</h1>
        <button
          onClick={() => setShowForm(v => !v)}
          className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + Add Cluster
        </button>
      </div>

      {/* Add cluster form */}
      {showForm && (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4 mb-6">
          <h3 className="font-semibold text-gray-900">New Cluster</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                value={name} onChange={e => setName(e.target.value)} placeholder="Cluster A"
                required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Tenants</label>
              <input
                type="number" value={maxTenants} onChange={e => setMaxTenants(Number(e.target.value))}
                min={1} max={100} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URI 1 <span className="text-red-500">*</span></label>
            <input
              value={uri1} onChange={e => setUri1(e.target.value)} type="password"
              placeholder="mongodb+srv://... or mongodb://..."
              required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URI 2 <span className="text-gray-400 text-xs font-normal">(fallback, optional)</span></label>
            <input
              value={uri2} onChange={e => setUri2(e.target.value)} type="password"
              placeholder="mongodb+srv://... or mongodb://..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-400 mt-1">Database name is appended automatically per tenant.</p>
          </div>
          {formError && <p className="text-sm text-red-500">{formError}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={saving}
              className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Cluster'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Cluster list */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : clusters.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="mb-2">No clusters yet.</p>
          <p className="text-sm">Add a cluster to start onboarding tenants.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          {clusters.map(c => {
            const full = c.tenantCount >= c.maxTenants
            const pct  = Math.min(100, Math.round((c.tenantCount / c.maxTenants) * 100))
            const isExpanded = expanded === c._id

            return (
              <div key={c._id}>
                {/* Cluster row */}
                <div
                  className="grid grid-cols-[1fr_200px_120px] items-center px-4 py-3 hover:bg-gray-50 cursor-pointer select-none"
                  onClick={() => toggleExpand(c._id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`transition-transform text-gray-400 text-xs ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    <span className="font-medium text-gray-800">{c.name}</span>
                    <div className="flex gap-1 ml-1">
                      {c.uri1 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">URI 1</span>}
                      {c.uri2 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">URI 2</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${full ? 'bg-red-400' : pct > 60 ? 'bg-yellow-400' : 'bg-green-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`text-xs font-medium ${full ? 'text-red-600' : 'text-gray-600'}`}>
                      {c.tenantCount}/{c.maxTenants}{full ? ' — Full' : ''}
                    </span>
                  </div>

                  <div className="text-right" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => toggleActive(c._id, c.isActive)}
                      className={`text-xs font-medium px-2 py-1 rounded-full ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {c.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-6 py-5 space-y-5" onClick={e => e.stopPropagation()}>
                    {detailLoading ? (
                      <p className="text-sm text-gray-500">Loading…</p>
                    ) : detail && (
                      <>
                        {/* Connection URIs */}
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Connection URIs</p>
                            {!editingUris && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditUri1(detail.cluster.uri1 || '')
                                  setEditUri2(detail.cluster.uri2 || '')
                                  setUriSaveError('')
                                  setEditingUris(true)
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 font-medium border border-blue-200 rounded px-2 py-1 bg-white"
                              >
                                Edit URIs
                              </button>
                            )}
                          </div>

                          {editingUris ? (
                            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">URI 1 <span className="text-red-500">*</span></label>
                                <input
                                  type="text"
                                  value={editUri1}
                                  onChange={e => setEditUri1(e.target.value)}
                                  placeholder="mongodb+srv://... or mongodb://..."
                                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">URI 2 <span className="text-gray-400 font-normal">(fallback, optional)</span></label>
                                <input
                                  type="text"
                                  value={editUri2}
                                  onChange={e => setEditUri2(e.target.value)}
                                  placeholder="mongodb+srv://... or mongodb://..."
                                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono"
                                />
                              </div>
                              {uriSaveError && <p className="text-xs text-red-500">{uriSaveError}</p>}
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); saveUris() }}
                                  disabled={savingUris || !editUri1.trim()}
                                  className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded px-3 py-1.5 disabled:opacity-50"
                                >
                                  {savingUris ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setEditingUris(false); setUriSaveError('') }}
                                  className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <UriRow
                                label="URI 1"
                                uri={detail.cluster.uri1}
                                visible={uri1Visible}
                                onToggle={() => setUri1Visible(v => !v)}
                              />
                              <UriRow
                                label="URI 2"
                                uri={detail.cluster.uri2}
                                visible={uri2Visible}
                                onToggle={() => setUri2Visible(v => !v)}
                              />
                            </div>
                          )}
                        </div>

                        {/* Members */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                              Members ({detail.members.length})
                            </p>
                            <button
                              onClick={() => {
                                setShowAddMember(v => !v)
                                setMemberSearch('')
                                setMemberError('')
                                if (!showAddMember) loadAllTenants()
                              }}
                              className="text-xs text-green-600 hover:text-green-700 font-medium border border-green-200 rounded px-2 py-1 bg-white"
                            >
                              + Add member
                            </button>
                          </div>

                          {memberError && <p className="text-xs text-red-500 mb-2">{memberError}</p>}

                          {detail.members.length === 0 ? (
                            <p className="text-sm text-gray-400 py-2">No tenants assigned to this cluster yet.</p>
                          ) : (
                            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-50 border-b border-gray-100">
                                  <tr>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Subdomain</th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Shop name</th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Status</th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Added</th>
                                    <th className="px-3 py-2" />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {detail.members.map(m => (
                                    <tr key={m._id} className="hover:bg-gray-50">
                                      <td className="px-3 py-2 font-mono text-green-700 text-xs">{m.subdomain}</td>
                                      <td className="px-3 py-2 text-gray-700">{m.shopName || '—'}</td>
                                      <td className="px-3 py-2">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                          {m.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-gray-400 text-xs">
                                        {new Date(m.createdAt).toLocaleDateString()}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        <button
                                          onClick={() => handleRemoveMember(m._id)}
                                          disabled={removingMember === m._id}
                                          className="text-xs text-red-500 hover:underline disabled:opacity-40"
                                        >
                                          {removingMember === m._id ? 'Removing…' : 'Remove'}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Add member picker */}
                          {showAddMember && (
                            <div className="mt-3 bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                              <input
                                type="text"
                                value={memberSearch}
                                onChange={e => setMemberSearch(e.target.value)}
                                placeholder="Search tenants by subdomain or shop name…"
                                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                autoFocus
                              />
                              {availableTenants.length === 0 ? (
                                <p className="text-xs text-gray-400 px-1 py-1">
                                  {memberSearch.trim() ? 'No tenants match your search.' : 'All tenants are already members, or no tenants exist.'}
                                </p>
                              ) : (
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                  {availableTenants.map(t => (
                                    <div key={t._id} className="flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 border border-transparent hover:border-gray-200">
                                      <div>
                                        <span className="font-mono text-xs text-green-700">{t.subdomain}</span>
                                        {t.shopName && <span className="text-xs text-gray-500 ml-2">{t.shopName}</span>}
                                      </div>
                                      <button
                                        onClick={() => handleAddMember(t._id)}
                                        disabled={addingMember === t._id}
                                        className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded px-2 py-1 disabled:opacity-40"
                                      >
                                        {addingMember === t._id ? 'Adding…' : 'Add'}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
