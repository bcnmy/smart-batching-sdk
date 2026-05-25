/**
 * Integration — ZeroDev Kernel + 8211 composability module (Base Sepolia)
 *
 * Demonstrates installing the 8211 composability module on a ZeroDev Kernel
 * v3.1 smart account and executing a composable batch (pre-check → runtime sweep
 * → post-check) entirely through ZeroDev's bundler
 *
 * Module address (Base Sepolia): 0x00000000f61636C0CA71d21a004318502283aB2d
 *
 * Installation requires two module type registrations in a single batched UserOp:
 *   • FALLBACK  (type 3) — initData: 0xea5a6d9100
 *   • EXECUTOR  (type 2) — initData: 0x
 *
 * Execution:
 *   batch.toCalldata() is passed directly as the UserOp callData. The SCA receives
 *   the executeComposable selector and routes it to the composability module via its
 *   FALLBACK handler. The module resolves runtime values and calls back via
 *   executeFromExecutor for each sub-call.
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createKernelAccount, createKernelAccountClient } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import type { Address, Hex } from 'viem';
import { encodeFunctionData, getAddress, http, parseUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { beforeAll, describe, expect, it } from 'vitest';
import { account, publicClient } from '../utils';
import { ERC7579_ABI } from './abi/erc7579';
import { fundWithEth, fundWithUsdc, USDC, usdcBalanceOf } from './helpers';

if (!account) throw new Error('PRIVATE_KEY is not set in environment');
if (!process.env.ZERODEV_BUNDLER_URL)
  throw new Error('ZERODEV_BUNDLER_URL is not set in environment');

const _account = account;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Biconomy composability module — requires both FALLBACK + EXECUTOR installation
const COMPOSABILITY_MODULE = getAddress('0x00000000f61636C0CA71d21a004318502283aB2d');

// ERC-7579 module type IDs
const EXECUTOR_MODULE_TYPE = 2n;
const FALLBACK_MODULE_TYPE = 3n;

// initData for each module type registration
const FALLBACK_INIT_DATA = '0xea5a6d9100' as Hex;
const EXECUTOR_INIT_DATA = '0x' as Hex;

const FUND_AMOUNT = parseUnits('1', 6); // 1 mock USDC
const ETH_GAS_FUND = parseUnits('0.01', 18); // ETH to cover UserOp fees

// ---------------------------------------------------------------------------
// ZeroDev account state — initialised once for the whole suite
// ---------------------------------------------------------------------------

let scaAddress: Address;
let kernelClient: Awaited<ReturnType<typeof createKernelAccountClient>>;
let kernelAccount: Awaited<ReturnType<typeof createKernelAccount>>;

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe.skip('Integration — ZeroDev Kernel + Biconomy composability module (Base Sepolia)', () => {
  beforeAll(async () => {
    const entryPoint = getEntryPoint('0.7');
    const kernelVersion = KERNEL_V3_1;

    // 1. Create ECDSA validator from the EOA signer
    const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
      signer: _account,
      entryPoint,
      kernelVersion,
    });

    // 2. Create ZeroDev Kernel v3.1 smart account
    kernelAccount = await createKernelAccount(publicClient, {
      plugins: { sudo: ecdsaValidator },
      entryPoint,
      kernelVersion,
    });

    scaAddress = kernelAccount.address;

    // 3. Create Kernel account client backed by the ZeroDev bundler (no paymaster — account pays gas)
    kernelClient = createKernelAccountClient({
      account: kernelAccount,
      chain: baseSepolia,
      bundlerTransport: http(process.env.ZERODEV_BUNDLER_URL),
    });

    // 4. Ensure SCA has enough ETH for gas across the suite
    const ethBalance = await publicClient.getBalance({ address: scaAddress });
    if (ethBalance < ETH_GAS_FUND) {
      await fundWithEth(scaAddress, ETH_GAS_FUND);
    }

    // 5. Install the composability module if not already installed.
    //    Requires two registrations batched in a single UserOp:
    //    • FALLBACK (type 3) with selector-based initData
    //    • EXECUTOR (type 2) with empty initData
    const [fallbackInstalled, executorInstalled] = await Promise.all([
      publicClient.readContract({
        abi: ERC7579_ABI,
        address: scaAddress,
        functionName: 'isModuleInstalled',
        args: [FALLBACK_MODULE_TYPE, COMPOSABILITY_MODULE, '0x'],
      }),
      publicClient.readContract({
        abi: ERC7579_ABI,
        address: scaAddress,
        functionName: 'isModuleInstalled',
        args: [EXECUTOR_MODULE_TYPE, COMPOSABILITY_MODULE, '0x'],
      }),
    ]);

    if (!fallbackInstalled || !executorInstalled) {
      const calls: { to: Hex; value: bigint; data: Hex }[] = [];

      if (!fallbackInstalled) {
        calls.push({
          to: scaAddress as Hex,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC7579_ABI,
            functionName: 'installModule',
            args: [FALLBACK_MODULE_TYPE, COMPOSABILITY_MODULE, FALLBACK_INIT_DATA],
          }),
        });
      }

      if (!executorInstalled) {
        calls.push({
          to: scaAddress as Hex,
          value: 0n,
          data: encodeFunctionData({
            abi: ERC7579_ABI,
            functionName: 'installModule',
            args: [EXECUTOR_MODULE_TYPE, COMPOSABILITY_MODULE, EXECUTOR_INIT_DATA],
          }),
        });
      }

      const installHash = await kernelClient.sendUserOperation({
        callData: await kernelAccount.encodeCalls(calls),
      });

      await kernelClient.waitForUserOperationReceipt({ hash: installHash });
    }

    // 6. Confirm both module types are installed
    const [fallbackConfirmed, executorConfirmed] = await Promise.all([
      publicClient.readContract({
        abi: ERC7579_ABI,
        address: scaAddress,
        functionName: 'isModuleInstalled',
        args: [FALLBACK_MODULE_TYPE, COMPOSABILITY_MODULE, '0x'],
      }),
      publicClient.readContract({
        abi: ERC7579_ABI,
        address: scaAddress,
        functionName: 'isModuleInstalled',
        args: [EXECUTOR_MODULE_TYPE, COMPOSABILITY_MODULE, '0x'],
      }),
    ]);
    expect(fallbackConfirmed).toBe(true);
    expect(executorConfirmed).toBe(true);
  });

  it('pre-check → runtime sweep → post-check: composable batch via ZeroDev bundler', async () => {
    // Fund SCA with USDC for the sweep
    await fundWithUsdc(scaAddress, FUND_AMOUNT);

    const scaBalanceBefore = await usdcBalanceOf(scaAddress);
    expect(scaBalanceBefore).toBeGreaterThanOrEqual(FUND_AMOUNT);

    // Build composable batch using our SDK
    const batch = createComposableBatch(publicClient, scaAddress);
    const usdc = batch.erc20Token(USDC);

    batch.add([
      // Pre-condition: assert SCA holds at least FUND_AMOUNT before sweeping
      usdc.check({
        functionName: 'balanceOf',
        args: [scaAddress],
        constraint: { gte: FUND_AMOUNT },
      }),
      // Sweep: transfer the SCA's full runtime USDC balance to the EOA
      usdc.write({
        functionName: 'transfer',
        args: [_account.address, usdc.runtimeBalance()],
      }),
      // Post-condition: assert SCA balance is zero after the sweep
      usdc.check({
        functionName: 'balanceOf',
        args: [scaAddress],
        constraint: { eq: 0n },
      }),
    ]);

    expect(batch.length).toBe(3);

    // Send UserOp: pass batch.toCalldata() directly as the UserOp callData.
    // The SCA receives the executeComposable selector and routes it to the
    // composability module via its FALLBACK handler. The module then resolves
    // runtime values and calls back via executeFromExecutor for each sub-call.

    const userOpHash = await kernelClient.sendUserOperation({
      callData: await batch.toCalldata(),
    });

    await kernelClient.waitForUserOperationReceipt({ hash: userOpHash });

    // SCA should have been swept to zero
    const scaBalanceAfter = await usdcBalanceOf(scaAddress);
    expect(scaBalanceAfter).toEqual(0n);
  });
});
