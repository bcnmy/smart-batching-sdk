/**
 * Example: Leverage loop — single-batch collateral amplification
 *
 * Scenario: A user holds WETH and wants to amplify their Aave V3 position in
 * one atomic step. A single leverage loop: deposit WETH as collateral → borrow
 * USDC → swap USDC back to WETH → re-deposit — all without any dangerous gap
 * between steps.
 *
 * Without atomicity this requires four transactions. Between the borrow and the
 * re-deposit the position is temporarily under-collateralised — a liquidator
 * could strike that window. ERC-8211 closes it: either the full loop completes
 * atomically or nothing moves at all.
 *
 * `runtimeBalance()` is used for the approval and re-supply after the swap so
 * both are sized to whatever WETH actually landed in the SCA at execution time,
 * sweeping the full balance into Aave without any residual dust.
 *
 * Flow:
 *   1. Pre-condition: SCA holds enough WETH to seed the collateral position
 *   2. Approve Aave V3 for the initial WETH deposit
 *   3. Supply WETH as seed collateral on Aave V3
 *   4. Borrow USDC against the collateral (LTV-sized off-chain)
 *   5. Approve Uniswap V3 for the borrowed USDC
 *   6. Swap USDC → WETH
 *   7. Assert received WETH meets the minimum acceptable output (slippage guard)
 *   8. Approve Aave V3 for the runtime WETH balance
 *   9. Re-supply the runtime WETH balance as additional collateral
 *  10. Post-condition: all WETH swept into Aave — SCA balance is zero
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseEther, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AAVE_V3_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const UNISWAP_V3_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';

// ─── ABIs ─────────────────────────────────────────────────────────────────────

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
  {
    name: 'borrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'onBehalfOf', type: 'address' },
    ],
    outputs: [],
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

// ─── Position parameters ──────────────────────────────────────────────────────

// Seed collateral deposited at the start of the loop
const INITIAL_COLLATERAL = parseEther('1'); // 1 WETH

// USDC to borrow — sized to ~60% LTV of the collateral value.
// At 1 WETH ≈ $2 500, 60% LTV ≈ $1 500 USDC. Adjust to the live price
// before submission so the borrow doesn't exceed Aave's health-factor floor.
const BORROW_AMOUNT = parseUnits('1500', 6); // 1 500 USDC

// Minimum WETH acceptable from the USDC → WETH swap (≈1% slippage + fees).
// 1 500 USDC / $2 500 per WETH * 0.99 ≈ 0.594 WETH
const MIN_WETH_BACK = parseEther('0.594');

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const weth = batch.erc20Token(WETH);
const usdc = batch.erc20Token(USDC);
const aavePool = batch.contract(AAVE_V3_POOL, AAVE_V3_POOL_ABI);
const uniswapRouter = batch.contract(UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER_ABI);

batch.add([
  // ── Step 1: pre-condition — SCA must hold enough WETH to seed the position ─
  // Reverts the whole batch before any approvals are granted if funds are short.
  weth.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: INITIAL_COLLATERAL },
  }),

  // ── Step 2: approve Aave for the initial WETH deposit ────────────────────
  weth.write({
    functionName: 'approve',
    args: [AAVE_V3_POOL, INITIAL_COLLATERAL],
  }),

  // ── Step 3: supply WETH as seed collateral ────────────────────────────────
  // SCA's WETH balance drops by INITIAL_COLLATERAL; Aave aWETH balance rises.
  aavePool.write({
    functionName: 'supply',
    args: [WETH, INITIAL_COLLATERAL, scaAddress, 0],
  }),

  // ── Step 4: borrow USDC against the collateral ───────────────────────────
  // Interest rate mode 2 = variable rate. USDC lands directly in the SCA.
  aavePool.write({
    functionName: 'borrow',
    args: [USDC, BORROW_AMOUNT, 2n, 0, scaAddress],
  }),

  // ── Step 5: approve Uniswap for the borrowed USDC ────────────────────────
  usdc.write({
    functionName: 'approve',
    args: [UNISWAP_V3_ROUTER, BORROW_AMOUNT],
  }),

  // ── Step 6: swap USDC → WETH ──────────────────────────────────────────────
  // The slippage floor is enforced in step 7 rather than inside the router,
  // so the single source of truth for the minimum lives in the batch.
  uniswapRouter.write({
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 500, // 0.05% USDC/WETH pool
        recipient: scaAddress,
        amountIn: BORROW_AMOUNT,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  }),

  // ── Step 7: assert the swap output meets the minimum ─────────────────────
  // If the market moved against us and the WETH balance fell below
  // MIN_WETH_BACK, the entire batch reverts — including the borrow. No debt
  // is left stranded and no net position change occurs.
  weth.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: MIN_WETH_BACK },
  }),

  // ── Step 8: approve Aave for the runtime WETH balance ────────────────────
  // Resolved at execution time to whatever the swap produced — no excess
  // allowance left in the SCA after the re-supply.
  weth.write({
    functionName: 'approve',
    args: [AAVE_V3_POOL, weth.runtimeBalance()],
  }),

  // ── Step 9: re-supply the runtime WETH balance as additional collateral ───
  // Sweeps the full WETH balance into Aave, completing the leverage loop.
  // The position is now amplified by roughly BORROW_AMOUNT / WETH_PRICE.
  aavePool.write({
    functionName: 'supply',
    args: [WETH, weth.runtimeBalance(), scaAddress, 0],
  }),

  // ── Step 10: post-condition — all WETH swept into Aave ───────────────────
  // After depositing the full runtime balance the SCA should hold no WETH.
  // If the re-supply was partial for any reason this reverts the entire batch,
  // rolling back the borrow so no debt is left stranded.
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
