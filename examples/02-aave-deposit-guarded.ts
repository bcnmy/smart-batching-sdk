/**
 * Example: Pre-conditions — safe Aave deposit
 *
 * Scenario: Deposit USDC into Aave V3 to start earning yield.
 *
 * The problem without pre-conditions: if the SCA doesn't hold enough USDC, or
 * hasn't approved the Aave pool, the deposit call reverts on-chain — wasting
 * gas and leaving the batch in an inconsistent state.
 *
 * ERC-8211 pre-conditions let you place `check()` calls *before* the main
 * action. If any condition fails, the entire batch is rejected before any
 * state changes happen. Think of them as on-chain assertions that gate
 * execution.
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

// ─── Deposit parameters ───────────────────────────────────────────────────────

const DEPOSIT_AMOUNT = parseUnits('500', 6); // Deposit 500 USDC into Aave

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const usdc = batch.erc20Token(USDC);
const aavePool = batch.contract(AAVE_V3_POOL, AAVE_V3_POOL_ABI);

batch.add([
  // ── Pre-condition 1: assert the SCA holds enough USDC ─────────────────────
  // If the balance is below DEPOSIT_AMOUNT, the batch reverts here — the
  // deposit call is never reached and no gas is wasted on a doomed transaction.
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: DEPOSIT_AMOUNT },
  }),

  // ── Pre-condition 2: assert the Aave pool has sufficient allowance ─────────
  // Aave's `supply` will pull USDC from the SCA via transferFrom. If the
  // allowance hasn't been set (or has been partially consumed), this check
  // catches it before the deposit is even attempted.
  usdc.check({
    functionName: 'allowance',
    args: [scaAddress, AAVE_V3_POOL],
    constraint: { gte: DEPOSIT_AMOUNT },
  }),

  // ── Main action: deposit into Aave ────────────────────────────────────────
  // Only reached if both pre-conditions above pass. The SCA supplies USDC to
  // Aave on its own behalf and starts accruing aUSDC yield immediately.
  aavePool.write({
    functionName: 'supply',
    args: [USDC, DEPOSIT_AMOUNT, scaAddress, 0],
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));
