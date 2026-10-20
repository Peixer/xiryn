"use server"

import { revalidatePath } from "next/cache"

import { modelPriceSchema, modelSpecSchema, monthlyBudgetSchema } from "@/db/schema"
import { setSetting } from "@/lib/config"
import { setCustomPrice } from "@/lib/spend"

export async function setMonthlyBudget(value: string) {
  const parsed = monthlyBudgetSchema.safeParse(value)
  if (!parsed.success) throw new Error(parsed.error.issues[0].message)
  const amount = Number.parseFloat(parsed.data)
  setSetting("usage.monthlyBudget", amount > 0 ? String(amount) : null)
  revalidatePath("/", "layout")
}

export async function setModelPrice(input: {
  spec: string
  input: number
  output: number
  cached?: number
}) {
  const parsed = modelPriceSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0].message)
  const { spec, ...rate } = parsed.data
  setCustomPrice(spec, rate)
  revalidatePath("/usage")
}

export async function clearModelPrice(spec: string) {
  const parsed = modelSpecSchema.safeParse(spec)
  if (!parsed.success) throw new Error(parsed.error.issues[0].message)
  setCustomPrice(parsed.data, null)
  revalidatePath("/usage")
}
