/**
 * Example: Post-conditions — on-chain swap output protection
 *
 * Scenario: Swap USDC for WETH on Uniswap V3.
 *
 * The problem with a plain swap: MEV bots or bad price impact can leave you
 * with far less WETH than expected. The on-chain `amountOutMinimum` in the
 * Uniswap call helps, but you can't express rules like "assert my *total*
 * WETH balance after the swap is at least X" — which matters if you're
 * composing multiple steps.
 *
 * ERC-8211 post-conditions let you add a `check()` call *after* the swap
 * that reads the actual on-chain state and reverts the entire batch if the
 * outcome isn't what you expected. No separate transaction needed.
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseEther, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const UNISWAP_V3_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';

// ─── Minimal Uniswap V3 Router ABI ──────────────────────────────────────────

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

// Your ERC-4337 smart account address
const scaAddress = '0xYourSmartAccountAddress' as `0x${string}`;

// ─── Swap parameters ─────────────────────────────────────────────────────────

const USDC_IN = parseUnits('100', 6); // Spend exactly 100 USDC
const MIN_WETH_OUT = parseEther('0.03'); // Expect at least 0.03 WETH back

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const usdc = batch.erc20Token(USDC);
const weth = batch.erc20Token(WETH);
const uniswapRouter = batch.contract(UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER_ABI);

// Read the SCA's WETH balance before the swap so the post-condition can check
// the *delta* — i.e. how much WETH was actually received.
const wethBalanceBefore = await weth.read({ functionName: 'balanceOf', args: [scaAddress] });
const MIN_WETH_BALANCE_AFTER = wethBalanceBefore + MIN_WETH_OUT;

batch.add([
  // ── Step 1: approve Uniswap to spend the input USDC ──────────────────────
  usdc.write({
    functionName: 'approve',
    args: [UNISWAP_V3_ROUTER, USDC_IN],
  }),

  // ── Step 2: execute the swap ──────────────────────────────────────────────
  // Swap 100 USDC → WETH via Uniswap V3. `amountOutMinimum` gives the router
  // a first-layer floor; the post-condition in step 3 independently verifies
  // the balance delta as a second layer.
  uniswapRouter.write({
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 500, // 0.05% pool
        recipient: scaAddress,
        amountIn: USDC_IN,
        amountOutMinimum: MIN_WETH_OUT,
        sqrtPriceLimitX96: 0n,
      },
    ],
  }),

  // ── Step 3: post-condition — assert the swap delivered enough WETH ────────
  // This `check()` runs *after* the swap, reads balanceOf on-chain, and reverts
  // the whole batch (including the swap) if the balance is below our minimum.
  // The SCA never ends up in a state where the swap happened but output was bad.
  weth.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: MIN_WETH_BALANCE_AFTER },
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

// `toCalls()` returns the array of composable calls ready to send to MEE.
const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));

// Or encode the full calldata in one shot:
// const calldata = await batch.toCalldata();
