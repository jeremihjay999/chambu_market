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

// Quotation share registry — maps a public share token to the tenant DB that
// holds the quotation. The public /q/[token] view uses this to resolve which
// tenant connection to open (it has no auth/JWT to tell it).
const quotationShareSchema = new mongoose.Schema(
  {
    shareToken:       { type: String, required: true, unique: true, index: true },
    userId:           { type: String, required: true },        // owner id in the tenant DB
    quotationId:      { type: String, required: true },        // quotation _id in the tenant DB
    mongoUri:         { type: String, default: '' },           // '' = default MONGODB_URI DB
    mongoUriFallback: { type: String, default: '' },
    createdAt:        { type: Date, default: Date.now },
  },
  { collection: 'quotation_shares' }
)

// Sale receipt share registry — same pattern as quotation shares.
// Maps a public receipt token to the tenant DB that holds the sale.
// The public /r/[token] route uses this to look up the sale without auth.
const saleShareSchema = new mongoose.Schema(
  {
    shareToken:       { type: String, required: true, unique: true, index: true },
    userId:           { type: String, required: true },
    saleId:           { type: String, required: true },
    mongoUri:         { type: String, default: '' },
    mongoUriFallback: { type: String, default: '' },
    createdAt:        { type: Date, default: Date.now },
  },
  { collection: 'sale_shares' }
)

export async function getAdminModels() {
  const conn = await connectAdminDB()
  // Always re-register to pick up schema changes (safe — Mongoose deduplicates internally
  // when the same schema instance is passed again, so this doesn't create duplicate models)
  if (conn.models.Cluster) delete conn.models.Cluster
  if (conn.models.Tenant)  delete conn.models.Tenant
  const Tenant  = conn.model('Tenant',  tenantSchema)
  const Cluster = conn.model('Cluster', clusterSchema)
  const UserEmailIndex = conn.models.UserEmailIndex || conn.model('UserEmailIndex', userEmailIndexSchema)
  const QuotationShare = conn.models.QuotationShare || conn.model('QuotationShare', quotationShareSchema)
  const SaleShare      = conn.models.SaleShare      || conn.model('SaleShare',      saleShareSchema)
  return { Tenant, Cluster, UserEmailIndex, QuotationShare, SaleShare }
}
