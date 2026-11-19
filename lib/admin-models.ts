import mongoose from 'mongoose'
import { connectAdminDB } from './db'
import { DEFAULT_FEATURES } from './features'

const tenantSchema = new mongoose.Schema(
  {
    subdomain:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    mongoUri:          { type: String, required: true },   // primary (SRV)
    mongoUriFallback:  { type: String, default: '' },      // fallback (standard)
    shopName:          { type: String, default: '' },
    isActive:          { type: Boolean, default: true },
    clusterId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Cluster', default: null },
    features:          { type: mongoose.Schema.Types.Mixed, default: () => ({ ...DEFAULT_FEATURES }) },
    paymentNotification: {
      enabled: { type: Boolean, default: false },
      paymentUrl: { type: String, default: '' },
      message: { type: String, default: '' },
      daysOverdue: { type: Number, default: 0 },
    },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'tenants', strict: false }
)

const clusterSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true },
    uri1:         { type: String, default: '' },   // primary connection URI
    uri2:         { type: String, default: '' },   // fallback connection URI
    maxTenants:   { type: Number, default: 5 },
    tenantCount:  { type: Number, default: 0 },
    isActive:     { type: Boolean, default: true },
    createdAt:    { type: Date, default: Date.now },
  },
  { collection: 'clusters', strict: false }
)

// Email-to-Tenant mapping for fast login lookups
const userEmailIndexSchema = new mongoose.Schema(
  {
    email:      { type: String, required: true, lowercase: true, trim: true },
    tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userType:   { type: String, enum: ['user', 'staff'], required: true },
    userId:     { type: String, required: true }, // ID in the tenant DB
    isActive:   { type: Boolean, default: true },
    lastSync:   { type: Date, default: Date.now },
  },
  { 
    collection: 'user_email_index',
    timestamps: true 
  }
)

// Compound index for fast email lookups
userEmailIndexSchema.index({ email: 1, isActive: 1 })
userEmailIndexSchema.index({ tenantId: 1 })

export async function getAdminModels() {
  const conn = await connectAdminDB()
  // Always re-register to pick up schema changes (safe — Mongoose deduplicates internally
  // when the same schema instance is passed again, so this doesn't create duplicate models)
  if (conn.models.Cluster) delete conn.models.Cluster
  if (conn.models.Tenant)  delete conn.models.Tenant
  const Tenant  = conn.model('Tenant',  tenantSchema)
  const Cluster = conn.model('Cluster', clusterSchema)
  const UserEmailIndex = conn.models.UserEmailIndex || conn.model('UserEmailIndex', userEmailIndexSchema)
  return { Tenant, Cluster, UserEmailIndex }
}
