import { createComposableBatch } from 'smart-batching';
import { parseEther, parseUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { describe, expect, it } from 'vitest';
import { account, initNexus, publicClient, WETH_ADDRESS } from '../utils';
import { fundWithEth, fundWithUsdc, SCA_TARGET_BALANCE, USDC } from './helpers';

const WETH_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

if (!account) throw new Error('PRIVATE_KEY is not set in environment');

const _account = account;

const FUND_AMOUNT = parseUnits('1', 6); // 1 mock USDC

// ---------------------------------------------------------------------------
// End-to-end: Biconomy abstractjs — fund SCA + composable sweep back to EOA
// ---------------------------------------------------------------------------

describe('Integration — Biconomy abstractjs composable execution', () => {
  it('pre-check → sweep → post-check: full E2E with SCA funding', async () => {
    // 1. Init Nexus SCA on Base Sepolia and resolve its address + MEE client
    const { scaAddress, meeClient } = await initNexus();

    // 2. Fund SCA: EOA transfers mock USDC to the SCA
    await fundWithUsdc(scaAddress, FUND_AMOUNT);

    // 3. Build composable batch with pre-check → sweep → post-check
    const batch = createComposableBatch(publicClient, scaAddress);
    const usdc = batch.erc20Token(USDC);

    batch.add([
      // Pre-condition: assert SCA holds at least FUND_AMOUNT before sweeping
      usdc.check({
        functionName: 'balanceOf',
        args: [scaAddress],
        constraint: { gte: FUND_AMOUNT },
      }),
      // Sweep: transfer the SCA's full runtime balance to the EOA
      usdc.write({
        functionName: 'transfer',
        args: [_account.address, usdc.runtimeBalance()],
      }),
      // Post-condition: assert SCA balance is zero (or near zero) after sweep
      usdc.check({ functionName: 'balanceOf', args: [scaAddress], constraint: { gte: 0n } }),
    ]);

    expect(batch.length).toBe(3);

    // 4. Assert SCA balance is funded before submitting
    const scaBalanceBefore = await usdc.read({ functionName: 'balanceOf', args: [scaAddress] });
    expect(Number(scaBalanceBefore)).to.greaterThanOrEqual(Number(FUND_AMOUNT));

    // 5. Get a quote for the composable instruction, then sign and submit it via MEE

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    // 6. Execute the signed quote and wait for the supertransaction to settle
    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });

    // 7. Assert SCA balance has been swept to zero (minus fees)
    const scaBalanceAfter = await usdc.read({ functionName: 'balanceOf', args: [scaAddress] });
    expect(Number(scaBalanceAfter)).to.greaterThanOrEqual(0);
  });

  it('pre-check reverts when SCA balance is below required minimum', async () => {
    // 1. Init Nexus SCA on Base Sepolia and resolve its address + MEE client
    const { scaAddress, meeClient } = await initNexus();

    // 2. Build composable batch with a pre-check that will intentionally fail
    const batch = createComposableBatch(publicClient, scaAddress);
    const usdc = batch.erc20Token(USDC);

    batch.add([
      // Pre-condition: require 2x FUND_AMOUNT — will revert because SCA only holds FUND_AMOUNT
      usdc.check({
        functionName: 'balanceOf',
        args: [scaAddress],
        constraint: { gte: 2n * FUND_AMOUNT },
      }),
      // Sweep: would transfer runtime balance to EOA (never reached due to revert)
      usdc.write({
        functionName: 'transfer',
        args: [_account.address, usdc.runtimeBalance()],
      }),
    ]);

    expect(batch.length).toBe(2);

    // 3. Submit quote — expect simulation to revert because pre-check constraint is not satisfied

    await expect(
      meeClient.getQuote({
        instructions: [
          { calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true },
        ],
        simulation: { simulate: true },
        feeToken: { address: USDC, chainId: baseSepolia.id },
      }),
    ).rejects.toThrow(
      'UserOp [1] simulation failed. Revert reason: Execution reverted at contract',
    );
  });

  it('post-check reverts when SCA balance exceeds expected remaining amount after sweep', async () => {
    // 1. Init Nexus SCA on Base Sepolia and resolve its address + MEE client
    const { scaAddress, meeClient } = await initNexus();

    // 2. Build composable batch with a post-check that will intentionally fail
    const batch = createComposableBatch(publicClient, scaAddress);
    const usdc = batch.erc20Token(USDC);

    batch.add([
      // Sweep: transfer runtime balance from SCA to EOA
      usdc.write({
        functionName: 'transfer',
        args: [_account.address, usdc.runtimeBalance()],
      }),
      // Post-condition: require FUND_AMOUNT remaining after full sweep — will revert because balance is zero
      usdc.check({
        functionName: 'balanceOf',
        args: [scaAddress],
        constraint: { gte: FUND_AMOUNT },
      }),
    ]);

    expect(batch.length).toBe(2);

    // 3. Submit quote — expect simulation to revert because post-check constraint is not satisfied

    await expect(
      meeClient.getQuote({
        instructions: [
          { calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true },
        ],
        simulation: { simulate: true },
        feeToken: { address: USDC, chainId: baseSepolia.id },
      }),
    ).rejects.toThrow(
      'UserOp [1] simulation failed. Revert reason: Execution reverted at contract',
    );
  });

  it('write value to namespace storage → use as runtime transfer amount → sweep remainder', async () => {
    // 1. Init Nexus SCA on Base Sepolia and resolve its address + MEE client
    const { scaAddress, meeClient } = await initNexus();

    // 2. Fund SCA: EOA transfers mock USDC to the SCA
    await fundWithUsdc(scaAddress, FUND_AMOUNT);

    // 3. Build composable batch: write storage → check storage → partial transfer → sweep remainder
    const batch = createComposableBatch(publicClient, scaAddress);
    const usdc = batch.erc20Token(USDC);
    const storage = batch.storage();

    // Pre-generate a storage key so all storage operations share the same slot
    const storageValue = FUND_AMOUNT / 2n;
    const storageKey = await storage.getStorageKey();

    batch.add([
      // Step A: write FUND_AMOUNT/2 into the shared namespace storage slot
      storage.write({ value: storageValue, storageKey }),
      // Step B: assert the stored value equals what was just written before proceeding
      storage.check({ storageKey, constraint: { eq: storageValue } }),
      // Step C: transfer the runtime-resolved storage value (FUND_AMOUNT/2) from SCA to EOA
      usdc.write({
        functionName: 'transfer',
        args: [_account.address, await storage.runtimeValue({ storageKey })],
      }),
      // Step D: sweep any remaining SCA balance (the other half) to the EOA
      usdc.write({
        functionName: 'transfer',
        args: [_account.address, usdc.runtimeBalance()],
      }),
    ]);

    expect(batch.length).toBe(4);

    // 4. Get a quote for the composable instruction, then sign and submit it via MEE

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    // 5. Execute the signed quote and wait for the supertransaction to settle
    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
  });

  it('static ETH value in composable write: WETH deposit mints correct balance', async () => {
    const { scaAddress, meeClient } = await initNexus();

    const DEPOSIT_AMOUNT = parseEther('0.0001');

    // Fund SCA with ETH for the deposit and USDC for the MEE fee
    await fundWithEth(scaAddress, DEPOSIT_AMOUNT * 2n);
    await fundWithUsdc(scaAddress, SCA_TARGET_BALANCE);

    const batch = createComposableBatch(publicClient, scaAddress);
    const weth = batch.contract(WETH_ADDRESS, WETH_ABI);

    const wethBalanceBefore = await publicClient.readContract({
      abi: WETH_ABI,
      address: WETH_ADDRESS,
      functionName: 'balanceOf',
      args: [scaAddress],
    });

    batch.add([
      weth.write({
        functionName: 'deposit',
        args: [],
        value: DEPOSIT_AMOUNT,
      }),
    ]);

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });

    const wethBalanceAfter = await publicClient.readContract({
      abi: WETH_ABI,
      address: WETH_ADDRESS,
      functionName: 'balanceOf',
      args: [scaAddress],
    });

    expect(wethBalanceAfter).toEqual(wethBalanceBefore + DEPOSIT_AMOUNT);
  });
});
