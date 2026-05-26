/**
 * Example: ERC20 — atomic approve + Aave deposit in one batch
 *
 * Scenario: A user wants to move their entire USDC balance into Aave to earn
 * yield. Aave requires an ERC-20 approval before it can pull funds, which
 * normally means two separate transactions: approve, then supply.
 *
 * With ERC-8211, both happen atomically in a single batch. If either step
 * fails, neither executes — you can never end up in a state where the
 * approval was granted but the deposit didn't happen.
 *
 * The deposit amount is also unknown at construction time — it depends on
 * whatever balance the SCA holds at execution time. `runtimeBalance()` resolves
 * this: the same live balance value is used for both the approval amount and
 * the deposit amount, so they are guaranteed to match exactly.
 *
 * Flow:
 *   1. Pre-condition: assert USDC balance is worth depositing (not dust)
 *   2. Approve the Aave pool for exactly the runtime balance
 *   3. Supply that same runtime balance to Aave
 *   4. Post-condition: assert USDC balance is now (near) zero
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
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

// ─── Deposit floor ────────────────────────────────────────────────────────────

const MIN_DEPOSIT = parseUnits('10', 6); // Don't bother depositing less than 10 USDC

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const usdc = batch.erc20Token(USDC);
const aavePool = batch.contract(AAVE_V3_POOL, AAVE_V3_POOL_ABI);

batch.add([
  // ── Step 1: pre-condition — assert balance is worth depositing ─────────────
  // `check()` acts as an inline guard. If the SCA holds less than MIN_DEPOSIT
  // the whole batch reverts before anything moves.
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: MIN_DEPOSIT },
  }),

  // ── Step 2: approve Aave for exactly the runtime balance ──────────────────
  // The approval amount is resolved on-chain at execution time — not hardcoded.
  // This means the approval is tight (no excess allowance left over) and always
  // matches the deposit amount in step 3 regardless of when the batch executes.
  usdc.write({
    functionName: 'approve',
    args: [AAVE_V3_POOL, usdc.runtimeBalance()],
  }),

  // ── Step 3: supply the runtime balance to Aave ────────────────────────────
  // Uses the same live balance as step 2. Both resolve via independent
  // staticcalls at execution time, but since no balance change happens between
  // them in this batch, they are guaranteed to return the same value.
  aavePool.write({
    functionName: 'supply',
    args: [USDC, usdc.runtimeBalance(), scaAddress, 0],
  }),

  // ── Step 4: post-condition — assert the full balance was deposited ─────────
  // After a full-balance deposit the SCA should hold no USDC. If Aave only
  // partially accepted the deposit for any reason, this check catches it and
  // reverts the entire batch — including the approval and the supply.
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { eq: 0n },
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));
