/**
 * Example: MEV-protected swap with bounded slippage
 *
 * Scenario: A user wants to swap USDC for WETH but is concerned about sandwich
 * attacks — a bot front-running the swap to move the price, letting the swap
 * execute at the worse rate, then back-running to pocket the difference.
 *
 * ERC-8211 predicates close that attack surface. The Chainlink ETH/USD price is
 * read fresh off-chain right before batch construction to derive a tight ±0.5%
 * price band. The on-chain checks then call `latestAnswer` at execution time —
 * not at construction time — so the oracle value the batch validates against is
 * always the live reading at the block the transaction lands. If a bot has
 * manipulated the price outside the band by execution time, the batch reverts
 * atomically before the swap touches any funds.
 *
 * A post-condition then verifies the received WETH meets the minimum expected
 * output, providing a second layer of slippage protection at the balance level.
 *
 * Flow:
 *   1. Read live ETH/USD price and WETH balance off-chain right before construction
 *   2. Pre-condition: live oracle price ≥ lower bound (price hasn't been driven down)
 *   3. Pre-condition: live oracle price ≤ upper bound (price hasn't been pumped up)
 *   4. Pre-condition: SCA holds enough USDC to swap
 *   5. Approve Uniswap V3 router for USDC_IN
 *   6. Swap USDC → WETH
 *   7. Post-condition: WETH balance increased by at least MIN_WETH_OUT
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseEther, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
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

// ─── Swap parameters ─────────────────────────────────────────────────────────

const USDC_IN = parseUnits('500', 6); // Spend 500 USDC

// Minimum WETH to accept — enforced both via the router and as a post-condition.
// Sized to the expected output at the current oracle price minus 1% total slippage.
const MIN_WETH_OUT = parseEther('0.198'); // ~$495 of WETH at $2 500/ETH

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const usdc = batch.erc20Token(USDC);
const weth = batch.erc20Token(WETH);
const chainlink = batch.contract(CHAINLINK_ETH_USD, CHAINLINK_ABI);
const uniswapRouter = batch.contract(UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER_ABI);

// Read the oracle price and WETH balance immediately before building the batch
// so the price band is as fresh as possible at construction time.
const oraclePrice = await chainlink.read({ functionName: 'latestAnswer', args: [] });
const wethBalanceBefore = await weth.read({ functionName: 'balanceOf', args: [scaAddress] });

// Derive a ±0.5% band from the freshly read price. The on-chain checks call
// `latestAnswer` again at execution time, so they validate against the live
// oracle value — not the one baked in here.
const priceBand = oraclePrice / 200n;
const MIN_ORACLE_PRICE = oraclePrice - priceBand;
const MAX_ORACLE_PRICE = oraclePrice + priceBand;

batch.add([
  // ── Step 2: oracle lower bound ────────────────────────────────────────────
  // If the ETH price has been driven below MIN_ORACLE_PRICE the swap would
  // yield far less WETH than expected. Revert before funds move.
  chainlink.check({
    functionName: 'latestAnswer',
    args: [],
    constraint: { gte: MIN_ORACLE_PRICE },
  }),

  // ── Step 3: oracle upper bound ────────────────────────────────────────────
  // An artificially pumped price signals a front-run. Revert to protect the
  // swap from executing at a manipulated rate.
  chainlink.check({
    functionName: 'latestAnswer',
    args: [],
    constraint: { lte: MAX_ORACLE_PRICE },
  }),

  // ── Step 4: pre-condition — SCA holds enough USDC ────────────────────────
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: USDC_IN },
  }),

  // ── Step 5: approve Uniswap for the exact swap input ─────────────────────
  usdc.write({
    functionName: 'approve',
    args: [UNISWAP_V3_ROUTER, USDC_IN],
  }),

  // ── Step 6: swap USDC → WETH ──────────────────────────────────────────────
  // `amountOutMinimum` mirrors MIN_WETH_OUT as a router-level floor.
  // The post-condition in step 7 independently verifies the balance delta.
  uniswapRouter.write({
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 500, // 0.05% USDC/WETH pool
        recipient: scaAddress,
        amountIn: USDC_IN,
        amountOutMinimum: MIN_WETH_OUT,
        sqrtPriceLimitX96: 0n,
      },
    ],
  }),

  // ── Step 7: post-condition — WETH balance increased by at least MIN_WETH_OUT
  // Verifies the balance delta rather than the return value, catching any
  // protocol-level discrepancy between what the router reported and what
  // actually landed in the SCA.
  weth.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: wethBalanceBefore + MIN_WETH_OUT },
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));
