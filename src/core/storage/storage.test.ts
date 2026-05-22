import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { publicClient } from '../../test/utils';
import { InputParamFetcherType, InputParamType } from '../encoding';
import { NAMESPACE_STORAGE_CONTRACT_ADDRESS } from './constants';
import { getStorageNamespace, getStorageSlot } from './slot';
import { createStorage } from './storage';

// Arbitrary stable addresses used as account / caller throughout tests
const ACCOUNT = getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'); // vitalik.eth
const CALLER = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'); // USDC Base Sepolia

// ---------------------------------------------------------------------------
// getStorageNamespace — pure helper
// ---------------------------------------------------------------------------

describe('getStorageNamespace', () => {
  it('returns a 32-byte hex string', () => {
    const ns = getStorageNamespace(ACCOUNT, CALLER);
    expect(ns).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    expect(getStorageNamespace(ACCOUNT, CALLER)).toBe(getStorageNamespace(ACCOUNT, CALLER));
  });

  it('differs when accountAddress changes', () => {
    const other = getAddress('0x4200000000000000000000000000000000000006');
    expect(getStorageNamespace(ACCOUNT, CALLER)).not.toBe(getStorageNamespace(other, CALLER));
  });

  it('differs when callerAddress changes', () => {
    const other = getAddress('0x4200000000000000000000000000000000000006');
    expect(getStorageNamespace(ACCOUNT, CALLER)).not.toBe(getStorageNamespace(ACCOUNT, other));
  });

  it('is not symmetric — (a,b) ≠ (b,a)', () => {
    expect(getStorageNamespace(ACCOUNT, CALLER)).not.toBe(getStorageNamespace(CALLER, ACCOUNT));
  });
});

// ---------------------------------------------------------------------------
// getStorageSlot — async helper
// ---------------------------------------------------------------------------

describe('getStorageSlot', () => {
  it('returns a 32-byte hex string', async () => {
    const slot = await getStorageSlot(ACCOUNT, CALLER, 1n);
    expect(slot).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('is deterministic for the same explicit storageKey', async () => {
    const [a, b] = await Promise.all([
      getStorageSlot(ACCOUNT, CALLER, 42n),
      getStorageSlot(ACCOUNT, CALLER, 42n),
    ]);
    expect(a).toBe(b);
  });

  it('produces different slots for different explicit storageKeys', async () => {
    const [a, b] = await Promise.all([
      getStorageSlot(ACCOUNT, CALLER, 1n),
      getStorageSlot(ACCOUNT, CALLER, 2n),
    ]);
    expect(a).not.toBe(b);
  });

  it('produces different slots for different account addresses', async () => {
    const other = getAddress('0x4200000000000000000000000000000000000006');
    const [a, b] = await Promise.all([
      getStorageSlot(ACCOUNT, CALLER, 1n),
      getStorageSlot(other, CALLER, 1n),
    ]);
    expect(a).not.toBe(b);
  });

  it('auto-generates unique keys on successive calls without explicit storageKey', async () => {
    const a = await getStorageSlot(ACCOUNT, CALLER);
    const b = await getStorageSlot(ACCOUNT, CALLER);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// storage instance — construction
// ---------------------------------------------------------------------------

describe('storage — instance construction', () => {
  it('stores the correct accountAddress', () => {
    const instance = createStorage(publicClient, ACCOUNT);
    expect(instance.accountAddress).toBe(ACCOUNT);
  });
});

// ---------------------------------------------------------------------------
// storage — getStorageKey
// ---------------------------------------------------------------------------

describe('storage — getStorageKey', () => {
  const instance = createStorage(publicClient, ACCOUNT);

  it('returns a bigint', async () => {
    const key = await instance.getStorageKey();
    expect(typeof key).toBe('bigint');
  });

  it('returns successive unique keys on repeated calls', async () => {
    const a = await instance.getStorageKey();
    const b = await instance.getStorageKey();
    expect(a).not.toBe(b);
  });

  it('accepts explicit accountAddress and callerAddress overrides', async () => {
    const key = await instance.getStorageKey({ accountAddress: CALLER, callerAddress: ACCOUNT });
    expect(typeof key).toBe('bigint');
  });
});

// ---------------------------------------------------------------------------
// storage — write
// ---------------------------------------------------------------------------

describe('storage — write', () => {
  const instance = createStorage(publicClient, ACCOUNT);

  it('returns a ComposableCall with a functionSig', async () => {
    const call = await instance.write({ value: 12345n, storageKey: 1n });
    expect(typeof call.functionSig).toBe('string');
    expect(call.functionSig).toMatch(/^0x[0-9a-fA-F]{8}$/);
  });

  it('encodes the writeStorage function selector', async () => {
    const call = await instance.write({ value: 1n, storageKey: 1n });
    // keccak256("writeStorage(bytes32,bytes32,address)") first 4 bytes
    expect(call.functionSig).toBe('0xa39e0787');
  });

  it('outputParams is empty', async () => {
    const call = await instance.write({ value: 42n, storageKey: 1n });
    expect(call.outputParams).toHaveLength(0);
  });

  it('inputParams includes a TARGET param with the storage contract address', async () => {
    const call = await instance.write({ value: 1n, storageKey: 1n });
    const targetParam = call.inputParams.find((p) => p.paramType === InputParamType.TARGET);
    expect(targetParam).toBeDefined();
    expect(targetParam?.paramData.toLowerCase()).toContain(
      NAMESPACE_STORAGE_CONTRACT_ADDRESS.slice(2).toLowerCase(),
    );
  });

  it('inputParams includes a CALL_DATA param', async () => {
    const call = await instance.write({ value: 1n, storageKey: 1n });
    const calldataParam = call.inputParams.find((p) => p.paramType === InputParamType.CALL_DATA);
    expect(calldataParam).toBeDefined();
  });

  it('is deterministic for the same explicit storageKey and value', async () => {
    const [a, b] = await Promise.all([
      instance.write({ value: 99n, storageKey: 7n }),
      instance.write({ value: 99n, storageKey: 7n }),
    ]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces different calldata for different values', async () => {
    const [a, b] = await Promise.all([
      instance.write({ value: 1n, storageKey: 1n }),
      instance.write({ value: 2n, storageKey: 1n }),
    ]);
    expect(JSON.stringify(a.inputParams)).not.toBe(JSON.stringify(b.inputParams));
  });

  it('produces different calldata for different storageKeys', async () => {
    const [a, b] = await Promise.all([
      instance.write({ value: 1n, storageKey: 1n }),
      instance.write({ value: 1n, storageKey: 2n }),
    ]);
    expect(JSON.stringify(a.inputParams)).not.toBe(JSON.stringify(b.inputParams));
  });

  it('accepts a boolean value', async () => {
    const call = await instance.write({ value: true, storageKey: 1n });
    expect(call.functionSig).toBeDefined();
  });

  it('accepts an address value', async () => {
    const call = await instance.write({ value: ACCOUNT, storageKey: 1n });
    expect(call.functionSig).toBeDefined();
  });

  it('respects callerAddress override — uses it as the slot namespace', async () => {
    const [a, b] = await Promise.all([
      instance.write({ value: 1n, storageKey: 1n, callerAddress: ACCOUNT }),
      instance.write({ value: 1n, storageKey: 1n, callerAddress: CALLER }),
    ]);
    expect(JSON.stringify(a.inputParams)).not.toBe(JSON.stringify(b.inputParams));
  });
});

// ---------------------------------------------------------------------------
// storage — runtimeValue
// ---------------------------------------------------------------------------

describe('storage — runtimeValue', () => {
  const instance = createStorage(publicClient, ACCOUNT);

  it('returns a RuntimeValue with isRuntime=true', async () => {
    const rv = await instance.runtimeValue({ storageKey: 1n });
    expect(rv.isRuntime).toBe(true);
  });

  it('has exactly one inputParam with STATIC_CALL fetcherType', async () => {
    const rv = await instance.runtimeValue({ storageKey: 1n });
    expect(rv.inputParams).toHaveLength(1);
    expect(rv.inputParams[0].fetcherType).toBe(InputParamFetcherType.STATIC_CALL);
  });

  it('encodes the namespace storage contract address in paramData', async () => {
    const rv = await instance.runtimeValue({ storageKey: 1n });
    expect(rv.inputParams[0].paramData.toLowerCase()).toContain(
      NAMESPACE_STORAGE_CONTRACT_ADDRESS.slice(2).toLowerCase(),
    );
  });

  it('outputParams is empty', async () => {
    const rv = await instance.runtimeValue({ storageKey: 1n });
    expect(rv.outputParams).toHaveLength(0);
  });

  it('no constraints defaults to empty constraints array', async () => {
    const rv = await instance.runtimeValue({ storageKey: 1n });
    expect(rv.inputParams[0].constraints).toHaveLength(0);
  });

  it('gte constraint is applied', async () => {
    const rv = await instance.runtimeValue({ storageKey: 1n, constraints: [{ gte: 0n }] });
    expect(rv.inputParams[0].constraints).toHaveLength(1);
  });

  it('multiple constraints are all applied', async () => {
    const rv = await instance.runtimeValue({
      storageKey: 1n,
      constraints: [{ gte: 1n }, { lte: 100n }],
    });
    expect(rv.inputParams[0].constraints).toHaveLength(2);
  });

  it('constraints do not affect paramData', async () => {
    const [withConstraint, withoutConstraint] = await Promise.all([
      instance.runtimeValue({ storageKey: 1n, constraints: [{ gte: 99n }] }),
      instance.runtimeValue({ storageKey: 1n }),
    ]);
    expect(withConstraint.inputParams[0].paramData).toBe(
      withoutConstraint.inputParams[0].paramData,
    );
  });

  it('different storageKeys produce different paramData', async () => {
    const [a, b] = await Promise.all([
      instance.runtimeValue({ storageKey: 1n }),
      instance.runtimeValue({ storageKey: 2n }),
    ]);
    expect(a.inputParams[0].paramData).not.toBe(b.inputParams[0].paramData);
  });

  it('is deterministic for the same explicit storageKey', async () => {
    const [a, b] = await Promise.all([
      instance.runtimeValue({ storageKey: 5n }),
      instance.runtimeValue({ storageKey: 5n }),
    ]);
    expect(a.inputParams[0].paramData).toBe(b.inputParams[0].paramData);
  });
});

// ---------------------------------------------------------------------------
// storage — check
// ---------------------------------------------------------------------------

describe('storage — check', () => {
  const instance = createStorage(publicClient, ACCOUNT);

  it('returns a ComposableCall with a functionSig', async () => {
    const call = await instance.check({ constraints: [{ gte: 0n }], storageKey: 1n });
    expect(typeof call.functionSig).toBe('string');
    expect(call.functionSig.length).toBeGreaterThan(0);
  });

  it('outputParams is empty', async () => {
    const call = await instance.check({ constraints: [{ gte: 0n }], storageKey: 1n });
    expect(call.outputParams).toHaveLength(0);
  });

  it('inputParams contains a STATIC_CALL param', async () => {
    const call = await instance.check({ constraints: [{ gte: 0n }], storageKey: 1n });
    const staticCallParam = call.inputParams.find(
      (p) => p.fetcherType === InputParamFetcherType.STATIC_CALL,
    );
    expect(staticCallParam).toBeDefined();
  });

  it('one constraint is applied to the STATIC_CALL param', async () => {
    const call = await instance.check({ constraints: [{ gte: 1000n }], storageKey: 1n });
    const staticCallParam = call.inputParams.find(
      (p) => p.fetcherType === InputParamFetcherType.STATIC_CALL,
    );
    expect(staticCallParam?.constraints).toHaveLength(1);
  });

  it('multiple constraints are all applied', async () => {
    const call = await instance.check({
      constraints: [{ gte: 1n }, { lte: 100n }],
      storageKey: 1n,
    });
    const staticCallParam = call.inputParams.find(
      (p) => p.fetcherType === InputParamFetcherType.STATIC_CALL,
    );
    expect(staticCallParam?.constraints).toHaveLength(2);
  });

  it('constraints do not affect paramData of the STATIC_CALL param', async () => {
    const [a, b] = await Promise.all([
      instance.check({ constraints: [{ gte: 999n }], storageKey: 1n }),
      instance.check({ constraints: [{ lte: 1n }], storageKey: 1n }),
    ]);
    const staticA = a.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    const staticB = b.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    expect(staticA?.paramData).toBe(staticB?.paramData);
  });

  it('different storageKeys produce different paramData', async () => {
    const [a, b] = await Promise.all([
      instance.check({ constraints: [{ gte: 0n }], storageKey: 1n }),
      instance.check({ constraints: [{ gte: 0n }], storageKey: 2n }),
    ]);
    const staticA = a.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    const staticB = b.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    expect(staticA?.paramData).not.toBe(staticB?.paramData);
  });

  it('is deterministic for the same explicit storageKey and constraints', async () => {
    const [a, b] = await Promise.all([
      instance.check({ constraints: [{ eq: 42n }], storageKey: 3n }),
      instance.check({ constraints: [{ eq: 42n }], storageKey: 3n }),
    ]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
