/**
 * Example: Capture — swap output piped directly into a vault deposit
 *
 * Scenario: A user wants to swap USDC for WETH and immediately deposit the
 * received WETH into a yield vault — all in one atomic batch.
 *
 * The challenge: the exact WETH output of a swap is unknown at construction
 * time. Slippage and fees mean you'll get slightly more or less than your
 * estimate. If you hardcode an amount for the vault deposit you risk:
 *   - Depositing too little (leaving WETH idle in the wallet)
 *   - Depositing too much (reverting because you don't have that balance)
 *
 * ERC-8211 capture solves this by writing the swap's actual return value into
 * a storage slot at execution time. The deposit step then reads that slot via
 * `runtimeValue()` — depositing exactly what the swap produced, to the wei.
 *
 * Flow:
 *   1. Swap USDC → WETH, capture the exact `amountOut` return value
 *   2. Assert the captured amount meets the minimum acceptable output
 *   3. Deposit exactly the captured WETH into the yield vault
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseEther, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const UNISWAP_V3_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';

// A WETH yield vault on Base (e.g. a Moonwell or Yearn WETH vault)
const WETH_VAULT = '0xYourWethVaultAddress' as `0x${string}`;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

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

// ─── Swap parameters ─────────────────────────────────────────────────────────

const USDC_IN = parseUnits('500', 6); // Spend 500 USDC
const MIN_WETH_OUT = parseEther('0.13'); // Refuse the batch if output is below this

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);

const usdc = batch.erc20Token(USDC);
const weth = batch.erc20Token(WETH);
const uniswapRouter = batch.contract(UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER_ABI);
const wethVault = batch.contract(WETH_VAULT, ERC4626_ABI);
const storage = batch.storage();

// This slot will hold the exact WETH amount returned by the swap
const wethReceivedKey = await storage.getStorageKey();
// Pre-computed once and reused for both the vault approval and the deposit
const wethReceivedRV = await storage.runtimeValue({ storageKey: wethReceivedKey });

batch.add([
  // ── Step 1: approve Uniswap to spend the input USDC ──────────────────────
  usdc.write({
    functionName: 'approve',
    args: [UNISWAP_V3_ROUTER, USDC_IN],
  }),

  // ── Step 2: swap USDC → WETH and capture the exact output ────────────────
  // The `capture` option tells the executor to write `exactInputSingle`'s
  // return value (`amountOut`) into `wethReceivedKey` at execution time.
  // `amountOutMinimum` gives the router a first-layer floor; the storage check
  // in step 3 independently verifies the captured amount as a second layer.
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
    capture: { type: 'execResult', storageKey: wethReceivedKey },
  }),

  // ── Step 3: assert the swap output meets the minimum ─────────────────────
  // If the market moved unfavourably and we received less than MIN_WETH_OUT,
  // the whole batch reverts here — the swap is rolled back and no USDC is lost.
  storage.check({ storageKey: wethReceivedKey, constraint: { gte: MIN_WETH_OUT } }),

  // ── Step 4: approve the vault for exactly the captured WETH ──────────────
  // Sized to the precise swap output stored in step 2 — no excess allowance.
  weth.write({
    functionName: 'approve',
    args: [WETH_VAULT, wethReceivedRV],
  }),

  // ── Step 5: deposit exactly the captured WETH into the yield vault ────────
  // `wethReceivedRV` reads the slot written by the capture in step 2.
  // The vault receives the precise amount the swap produced — not an estimate,
  // not the total balance — eliminating any leftover WETH dust in the wallet.
  wethVault.write({
    functionName: 'deposit',
    args: [wethReceivedRV, scaAddress],
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));
