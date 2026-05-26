/**
 * Example: Runtime values with constraints — auto-compound yield
 *
 * Scenario: A user earns USDC rewards from a lending protocol. They want to
 * auto-compound by depositing whatever they've accumulated into a yield vault
 * (ERC-4626), but only if the amount is worth the gas and within a safe range.
 *
 * The key insight: the deposit amount is NOT known at batch-construction time.
 * It depends on how much has accrued by the time the batch executes. Runtime
 * values solve this — they resolve via an on-chain staticcall at execution
 * time, so the batch always uses the *actual* balance.
 *
 * Constraints on runtime values act as inline guards: if the resolved value
 * falls outside the allowed range, the entire batch reverts atomically before
 * any funds move.
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// A generic ERC-4626 yield vault (e.g. a Moonwell or Yearn vault on Base)
const YIELD_VAULT = '0xYourVaultAddress' as `0x${string}`;

// ─── Minimal ERC-4626 Vault ABI ──────────────────────────────────────────────

const ERC4626_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
] as const;

// ─── Setup ───────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({ chain: base, transport: http() });

// Your ERC-4337 smart account address
const scaAddress = '0xYourSmartAccountAddress' as `0x${string}`;

// ─── Deposit range ────────────────────────────────────────────────────────────

// Only deposit if rewards are worth it (not dust) …
const MIN_DEPOSIT = parseUnits('10', 6); // at least 10 USDC

// … but cap the single deposit so you never accidentally move too much at once.
const MAX_DEPOSIT = parseUnits('5_000', 6); // at most 5,000 USDC

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const usdc = batch.erc20Token(USDC);
const yieldVault = batch.contract(YIELD_VAULT, ERC4626_ABI);

// ── Runtime value: resolve USDC balance at execution time ─────────────────────
//
// `runtimeBalance()` does NOT read the balance now. It creates a placeholder
// that the on-chain executor resolves via staticcall when the batch runs.
//
// The `constraint: { gte: MIN_DEPOSIT }` is an inline guard — if the resolved
// balance is below 10 USDC the batch reverts before the deposit is attempted.
// This replaces a separate pre-condition check for the lower bound.
const depositAmount = usdc.runtimeBalance({
  constraint: { gte: MIN_DEPOSIT },
});

batch.add([
  // ── Guard: upper bound check ──────────────────────────────────────────────
  // A single constraint covers one side of the range. Use a separate `check()`
  // for the other side. Here we assert the balance won't exceed MAX_DEPOSIT so
  // we don't accidentally drain a large wallet in one auto-compound sweep.
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { lte: MAX_DEPOSIT },
  }),

  // ── Approve the vault to pull the runtime USDC balance ───────────────────
  // `depositAmount` resolves to the live balance at execution time, so the
  // approval is always sized exactly to what the vault will pull — no excess.
  usdc.write({
    functionName: 'approve',
    args: [YIELD_VAULT, depositAmount],
  }),

  // ── Main action: deposit the entire runtime balance into the vault ─────────
  // `depositAmount` is substituted with the live on-chain balance at execution.
  // The vault mints yield-bearing shares back to the SCA.
  yieldVault.write({
    functionName: 'deposit',
    args: [
      depositAmount, // ← runtime value, resolved on-chain
      scaAddress,
    ],
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));
