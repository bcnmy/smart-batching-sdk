/**
 * Example: Contract — Compound V3 full debt repayment
 *
 * Scenario: A user has an open USDC borrow position on Compound V3. They want
 * to repay the entire debt in one batch. The challenge: borrow balances accrue
 * interest every block, so the exact amount owed is never the same as what you
 * read off-chain seconds earlier.
 *
 * `contract.runtimeValue()` solves this — it calls any view function on any
 * contract at execution time and uses the live return value as an argument in
 * a subsequent step. Here it reads `borrowBalanceOf` from the Compound Comet
 * contract at the exact block the batch executes, so the repayment amount
 * always includes the latest accrued interest to the wei.
 *
 * Flow:
 *   1. Read live debt via `borrowBalanceOf` (runtime value with dust guard)
 *   2. Pre-condition: SCA holds enough USDC to cover the live debt
 *   3. Approve Compound for the live debt amount
 *   4. Repay the live debt (supply USDC to Compound to clear the borrow)
 *   5. Post-condition: assert borrow balance is now zero
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Compound V3 USDC market (Comet) on Base
const COMPOUND_V3_COMET = '0xb125E6687d4313864e53df431d5425969c15Eb2';

// ─── Minimal Compound V3 Comet ABI ──────────────────────────────────────────

const COMPOUND_V3_COMET_ABI = [
  {
    // Returns the current borrow balance including all accrued interest
    name: 'borrowBalanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    // Repay borrow by supplying the base asset (USDC) back to the market
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// ─── Setup ───────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({ chain: base, transport: http() });

// Your ERC-4337 smart account address
const scaAddress = '0xYourSmartAccountAddress' as `0x${string}`;

// ─── Repay parameters ─────────────────────────────────────────────────────────

// Don't bother repaying dust — Compound charges gas and the health factor
// improvement would be negligible.
const MIN_REPAY = parseUnits('1', 6); // at least 1 USDC of debt

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const usdc = batch.erc20Token(USDC);
const comet = batch.contract(COMPOUND_V3_COMET, COMPOUND_V3_COMET_ABI);

// ── Runtime value: live borrow balance ────────────────────────────────────────
// `runtimeValue()` calls `borrowBalanceOf` at execution time — not now.
// The returned debt figure will include interest accrued up to that exact block,
// ensuring the repayment amount is never stale.
//
// The `constraint` is an inline guard: if the debt is below MIN_REPAY the whole
// batch reverts before any funds move — no wasted gas on trivial repayments.
const liveDebt = comet.runtimeValue({
  functionName: 'borrowBalanceOf',
  args: [scaAddress],
  constraint: { gte: MIN_REPAY },
});

batch.add([
  // ── Step 1: pre-condition — SCA must hold enough USDC to repay ────────────
  // Reverts the batch if the USDC balance is below the minimum repay threshold,
  // before any approval or repayment is attempted.
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: MIN_REPAY },
  }),

  // ── Step 2: approve Compound for the live debt amount ────────────────────
  // The approval is sized to exactly what we'll repay — no excess allowance.
  // Both this step and step 3 consume `liveDebt`, which resolves to the same
  // on-chain value because the borrow balance doesn't change within the batch.
  usdc.write({
    functionName: 'approve',
    args: [COMPOUND_V3_COMET, liveDebt],
  }),

  // ── Step 3: repay the debt ────────────────────────────────────────────────
  // Compound V3 repayment is a `supply` call with the base asset.
  // `liveDebt` here is the same runtime value as in step 2 — resolved once,
  // used twice, guaranteed consistent.
  comet.write({
    functionName: 'supply',
    args: [USDC, liveDebt],
  }),

  // ── Step 4: post-condition — assert the position is fully cleared ─────────
  // After repaying the full borrow balance, `borrowBalanceOf` should return 0.
  // If for any reason the repayment was partial, this reverts the entire batch
  // so neither the approval nor the supply goes through.
  comet.check({
    functionName: 'borrowBalanceOf',
    args: [scaAddress],
    constraint: { eq: 0n },
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));
