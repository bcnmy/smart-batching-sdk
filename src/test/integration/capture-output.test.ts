/**
 * Integration — capture output params: execResult (single + multiple) and staticCall (single + multiple)
 *
 * Uses the StorageWriteExample deployed on Base Sepolia.
 * StorageWriteExample address (Base Sepolia): 0xEfDE41e2f93F2F0b231a010ddC35c9B8125f17bA
 *
 * ── Basic scenarios ──────────────────────────────────────────────────────────
 *
 * Test 1 — execResult single output:
 *   oneOutput(5) → result = 10 (1 uint256).
 *   Captured via execResult; storage.check asserts slot == 10 on-chain.
 *
 * Test 2 — execResult multiple outputs:
 *   multipleOutput(7, 3) → (sum=10, product=21, greater=true) (3 outputs).
 *   Stored at slot / slot+1 / slot+2.
 *   storage.check asserts slot == 10 on-chain.
 *
 * Test 3 — staticCall single output:
 *   oneOutput(1) as write trigger; staticCall capture on oneOutputStaticCall(4) → result=12.
 *   storage.check asserts slot == 12 on-chain.
 *
 * Test 4 — staticCall multiple outputs:
 *   oneOutput(1) as write trigger; staticCall capture on multipleOutputStaticCall(4)
 *   → (triple=12, quad=16, quint=20) (3 outputs).
 *   Stored at slot / slot+1 / slot+2.
 *   storage.check asserts slot == 12 on-chain.
 *
 * ── Advanced scenarios ───────────────────────────────────────────────────────
 *
 * Test 5 — two independent execResult captures in one batch:
 *   oneOutput(3) → key1 = 6.
 *   multipleOutput(5, 2) → key2 = 7 (sum), key2+1 = 10 (product), key2+2 = 1 (greater).
 *   Both checked on-chain with eq.
 *
 * Test 6 — execResult capture chained as runtime value:
 *   oneOutput(CAPTURE_INPUT) → captures CAPTURE_INPUT*2 into slot.
 *   storage.runtimeValue(slot) piped as the transfer amount → USDC sent from SCA to EOA.
 *   Demonstrates the full composability chain: call → capture → use.
 *
 * Test 7 — staticCall capture with range constraint (gte + lte via two check calls):
 *   oneOutputStaticCall(6) → result = 18.
 *   Two storage.check calls assert 10 ≤ 18 ≤ 20 on-chain.
 *
 * Test 8 — mixed execResult + staticCall in the same batch:
 *   oneOutput(8) → execResult → execKey = 16.
 *   oneOutput(1) → staticCall on oneOutputStaticCall(5) → staticKey = 15.
 *   Both checked on-chain.
 *
 * Test 9 — wrong constraint causes simulation to revert:
 *   oneOutput(5) → slot = 10, but storage.check asserts slot == 999 → revert.
 */

import { createComposableBatch } from '@biconomy/smart-batching';
import type { Abi, Address } from 'viem';
import { getAddress, parseUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { account, initNexus, publicClient } from '../utils';
import { STORAGE_WRITE_EXAMPLE_ABI } from './abi/storage-write-example';
import { fundWithUsdc, USDC, usdcBalanceOf } from './helpers';

if (!account) throw new Error('PRIVATE_KEY is not set in environment');

const _account = account;

const STORAGE_WRITE_EXAMPLE_CONTRACT = getAddress('0x6D3782b184F45A0EEd5C00644290fb2b87dBEE9E');

const SCA_MIN_BALANCE = parseUnits('0.5', 6); // top up SCA if it drops below this
const SCA_TARGET_BALANCE = parseUnits('1', 6); // top up SCA to this amount

// ---------------------------------------------------------------------------
// Shared Nexus state — initialised once for the whole suite
// ---------------------------------------------------------------------------

let scaAddress: Address;
let meeClient: Awaited<ReturnType<typeof initNexus>>['meeClient'];

// ---------------------------------------------------------------------------
// Top-up helper (specific to this suite's balance thresholds)
// ---------------------------------------------------------------------------

async function ensureScaBalance(): Promise<void> {
  const balance = await usdcBalanceOf(scaAddress);
  if (balance < SCA_MIN_BALANCE) {
    await fundWithUsdc(scaAddress, SCA_TARGET_BALANCE - balance);
  }
}

// ---------------------------------------------------------------------------
// Integration — capture output params (Base Sepolia)
// ---------------------------------------------------------------------------

describe('Integration — capture output params: execResult and staticCall (Base Sepolia)', () => {
  beforeAll(async () => {
    const nexus = await initNexus();
    scaAddress = nexus.scaAddress;
    meeClient = nexus.meeClient;

    // Ensure SCA starts with enough USDC to cover fees across the suite
    await ensureScaBalance();
  });

  beforeEach(async () => {
    // Top up SCA if fees from a previous test swept it below the minimum
    await ensureScaBalance();
  });

  // ── Basic: single/multiple execResult ──────────────────────────────────────

  it('execResult single output: oneOutput(5) → slot holds 10, verified on-chain', async () => {
    const batch = createComposableBatch(publicClient, scaAddress);
    const storage = batch.storage();
    const storageWriteExample = batch.contract(
      STORAGE_WRITE_EXAMPLE_CONTRACT,
      STORAGE_WRITE_EXAMPLE_ABI,
    );

    const storageKey = await storage.getStorageKey();

    // oneOutput(5) → result = 5 * 2 = 10
    const a = 5n;
    const expectedResult = a * 2n; // 10

    batch.add([
      // 1. Call oneOutput with execResult capture → result written to slot
      storageWriteExample.write({
        functionName: 'oneOutput',
        args: [a],
        capture: { type: 'execResult', storageKey },
      }),
      // 2. On-chain constraint: slot must equal the captured return value
      storage.check({ storageKey, constraint: { eq: expectedResult } }),
    ]);

    expect(batch.length).toBe(2);

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
  });

  it('execResult multiple outputs: multipleOutput(7, 3) → sum/product/greater across 3 slots', async () => {
    const batch = createComposableBatch(publicClient, scaAddress);
    const storage = batch.storage();
    const storageWriteExample = batch.contract(
      STORAGE_WRITE_EXAMPLE_CONTRACT,
      STORAGE_WRITE_EXAMPLE_ABI,
    );

    const storageKey = await storage.getStorageKey();

    // multipleOutput(7, 3) → (sum=10, product=21, greater=true)
    //   slotIndex 0 → 10  (sum)
    //   slotIndex 1 → 21  (product)
    //   slotIndex 2 → 1   (greater = true, zero-padded)
    const a = 7n;
    const b = 3n;
    const expectedSum = a + b; // 10
    const expectedProduct = a * b; // 21
    const expectedGreater = 1n; // true

    batch.add([
      // 1. Call multipleOutput with execResult capture → 3 values written at slotIndex 0/1/2
      storageWriteExample.write({
        functionName: 'multipleOutput',
        args: [a, b],
        capture: { type: 'execResult', storageKey },
      }),
      // 2. On-chain constraint: assert all three captured slots by index
      storage.check({ storageKey, constraint: { eq: expectedSum } }),
      storage.check({ storageKey, slotIndex: 1, constraint: { eq: expectedProduct } }),
      storage.check({ storageKey, slotIndex: 2, constraint: { eq: expectedGreater } }),
    ]);

    expect(batch.length).toBe(4);

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
  });

  // ── Basic: single/multiple staticCall ──────────────────────────────────────

  it('staticCall single output: oneOutputStaticCall(4) → slot holds 12, verified on-chain', async () => {
    const batch = createComposableBatch(publicClient, scaAddress);
    const storage = batch.storage();
    const storageWriteExample = batch.contract(
      STORAGE_WRITE_EXAMPLE_CONTRACT,
      STORAGE_WRITE_EXAMPLE_ABI,
    );

    const storageKey = await storage.getStorageKey();

    // oneOutputStaticCall(4) → result = 4 * 3 = 12
    const a = 4n;
    const expectedResult = a * 3n; // 12

    batch.add([
      // 1. Write trigger (oneOutput); staticCall capture on oneOutputStaticCall(4) → result written to slot
      storageWriteExample.write({
        functionName: 'oneOutput',
        args: [1n],
        capture: {
          type: 'staticCall',
          abi: STORAGE_WRITE_EXAMPLE_ABI as Abi,
          functionName: 'oneOutputStaticCall',
          targetAddress: STORAGE_WRITE_EXAMPLE_CONTRACT,
          args: [a],
          storageKey,
        },
      }),
      // 2. On-chain constraint: slot must equal the captured static call result
      storage.check({ storageKey, constraint: { eq: expectedResult } }),
    ]);

    expect(batch.length).toBe(2);

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
  });

  it('staticCall multiple outputs: multipleOutputStaticCall(4) → triple/quad/quint across 3 slots', async () => {
    const batch = createComposableBatch(publicClient, scaAddress);
    const storage = batch.storage();
    const storageWriteExample = batch.contract(
      STORAGE_WRITE_EXAMPLE_CONTRACT,
      STORAGE_WRITE_EXAMPLE_ABI,
    );

    const storageKey = await storage.getStorageKey();

    // multipleOutputStaticCall(4) → (triple=12, quad=16, quint=20)
    //   slotIndex 0 → 12  (triple)
    //   slotIndex 1 → 16  (quad)
    //   slotIndex 2 → 20  (quint)
    const a = 4n;
    const expectedTriple = a * 3n; // 12
    const expectedQuad = a * 4n; // 16
    const expectedQuint = a * 5n; // 20

    batch.add([
      // 1. Write trigger (oneOutput); staticCall capture on multipleOutputStaticCall(4)
      //    stores 3 values at slotIndex 0/1/2
      storageWriteExample.write({
        functionName: 'oneOutput',
        args: [1n],
        capture: {
          type: 'staticCall',
          abi: STORAGE_WRITE_EXAMPLE_ABI as Abi,
          functionName: 'multipleOutputStaticCall',
          targetAddress: STORAGE_WRITE_EXAMPLE_CONTRACT,
          args: [a],
          storageKey,
        },
      }),
      // 2. On-chain constraint: assert all three captured slots by index
      storage.check({ storageKey, constraint: { eq: expectedTriple } }),
      storage.check({ storageKey, slotIndex: 1, constraint: { eq: expectedQuad } }),
      storage.check({ storageKey, slotIndex: 2, constraint: { eq: expectedQuint } }),
    ]);

    expect(batch.length).toBe(4);

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
  });

  // ── Advanced: two independent captures in one batch ────────────────────────

  it('two execResult captures in one batch: oneOutput(3) and multipleOutput(5, 2) into independent slots', async () => {
    const batch = createComposableBatch(publicClient, scaAddress);
    const storage = batch.storage();
    const storageWriteExample = batch.contract(
      STORAGE_WRITE_EXAMPLE_CONTRACT,
      STORAGE_WRITE_EXAMPLE_ABI,
    );

    // Two independent storage keys — captures must not interfere with each other
    const key1 = await storage.getStorageKey();
    const key2 = await storage.getStorageKey();

    // oneOutput(3) → 6
    // multipleOutput(5, 2) → sum=7, product=10, greater=1 (5>2=true)
    const expectedSingle = 3n * 2n; // 6
    const expectedSum = 5n + 2n; // 7
    const expectedProduct = 5n * 2n; // 10
    const expectedGreater = 1n; // true

    batch.add([
      storageWriteExample.write({
        functionName: 'oneOutput',
        args: [3n],
        capture: { type: 'execResult', storageKey: key1 },
      }),
      storageWriteExample.write({
        functionName: 'multipleOutput',
        args: [5n, 2n],
        capture: { type: 'execResult', storageKey: key2 },
      }),
      // On-chain: key1 single slot + all three key2 slots independently constrained
      storage.check({ storageKey: key1, constraint: { eq: expectedSingle } }),
      storage.check({ storageKey: key2, constraint: { eq: expectedSum } }),
      storage.check({ storageKey: key2, slotIndex: 1, constraint: { eq: expectedProduct } }),
      storage.check({ storageKey: key2, slotIndex: 2, constraint: { eq: expectedGreater } }),
    ]);

    expect(batch.length).toBe(6);

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
  });

  // ── Advanced: capture chained as runtime value ─────────────────────────────

  it('execResult capture chained as runtime value: captured amount used as USDC transfer to EOA', async () => {
    // oneOutput(CAPTURE_INPUT) → CAPTURE_INPUT * 2; that result becomes the transfer amount.
    // Fund the extra transfer amount on top of the base SCA balance ensured by beforeEach.
    const CAPTURE_INPUT = parseUnits('0.25', 6); // 250_000 μUSDC
    const EXPECTED_CAPTURE = CAPTURE_INPUT * 2n; // 500_000 μUSDC (0.5 USDC)
    await fundWithUsdc(scaAddress, EXPECTED_CAPTURE);

    const batch = createComposableBatch(publicClient, scaAddress);
    const storage = batch.storage();
    const storageWriteExample = batch.contract(
      STORAGE_WRITE_EXAMPLE_CONTRACT,
      STORAGE_WRITE_EXAMPLE_ABI,
    );
    const usdc = batch.erc20Token(USDC);

    const storageKey = await storage.getStorageKey();

    batch.add([
      // 1. Call oneOutput(CAPTURE_INPUT) → result = CAPTURE_INPUT*2 written to slot
      storageWriteExample.write({
        functionName: 'oneOutput',
        args: [CAPTURE_INPUT],
        capture: { type: 'execResult', storageKey },
      }),
      // 2. On-chain: assert the slot holds the expected captured value
      storage.check({ storageKey, constraint: { eq: EXPECTED_CAPTURE } }),
      // 3. Transfer the runtime-resolved slot value (EXPECTED_CAPTURE) from SCA to EOA
      usdc.write({
        functionName: 'transfer',
        args: [_account.address, await storage.runtimeValue({ storageKey })],
      }),
    ]);

    expect(batch.length).toBe(3);

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
  });

  // ── Advanced: range constraints (gte + lte) ────────────────────────────────

  it('staticCall capture with range constraint: oneOutputStaticCall(6) → 18 asserted within [10, 20]', async () => {
    const batch = createComposableBatch(publicClient, scaAddress);
    const storage = batch.storage();
    const storageWriteExample = batch.contract(
      STORAGE_WRITE_EXAMPLE_CONTRACT,
      STORAGE_WRITE_EXAMPLE_ABI,
    );

    const storageKey = await storage.getStorageKey();

    // oneOutputStaticCall(6) → result = 6 * 3 = 18
    const a = 6n;

    batch.add([
      // Write trigger + staticCall capture → 18 written to slot
      storageWriteExample.write({
        functionName: 'oneOutput',
        args: [1n],
        capture: {
          type: 'staticCall',
          abi: STORAGE_WRITE_EXAMPLE_ABI as Abi,
          functionName: 'oneOutputStaticCall',
          targetAddress: STORAGE_WRITE_EXAMPLE_CONTRACT,
          args: [a],
          storageKey,
        },
      }),

      storage.check({ storageKey, constraint: { gte: 10n } }),
      storage.check({ storageKey, constraint: { lte: 20n } }),
    ]);

    expect(batch.length).toBe(3);

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
  });

  // ── Advanced: mixed execResult + staticCall in the same batch ──────────────

  it('mixed captures: execResult and staticCall in the same batch writing to separate slots', async () => {
    const batch = createComposableBatch(publicClient, scaAddress);
    const storage = batch.storage();
    const storageWriteExample = batch.contract(
      STORAGE_WRITE_EXAMPLE_CONTRACT,
      STORAGE_WRITE_EXAMPLE_ABI,
    );

    const execKey = await storage.getStorageKey();
    const staticKey = await storage.getStorageKey();

    // oneOutput(8) → execResult → execKey = 16
    const execInput = 8n;
    const expectedExecResult = execInput * 2n; // 16

    // oneOutputStaticCall(5) → staticCall → staticKey = 15
    const staticInput = 5n;
    const expectedStaticResult = staticInput * 3n; // 15

    batch.add([
      // execResult capture into execKey
      storageWriteExample.write({
        functionName: 'oneOutput',
        args: [execInput],
        capture: { type: 'execResult', storageKey: execKey },
      }),
      // staticCall capture into staticKey (write trigger: oneOutput(1), capture: oneOutputStaticCall(5))
      storageWriteExample.write({
        functionName: 'oneOutput',
        args: [1n],
        capture: {
          type: 'staticCall',
          abi: STORAGE_WRITE_EXAMPLE_ABI as Abi,
          functionName: 'oneOutputStaticCall',
          targetAddress: STORAGE_WRITE_EXAMPLE_CONTRACT,
          args: [staticInput],
          storageKey: staticKey,
        },
      }),
      // On-chain: both slots independently verified
      storage.check({ storageKey: execKey, constraint: { eq: expectedExecResult } }),
      storage.check({ storageKey: staticKey, constraint: { eq: expectedStaticResult } }),
    ]);

    expect(batch.length).toBe(4);

    const quote = await meeClient.getQuote({
      instructions: [{ calls: await batch.toCalls(), chainId: baseSepolia.id, isComposable: true }],
      simulation: { simulate: true },
      feeToken: { address: USDC, chainId: baseSepolia.id },
    });

    const { hash } = await meeClient.executeQuote({ quote });
    await meeClient.waitForSupertransactionReceipt({ hash });
  });

  // ── Advanced: wrong constraint causes simulation to revert ─────────────────

  it('wrong constraint reverts simulation: oneOutput(5) → slot=10, but eq(999) fails', async () => {
    const batch = createComposableBatch(publicClient, scaAddress);
    const storage = batch.storage();
    const storageWriteExample = batch.contract(
      STORAGE_WRITE_EXAMPLE_CONTRACT,
      STORAGE_WRITE_EXAMPLE_ABI,
    );

    const storageKey = await storage.getStorageKey();

    batch.add([
      // oneOutput(5) → slot = 10
      storageWriteExample.write({
        functionName: 'oneOutput',
        args: [5n],
        capture: { type: 'execResult', storageKey },
      }),
      // Wrong expectation: slot holds 10 but we assert 999 → on-chain revert
      storage.check({ storageKey, constraint: { eq: 999n } }),
    ]);

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
});
