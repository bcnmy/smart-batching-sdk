/**
 * Example: Cross-chain execution, predicate-gated
 *
 * Scenario: Bridge USDC from Base to Arbitrum via Across Protocol, then
 * immediately deposit the received USDC into Aave V3 on Arbitrum — all
 * orchestrated as a single MEE supertransaction.
 *
 * The two batches run on different chains but are submitted atomically to the
 * MEE. The MEE sequences them: source batch first, waits for the Across fill
 * on Arbitrum, then executes the destination batch. If the source-chain
 * predicates fail, nothing moves. If the destination-chain predicates fail
 * (e.g. bridge delivered less than expected), the deposit is skipped.
 *
 * SOURCE CHAIN (Base):
 *   1. Pre-condition: SCA holds enough USDC to bridge + keep a local reserve
 *   2. Approve the Across SpokePool for BRIDGE_AMOUNT
 *   3. Initiate the bridge deposit
 *   4. Post-condition: balance dropped by BRIDGE_AMOUNT (SpokePool pulled funds)
 *
 * DESTINATION CHAIN (Arbitrum):
 *   5. Pre-condition: bridged USDC has arrived (balance ≥ OUTPUT_AMOUNT)
 *   6. Approve Aave V3 pool for the runtime USDC balance
 *   7. Deposit the runtime USDC balance into Aave
 *   8. Post-condition: USDC balance is (near) zero — full sweep into Aave
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseUnits } from 'viem';
import { arbitrum, base } from 'viem/chains';

// ─── Addresses ───────────────────────────────────────────────────────────────

// Base
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ACROSS_SPOKE_POOL = '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64';

// Arbitrum
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const AAVE_V3_POOL_ARBITRUM = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ACROSS_SPOKE_POOL_ABI = [
  {
    name: 'depositV3',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'depositor', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'inputToken', type: 'address' },
      { name: 'outputToken', type: 'address' },
      { name: 'inputAmount', type: 'uint256' },
      { name: 'outputAmount', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'exclusiveRelayer', type: 'address' },
      { name: 'quoteTimestamp', type: 'uint32' },
      { name: 'fillDeadline', type: 'uint32' },
      { name: 'exclusivityDeadline', type: 'uint32' },
      { name: 'message', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

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

const baseClient = createPublicClient({ chain: base, transport: http() });
const arbitrumClient = createPublicClient({ chain: arbitrum, transport: http() });

const scaAddress = '0xYourSmartAccountAddress' as `0x${string}`;

// ─── Bridge parameters ────────────────────────────────────────────────────────

const BRIDGE_AMOUNT = parseUnits('500', 6); // Send 500 USDC from Base
const OUTPUT_AMOUNT = parseUnits('498', 6); // Expect at least 498 USDC on Arbitrum (0.4% fee)
const LOCAL_RESERVE = parseUnits('10', 6); // Keep 10 USDC on Base for future gas

const quoteTimestamp = Math.floor(Date.now() / 1000) as unknown as number;
const fillDeadline = quoteTimestamp + 21_600; // 6 hours
const ARBITRUM_CHAIN_ID = 42161n;

// =============================================================================
// SOURCE CHAIN BATCH — Base
// =============================================================================

const sourceBatch = createComposableBatch(baseClient, scaAddress);
const usdcBase = sourceBatch.erc20Token(USDC_BASE);
const spokePool = sourceBatch.contract(ACROSS_SPOKE_POOL, ACROSS_SPOKE_POOL_ABI);

const sourceBalanceBefore = await usdcBase.read({
  functionName: 'balanceOf',
  args: [scaAddress],
});

sourceBatch.add([
  // ── Pre-condition: enough USDC to bridge + keep local reserve ─────────────
  // Guards against funds being consumed by a concurrent transaction between
  // batch construction and execution.
  usdcBase.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: BRIDGE_AMOUNT + LOCAL_RESERVE },
  }),

  // ── Approve the SpokePool for exactly the bridge amount ───────────────────
  usdcBase.write({
    functionName: 'approve',
    args: [ACROSS_SPOKE_POOL, BRIDGE_AMOUNT],
  }),

  // ── Initiate the cross-chain deposit ──────────────────────────────────────
  // Across relayers detect this event and fill OUTPUT_AMOUNT on Arbitrum.
  // The SCA address is deterministic across chains — same recipient on both.
  spokePool.write({
    functionName: 'depositV3',
    args: [
      scaAddress,
      scaAddress,
      USDC_BASE,
      USDC_ARBITRUM,
      BRIDGE_AMOUNT,
      OUTPUT_AMOUNT,
      ARBITRUM_CHAIN_ID,
      '0x0000000000000000000000000000000000000000',
      quoteTimestamp,
      fillDeadline,
      0,
      '0x',
    ],
  }),

  // ── Post-condition: SpokePool pulled the funds ────────────────────────────
  // If the bridge deposit silently failed, this reverts everything — no
  // orphaned approval, no funds stuck mid-flight.
  usdcBase.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { lte: sourceBalanceBefore - BRIDGE_AMOUNT },
  }),
]);

// =============================================================================
// DESTINATION CHAIN BATCH — Arbitrum
// =============================================================================

const destBatch = createComposableBatch(arbitrumClient, scaAddress);
const usdcArbitrum = destBatch.erc20Token(USDC_ARBITRUM);
const aavePool = destBatch.contract(AAVE_V3_POOL_ARBITRUM, AAVE_V3_POOL_ABI);

destBatch.add([
  // ── Pre-condition: bridged USDC has arrived ───────────────────────────────
  // The MEE waits for the Across fill before executing this batch, but this
  // on-chain guard ensures the full expected amount actually landed. If the
  // relayer only partially filled for any reason, this rejects the deposit.
  usdcArbitrum.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: OUTPUT_AMOUNT },
  }),

  // ── Approve Aave for the runtime USDC balance ────────────────────────────
  // Use runtimeBalance() rather than OUTPUT_AMOUNT so the approval is sized
  // to whatever actually arrived — no excess allowance left over.
  usdcArbitrum.write({
    functionName: 'approve',
    args: [AAVE_V3_POOL_ARBITRUM, usdcArbitrum.runtimeBalance()],
  }),

  // ── Deposit the full runtime balance into Aave V3 on Arbitrum ─────────────
  // Sweeps whatever USDC landed from the bridge into Aave to start earning
  // yield immediately — no manual follow-up required.
  aavePool.write({
    functionName: 'supply',
    args: [USDC_ARBITRUM, usdcArbitrum.runtimeBalance(), scaAddress, 0],
  }),

  // ── Post-condition: USDC fully deposited into Aave ───────────────────────
  // After a full-balance sweep the SCA should hold no USDC on Arbitrum.
  usdcArbitrum.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { eq: 0n },
  }),
]);

// =============================================================================
// MEE SUPERTRANSACTION — submit both batches as one atomic instruction set
// =============================================================================

// The MEE sequences source → destination automatically.
// Pass both call arrays to getQuote() as separate chain instructions.

const sourceCalls = await sourceBatch.toCalls();
const destCalls = await destBatch.toCalls();

// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Source chain calls (Base):', JSON.stringify(sourceCalls, null, 2));
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Destination chain calls (Arbitrum):', JSON.stringify(destCalls, null, 2));

// Submit to MEE (requires @biconomy/abstractjs):
//
// const quote = await meeClient.getQuote({
//   instructions: [
//     { calls: sourceCalls, chainId: base.id,     isComposable: true },
//     { calls: destCalls,   chainId: arbitrum.id, isComposable: true },
//   ],
//   feeToken: { address: USDC_BASE, chainId: base.id },
// });
// const { hash } = await meeClient.executeQuote({ quote });
// await meeClient.waitForSupertransactionReceipt({ hash });
