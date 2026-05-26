/**
 * Example: Safe ERC-20 transfer with pre/post guards
 *
 * Scenario: Send 100 USDC to a recipient. Simple enough — but in production
 * you want guarantees that plain `transfer` cannot give you:
 *
 *   - The SCA actually holds enough before the transfer executes
 *   - The recipient genuinely received the funds (not silently swallowed by
 *     a fee-on-transfer token or a broken contract)
 *   - If either condition fails, no state changes at all
 *
 * This is the most fundamental ERC-8211 pattern: pre-condition → action →
 * post-condition. Everything is atomic — either all three succeed or none do.
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';

// ─── Addresses (Base mainnet) ────────────────────────────────────────────────

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const recipient = '0xRecipientAddress' as `0x${string}`;

// ─── Setup ───────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({ chain: base, transport: http() });
const scaAddress = '0xYourSmartAccountAddress' as `0x${string}`;

// ─── Transfer parameters ─────────────────────────────────────────────────────

const TRANSFER_AMOUNT = parseUnits('100', 6); // 100 USDC

// ─── Build the batch ─────────────────────────────────────────────────────────

const batch = createComposableBatch(publicClient, scaAddress);
const usdc = batch.erc20Token(USDC);

// Read recipient balance now so the post-condition can verify the exact delta
const recipientBalanceBefore = await usdc.read({
  functionName: 'balanceOf',
  args: [recipient],
});

batch.add([
  // ── Pre-condition: sender has enough ──────────────────────────────────────
  // Reverts the entire batch if the SCA doesn't hold at least TRANSFER_AMOUNT.
  // Catches insufficient-balance situations before any gas is spent on a
  // transfer that would fail anyway.
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: TRANSFER_AMOUNT },
  }),

  // ── Action: transfer ──────────────────────────────────────────────────────
  usdc.write({
    functionName: 'transfer',
    args: [recipient, TRANSFER_AMOUNT],
  }),

  // ── Post-condition: recipient actually received the funds ─────────────────
  // Verifies the recipient's balance increased by at least TRANSFER_AMOUNT.
  // This catches fee-on-transfer tokens and any protocol that intercepts
  // the transfer without delivering the full amount to the recipient.
  usdc.check({
    functionName: 'balanceOf',
    args: [recipient],
    constraint: { gte: recipientBalanceBefore + TRANSFER_AMOUNT },
  }),
]);

// ─── Generate calldata ────────────────────────────────────────────────────────

const calls = await batch.toCalls();
// biome-ignore lint/suspicious/noConsole: intentional in examples
console.log('Composable calls:', JSON.stringify(calls, null, 2));
