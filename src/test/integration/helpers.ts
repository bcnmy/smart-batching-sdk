/**
 * Shared funding and balance helpers for integration tests.
 *
 * Requires the test environment to have PRIVATE_KEY set so that
 * `walletClient` from '../utils' is defined.
 */

import type { Address } from 'viem';
import { erc20Abi, getAddress, parseUnits } from 'viem';
import { publicClient, USDC_ADDRESS, walletClient } from '../utils';
import { RUNTIME_TRANSFER_ABI } from './abi/runtime-transfer';

if (!walletClient) throw new Error('PRIVATE_KEY is not set in environment');
const _walletClient = walletClient;

export const USDC = USDC_ADDRESS as Address;

// ---------------------------------------------------------------------------
// Runtime transfer contract — shared across suites that test composable execution
// ---------------------------------------------------------------------------

export const RUNTIME_TRANSFER_CONTRACT = getAddress('0x7c3b315E1d72CFdB8999A68a12e87fc3cc490fec');
export const TRANSFER_AMOUNT = parseUnits('1', 6); // 1 mock USDC per test
export const SCA_MIN_BALANCE = parseUnits('0.5', 6);
export const SCA_TARGET_BALANCE = parseUnits('1', 6);

// Tops up SCA to SCA_TARGET_BALANCE if balance has dropped below SCA_MIN_BALANCE.
export async function ensureScaBalance(scaAddress: Address): Promise<void> {
  const balance = await usdcBalanceOf(scaAddress);
  if (balance < SCA_MIN_BALANCE) {
    await fundWithUsdc(scaAddress, SCA_TARGET_BALANCE - balance);
  }
}

// Resets the runtime transfer contract to exactly TRANSFER_AMOUNT before each test.
// Drains any excess back to the EOA, then tops up if below TRANSFER_AMOUNT.
export async function ensureRuntimeTransferContractBalance(): Promise<void> {
  const balance = await usdcBalanceOf(RUNTIME_TRANSFER_CONTRACT);
  if (balance > TRANSFER_AMOUNT) {
    const hash = await _walletClient.writeContract({
      abi: RUNTIME_TRANSFER_ABI,
      address: RUNTIME_TRANSFER_CONTRACT,
      functionName: 'transferFunds',
      args: [USDC, _walletClient.account.address, balance - TRANSFER_AMOUNT],
    });
    await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
  } else if (balance < TRANSFER_AMOUNT) {
    await fundWithUsdc(RUNTIME_TRANSFER_CONTRACT, TRANSFER_AMOUNT - balance);
  }
}

export async function fundWithUsdc(recipient: Address, amount: bigint): Promise<void> {
  const hash = await _walletClient.writeContract({
    abi: erc20Abi,
    address: USDC,
    functionName: 'transfer',
    args: [recipient, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
}

export async function fundWithEth(recipient: Address, amount: bigint): Promise<void> {
  const hash = await _walletClient.sendTransaction({ to: recipient, value: amount });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
}

export async function usdcBalanceOf(address: Address): Promise<bigint> {
  return publicClient.readContract({
    abi: erc20Abi,
    address: USDC,
    functionName: 'balanceOf',
    args: [address],
  });
}
