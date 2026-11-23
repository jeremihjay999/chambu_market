/**
 * Smart product name formatter.
 *
 * Prepends brand and/or variant to productName only when they are not already
 * present in the name, preventing strings like:
 *   "256GB Black Samsung Samsung Galaxy S24 Ultra 256GB Black"
 *
 * Rules:
 *  - Brand  (usually a single token): suppressed when it appears as a whole
 *    word inside productName (case-insensitive).
 *  - Variant (may be multi-word): suppressed when EVERY word in variant
 *    already appears as a whole word inside productName. This avoids false
 *    positives where e.g. "Pro" is a substring of "ProMax".
 */
export function formatProductName(p: {
  productName: string
  brand?: string
  variant?: string
}): string {
  const name = p.productName ?? ''

  // Build a set of whole words that already exist in the product name.
  const nameWords = new Set(
    name.toLowerCase().match(/[a-z0-9]+/g) ?? []
  )

  function alreadyContained(value: string | undefined): boolean {
    if (!value) return true // absent → nothing to prepend
    const tokens = value.toLowerCase().match(/[a-z0-9]+/g) ?? []
    if (tokens.length === 0) return true
    return tokens.every(tok => nameWords.has(tok))
  }

  const prefix: string[] = []

  if (!alreadyContained(p.brand))   prefix.push(p.brand!)
  if (!alreadyContained(p.variant)) prefix.push(p.variant!)

  return prefix.length > 0 ? `${prefix.join(' ')} ${name}` : name
}
