/**
 * Example: Storage — Aave collateral top-up (liquidation protection)
 *
 * Scenario: An off-chain keeper monitors a user's Aave V3 health factor.
 * When it drops below a safe threshold the keeper computes exactly how much
 * WETH to deposit as additional collateral to restore the health factor, then
 * triggers this batch.
 *
 * Why storage? The computed top-up amount needs to be used in three separate
 * steps — bounds validation, the actual Aave deposit, and the post-condition.
 * Writing it to a storage slot once and reading it back via `runtimeValue()`
 * guarantees all three steps operate on the exact same number, eliminating
 * any possibility of drift between what was validated and what was executed.
 *
 * Flow:
 *   1. Write the keeper-computed top-up amount to storage
 *   2. Validate the amount is not dust (≥ MIN_TOPUP)
 *   3. Validate the amount won't drain the wallet (≤ MAX_TOPUP)
 *   4. Pre-condition: SCA holds enough WETH to cover the top-up
 *   5. Approve Aave V3 for the stored amount
 *   6. Supply that WETH to Aave as additional collateral
 *   7. Post-condition: WETH balance decreased by at least the stored amount
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseEther } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const WETH = '0x4200000000000000000000000000000000000006';
const AAVE_V3_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

// ─── Minimal Aave V3 Pool ABI ────────────────────────────────────────────────

const AAVE_V3_POOL_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
] as const;

// ─── Setup ───────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({ chain: base, transport: http() });

// Your ERC-4337 smart account address
const scaAddress = '0xYourSmartAccountAddress' as `0x${string}`;

// ─── Keeper-computed top-up parameters ──────────────────────────────────────

// The keeper reads current Aave state off-chain and computes the minimum WETH
// needed to push health factor back above 1.5. These bounds are set by the user
// as their personal liquidation protection policy.
const MIN_TOPUP = parseEther('0.05'); // too small to meaningfully improve health factor
const MAX_TOPUP = parseEther('2'); // cap to avoid draining the whole wallet

// Computed by the keeper: "deposit 0.3 WETH to restore health factor to ~1.6"
const topUpAmount = parseEther('0.3');

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const weth = batch.erc20Token(WETH);
const aavePool = batch.contract(AAVE_V3_POOL, AAVE_V3_POOL_ABI);
const storage = batch.storage();

// One storage key shared across all steps — write once, read everywhere
const storageKey = await storage.getStorageKey();

// Read WETH balance now to anchor the post-condition delta check
const wethBalanceBefore = await weth.read({ functionName: 'balanceOf', args: [scaAddress] });

batch.add([
  // ── Step 1: lock in the keeper-computed amount ────────────────────────────
  // Writing to storage here makes the value part of the on-chain batch state.
  // All subsequent steps read from this slot, not from a local JS variable —
  // so the chain itself enforces consistency between validation and execution.
  storage.write({ value: topUpAmount, storageKey }),

  // ── Step 2: enforce minimum — reject dust top-ups ────────────────────────
  // A top-up below MIN_TOPUP won't meaningfully improve the health factor and
  // wastes gas. Reverts the whole batch if the keeper sent too small a value.
  storage.check({ storageKey, constraint: { gte: MIN_TOPUP } }),

  // ── Step 3: enforce maximum — protect against keeper bugs ─────────────────
  // Caps how much the keeper can move in a single batch. Guards against a
  // misconfigured or compromised keeper draining the wallet in one shot.
  storage.check({ storageKey, constraint: { lte: MAX_TOPUP } }),

  // ── Step 4: pre-condition — SCA holds enough WETH ────────────────────────
  // No point proceeding if the balance can't cover the top-up.
  weth.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: topUpAmount },
  }),

  // ── Step 5: approve Aave for the stored top-up amount ────────────────────
  // Sized to the same value in storage that passed the bounds checks above,
  // so the approval and the deposit are guaranteed to match exactly.
  weth.write({
    functionName: 'approve',
    args: [AAVE_V3_POOL, await storage.runtimeValue({ storageKey })],
  }),

  // ── Step 6: deposit into Aave using the stored amount ────────────────────
  // `storage.runtimeValue()` resolves the slot written in step 1. The chain
  // guarantees this is the same value that passed the bounds checks above.
  aavePool.write({
    functionName: 'supply',
    args: [WETH, await storage.runtimeValue({ storageKey }), scaAddress, 0],
  }),

  // ── Step 7: post-condition — confirm the deposit landed ──────────────────
  // WETH balance must have dropped by at least topUpAmount. If Aave silently
  // failed to pull the funds for any reason, this check catches it.
  weth.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { lte: wethBalanceBefore - topUpAmount },
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));
