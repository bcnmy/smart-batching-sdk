/**
 * Example: OR flow — combined stop-loss / take-profit in one predicate
 *
 * Scenario: A user holds WETH and wants to exit their position automatically
 * when the ETH price hits either of two triggers:
 *
 *   Stop-loss:   price drops to $2 000 — cut losses before they deepen
 *   Take-profit: price rises to $3 500 — lock in gains at the target
 *
 * Normally these are two separate orders submitted to two separate bots. With
 * ERC-8211 both triggers collapse into a single on-chain predicate using an OR
 * constraint. The batch is submitted once to the MEE; the MEE monitors and
 * executes it the moment either condition is satisfied on-chain.
 *
 * If neither condition holds at execution time the check reverts and nothing
 * moves. If both hold simultaneously (rare, but possible during extreme
 * volatility) the check still passes — the batch executes exactly once.
 *
 * Flow:
 *   1. Pre-condition: oracle price ≤ STOP_LOSS_PRICE OR ≥ TAKE_PROFIT_PRICE
 *   2. Pre-condition: WETH balance is worth exiting (not dust)
 *   3. Approve Uniswap V3 for the runtime WETH balance
 *   4. Swap the full WETH balance → USDC
 *   5. Post-condition: WETH balance is zero — position fully exited
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseEther, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const UNISWAP_V3_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';

// Chainlink ETH/USD price feed on Base — 8 decimals
const CHAINLINK_ETH_USD = '0x71041dddad3595F9CEd3dCCFBe3D1F4b0a16Bb70';

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const CHAINLINK_ABI = [
  {
    name: 'latestAnswer',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'int256' }],
  },
] as const;

const UNISWAP_V3_ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

// ─── Setup ───────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({ chain: base, transport: http() });
const scaAddress = '0xYourSmartAccountAddress' as `0x${string}`;

// ─── Exit parameters ──────────────────────────────────────────────────────────

// Chainlink ETH/USD uses 8 decimals — use parseUnits with 8 for readability.
const STOP_LOSS_PRICE = parseUnits('2000', 8); // $2 000 — exit if price falls here
const TAKE_PROFIT_PRICE = parseUnits('3500', 8); // $3 500 — exit if price rises here

// Don't bother exiting a dust position — set a floor worth the gas.
const MIN_WETH_TO_EXIT = parseEther('0.01');

// Minimum USDC to accept for the swap at the stop-loss price with 1% slippage:
// MIN_WETH_TO_EXIT * $2 000 * 0.99 ≈ 19.8 USDC for 0.01 WETH.
// Scale this to your actual position size.
const MIN_USDC_OUT = parseUnits('19.8', 6);

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const weth = batch.erc20Token(WETH);
const chainlink = batch.contract(CHAINLINK_ETH_USD, CHAINLINK_ABI);
const uniswapRouter = batch.contract(UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER_ABI);

batch.add([
  // ── Step 1: OR predicate — stop-loss OR take-profit ───────────────────────
  // A single check covers both exit conditions. `latestAnswer` is called live
  // at execution time, so the price the MEE evaluates is the one at the actual
  // block — not a stale value from when the batch was submitted.
  //
  // The batch stays pending until one branch becomes true:
  //   lte: STOP_LOSS_PRICE  → price fell to the stop-loss level
  //   gte: TAKE_PROFIT_PRICE → price rose to the take-profit level
  chainlink.check({
    functionName: 'latestAnswer',
    args: [],
    constraint: {
      or: [{ lte: STOP_LOSS_PRICE }, { gte: TAKE_PROFIT_PRICE }],
    },
  }),

  // ── Step 2: pre-condition — position is worth exiting ─────────────────────
  // Prevents wasting gas on a dust exit if the position has already been
  // partially or fully closed by a prior transaction.
  weth.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: MIN_WETH_TO_EXIT },
  }),

  // ── Step 3: approve Uniswap for the full runtime WETH balance ────────────
  // Sized to whatever the SCA holds at execution time — works correctly
  // regardless of whether a stop-loss or take-profit triggered.
  weth.write({
    functionName: 'approve',
    args: [UNISWAP_V3_ROUTER, weth.runtimeBalance()],
  }),

  // ── Step 4: swap the full WETH balance → USDC ────────────────────────────
  // Full position exit: sells everything the SCA holds at execution time.
  // `MIN_USDC_OUT` is sized to the worst case (stop-loss price minus slippage)
  // so the router rejects the swap if the pool is severely out of range.
  uniswapRouter.write({
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: WETH,
        tokenOut: USDC,
        fee: 500, // 0.05% WETH/USDC pool
        recipient: scaAddress,
        amountIn: weth.runtimeBalance(),
        amountOutMinimum: MIN_USDC_OUT,
        sqrtPriceLimitX96: 0n,
      },
    ],
  }),

  // ── Step 5: post-condition — position fully exited ────────────────────────
  // After selling the full balance the SCA should hold no WETH. If the swap
  // was partial for any reason this reverts the entire batch.
  weth.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { eq: 0n },
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));

// Submit to MEE (requires @biconomy/abstractjs).
// The MEE monitors the OR predicate and executes the batch the moment
// either STOP_LOSS_PRICE or TAKE_PROFIT_PRICE is satisfied on-chain:
//
// const quote = await meeClient.getQuote({
//   instructions: [{ calls, chainId: base.id, isComposable: true }],
//   feeToken: { address: USDC, chainId: base.id },
// });
// const { hash } = await meeClient.executeQuote({ quote });
// await meeClient.waitForSupertransactionReceipt({ hash });
