import { describe, expect, it } from 'vitest'
import { PRICING_PLAN_LIMITS, pricingPlanCreateSchema, pricingPlanPatchSchema } from '../../shared/pricing-plan-schema'

const schema = pricingPlanCreateSchema(code => code)

function parse(input: unknown) {
  return schema.safeParse(input)
}

describe('pricingPlanCreateSchema', () => {
  it('accepts a valid plan and nulls an empty description', () => {
    const result = parse({ name: 'Junior 1×/week', description: '', amountMinor: 20000 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBeNull()
      expect(result.data.amountMinor).toBe(20000)
    }
  })

  it('requires a name', () => {
    expect(parse({ name: '', description: '', amountMinor: 20000 }).success).toBe(false)
    expect(parse({ name: '   ', description: '', amountMinor: 20000 }).success).toBe(false)
  })

  it('rejects a non-positive or non-integer amount (money is integer grosze)', () => {
    expect(parse({ name: 'X', description: '', amountMinor: 0 }).success).toBe(false)
    expect(parse({ name: 'X', description: '', amountMinor: -100 }).success).toBe(false)
    expect(parse({ name: 'X', description: '', amountMinor: 199.5 }).success).toBe(false)
  })

  it('rejects an absurd amount above the ceiling', () => {
    expect(parse({ name: 'X', description: '', amountMinor: PRICING_PLAN_LIMITS.maxAmountMinor + 1 }).success).toBe(false)
  })

  it('rejects an over-long name', () => {
    expect(parse({ name: 'a'.repeat(PRICING_PLAN_LIMITS.name + 1), description: '', amountMinor: 100 }).success).toBe(false)
  })
})

describe('pricingPlanPatchSchema', () => {
  it('allows updating just one field', () => {
    const patch = pricingPlanPatchSchema(code => code)
    expect(patch.safeParse({ amountMinor: 25000 }).success).toBe(true)
    expect(patch.safeParse({ name: 'New name' }).success).toBe(true)
    expect(patch.safeParse({}).success).toBe(true)
  })

  it('still enforces the field rules when a field is present', () => {
    const patch = pricingPlanPatchSchema(code => code)
    expect(patch.safeParse({ amountMinor: -1 }).success).toBe(false)
  })
})
