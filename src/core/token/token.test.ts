import type { Abi } from 'viem';
import { erc20Abi, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { STORAGE_WRITE_EXAMPLE_ABI } from '../../test/integration/abi/storage-write-example';
import { publicClient } from '../../test/utils';
import { InputParamFetcherType, OutputParamFetcherType } from '../encoding';
import { NAMESPACE_STORAGE_CONTRACT_ADDRESS } from '../storage/constants';
import { createERC20Token, createNativeToken } from './token';

// The count is the first 32 bytes of the ABI-encoded paramData (uint256, big-endian).
function decodeOutputCount(paramData: string): number {
  const countHex = paramData.slice(2, 66);
  return Number(BigInt(`0x${countHex}`));
}

const ACCOUNT = getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
const STORAGE_WRITE_EXAMPLE_CONTRACT = getAddress('0xEfDE41e2f93F2F0b231a010ddC35c9B8125f17bA');

// Well-known Base Sepolia token addresses
const USDC_ADDRESS = getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
const WETH_ADDRESS = getAddress('0x4200000000000000000000000000000000000006');

// Base Sepolia Uniswap V3 router — known to have a USDC allowance set
const UNISWAP_V3_ROUTER = getAddress('0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4');

// WETH contract itself always holds ETH (it IS the wrapped ETH)
const WETH_CONTRACT = WETH_ADDRESS;

// ---------------------------------------------------------------------------
// ERC20Token — USDC
// ---------------------------------------------------------------------------

describe('ERC20Token — USDC (Base Sepolia)', () => {
  const usdc = createERC20Token(publicClient, USDC_ADDRESS);

  it('stores the correct address', () => {
    expect(usdc.address).toBe(USDC_ADDRESS);
  });

  it('read(symbol) returns "USDC"', async () => {
    const symbol = await usdc.read({ functionName: 'symbol', args: [] });
    expect(symbol).toBe('USDC');
  });

  it('read(decimals) returns 6', async () => {
    const decimals = await usdc.read({ functionName: 'decimals', args: [] });
    expect(decimals).toBe(6);
  });

  it('read(totalSupply) returns a positive bigint', async () => {
    const supply = await usdc.read({ functionName: 'totalSupply', args: [] });
    expect(typeof supply).toBe('bigint');
    expect(supply > 0n).toBe(true);
  });

  it('read(balanceOf) returns a bigint for any address', async () => {
    const balance = await usdc.read({ functionName: 'balanceOf', args: [UNISWAP_V3_ROUTER] });
    expect(typeof balance).toBe('bigint');
  });

  it('read(allowance) returns a bigint for any owner + spender pair', async () => {
    const allowance = await usdc.read({
      functionName: 'allowance',
      args: [USDC_ADDRESS, UNISWAP_V3_ROUTER],
    });
    expect(typeof allowance).toBe('bigint');
  });
});

// ---------------------------------------------------------------------------
// ERC20Token — WETH
// ---------------------------------------------------------------------------

describe('ERC20Token — WETH (Base Sepolia)', () => {
  const weth = createERC20Token(publicClient, WETH_ADDRESS);

  it('read(symbol) returns "WETH"', async () => {
    const symbol = await weth.read({ functionName: 'symbol', args: [] });
    expect(symbol).toBe('WETH');
  });

  it('read(decimals) returns 18', async () => {
    const decimals = await weth.read({ functionName: 'decimals', args: [] });
    expect(decimals).toBe(18);
  });

  it('read(totalSupply) returns a bigint', async () => {
    const supply = await weth.read({ functionName: 'totalSupply', args: [] });
    expect(typeof supply).toBe('bigint');
  });
});

// ---------------------------------------------------------------------------
// NativeToken
// ---------------------------------------------------------------------------

describe('NativeToken (Base Sepolia)', () => {
  const native = createNativeToken(publicClient);

  it('balance returns a bigint', async () => {
    const balance = await native.balance({ address: WETH_CONTRACT });
    expect(typeof balance).toBe('bigint');
  });

  it('balance of the WETH contract is positive', async () => {
    // The WETH contract always holds ETH equal to its totalSupply
    const balance = await native.balance({ address: WETH_CONTRACT });
    expect(balance > 0n).toBe(true);
  });

  it('runtimeBalance returns a RuntimeValue with isRuntime=true', () => {
    const rv = native.runtimeBalance({ address: WETH_CONTRACT });
    expect(rv.isRuntime).toBe(true);
  });

  it('runtimeBalance uses BALANCE fetcherType', () => {
    const rv = native.runtimeBalance({ address: WETH_CONTRACT });
    expect(rv.inputParams).toHaveLength(1);
    expect(rv.inputParams[0].fetcherType).toBe(InputParamFetcherType.BALANCE);
  });

  it('runtimeBalance encodes the target address in paramData', () => {
    const rv = native.runtimeBalance({ address: WETH_CONTRACT });
    expect(rv.inputParams[0].paramData.toLowerCase()).toContain(
      WETH_CONTRACT.slice(2).toLowerCase(),
    );
  });

  it('runtimeBalance produces different paramData for different targets', () => {
    const a = native.runtimeBalance({ address: WETH_CONTRACT });
    const b = native.runtimeBalance({ address: UNISWAP_V3_ROUTER });
    expect(a.inputParams[0].paramData).not.toBe(b.inputParams[0].paramData);
  });
});

// ---------------------------------------------------------------------------
// ERC20Token — runtimeBalance
// ---------------------------------------------------------------------------

describe('ERC20Token — runtimeBalance (USDC)', () => {
  const usdc = createERC20Token(publicClient, USDC_ADDRESS);

  it('runtimeBalance returns a RuntimeValue with isRuntime=true', () => {
    const rv = usdc.runtimeBalance({ owner: UNISWAP_V3_ROUTER });
    expect(rv.isRuntime).toBe(true);
  });

  it('runtimeBalance uses BALANCE fetcherType', () => {
    const rv = usdc.runtimeBalance({ owner: UNISWAP_V3_ROUTER });
    expect(rv.inputParams).toHaveLength(1);
    expect(rv.inputParams[0].fetcherType).toBe(InputParamFetcherType.BALANCE);
  });

  it('runtimeBalance encodes the token address in paramData', () => {
    const rv = usdc.runtimeBalance({ owner: UNISWAP_V3_ROUTER });
    // paramData is encodePacked([tokenAddress, targetAddress])
    expect(rv.inputParams[0].paramData.toLowerCase()).toContain(
      USDC_ADDRESS.slice(2).toLowerCase(),
    );
  });

  it('runtimeBalance encodes the owner address in paramData', () => {
    const rv = usdc.runtimeBalance({ owner: UNISWAP_V3_ROUTER });
    expect(rv.inputParams[0].paramData.toLowerCase()).toContain(
      UNISWAP_V3_ROUTER.slice(2).toLowerCase(),
    );
  });

  it('runtimeBalance produces different paramData for different owners', () => {
    const a = usdc.runtimeBalance({ owner: UNISWAP_V3_ROUTER });
    const b = usdc.runtimeBalance({ owner: WETH_ADDRESS });
    expect(a.inputParams[0].paramData).not.toBe(b.inputParams[0].paramData);
  });

  it('runtimeBalance on WETH uses WETH as token address in paramData', () => {
    const weth = createERC20Token(publicClient, WETH_ADDRESS);
    const rv = weth.runtimeBalance({ owner: UNISWAP_V3_ROUTER });
    expect(rv.inputParams[0].paramData.toLowerCase()).toContain(
      WETH_ADDRESS.slice(2).toLowerCase(),
    );
  });
});

// ---------------------------------------------------------------------------
// ERC20Token — runtimeAllowance
// ---------------------------------------------------------------------------

describe('ERC20Token — runtimeAllowance (USDC)', () => {
  const usdc = createERC20Token(publicClient, USDC_ADDRESS);

  it('runtimeAllowance returns a RuntimeValue with isRuntime=true', () => {
    const rv = usdc.runtimeAllowance({ spender: UNISWAP_V3_ROUTER, owner: WETH_ADDRESS });
    expect(rv.isRuntime).toBe(true);
  });

  it('runtimeAllowance uses STATIC_CALL fetcherType', () => {
    const rv = usdc.runtimeAllowance({ spender: UNISWAP_V3_ROUTER, owner: WETH_ADDRESS });
    expect(rv.inputParams).toHaveLength(1);
    expect(rv.inputParams[0].fetcherType).toBe(InputParamFetcherType.STATIC_CALL);
  });

  it('runtimeAllowance encodes the token address in paramData', () => {
    const rv = usdc.runtimeAllowance({ spender: UNISWAP_V3_ROUTER, owner: WETH_ADDRESS });
    expect(rv.inputParams[0].paramData.toLowerCase()).toContain(
      USDC_ADDRESS.slice(2).toLowerCase(),
    );
  });

  it('runtimeAllowance produces different paramData for different owners', () => {
    const a = usdc.runtimeAllowance({ spender: UNISWAP_V3_ROUTER, owner: WETH_ADDRESS });
    const b = usdc.runtimeAllowance({ spender: UNISWAP_V3_ROUTER, owner: USDC_ADDRESS });
    expect(a.inputParams[0].paramData).not.toBe(b.inputParams[0].paramData);
  });

  it('runtimeAllowance produces different paramData for different spenders', () => {
    const a = usdc.runtimeAllowance({ spender: USDC_ADDRESS, owner: WETH_ADDRESS });
    const b = usdc.runtimeAllowance({ spender: UNISWAP_V3_ROUTER, owner: WETH_ADDRESS });
    expect(a.inputParams[0].paramData).not.toBe(b.inputParams[0].paramData);
  });

  it('runtimeAllowance on WETH uses WETH as token address in paramData', () => {
    const weth = createERC20Token(publicClient, WETH_ADDRESS);
    const rv = weth.runtimeAllowance({ spender: USDC_ADDRESS, owner: UNISWAP_V3_ROUTER });
    expect(rv.inputParams[0].paramData.toLowerCase()).toContain(
      WETH_ADDRESS.slice(2).toLowerCase(),
    );
  });
});

// ---------------------------------------------------------------------------
// Constraints on runtime values
// ---------------------------------------------------------------------------

describe('ERC20Token — runtimeBalance with constraint', () => {
  const usdc = createERC20Token(publicClient, USDC_ADDRESS);

  it('gte constraint adds one constraint to inputParams[0]', () => {
    const rv = usdc.runtimeBalance({
      constraint: { gte: 1_000_000n },
      owner: UNISWAP_V3_ROUTER,
    });
    expect(rv.inputParams[0].constraints).toHaveLength(1);
  });

  it('lte constraint adds one constraint to inputParams[0]', () => {
    const rv = usdc.runtimeBalance({
      constraint: { lte: 5_000_000n },
      owner: UNISWAP_V3_ROUTER,
    });
    expect(rv.inputParams[0].constraints).toHaveLength(1);
  });

  it('eq constraint adds one constraint to inputParams[0]', () => {
    const rv = usdc.runtimeBalance({ constraint: { eq: 0n }, owner: UNISWAP_V3_ROUTER });
    expect(rv.inputParams[0].constraints).toHaveLength(1);
  });

  it('no constraint defaults to empty', () => {
    const rv = usdc.runtimeBalance({ owner: UNISWAP_V3_ROUTER });
    expect(rv.inputParams[0].constraints).toHaveLength(0);
  });

  it('uses accountAddress as owner when owner is omitted', () => {
    const usdcWithAccount = createERC20Token(publicClient, USDC_ADDRESS, UNISWAP_V3_ROUTER);
    const rv = usdcWithAccount.runtimeBalance({ constraint: { gte: 1n } });
    expect(rv.inputParams[0].constraints).toHaveLength(1);
  });
});

describe('ERC20Token — runtimeAllowance with constraint', () => {
  const usdc = createERC20Token(publicClient, USDC_ADDRESS);

  it('gte constraint adds one constraint', () => {
    const rv = usdc.runtimeAllowance({
      spender: UNISWAP_V3_ROUTER,
      constraint: { gte: 500n },
      owner: WETH_ADDRESS,
    });
    expect(rv.inputParams[0].constraints).toHaveLength(1);
  });

  it('no constraint defaults to empty', () => {
    const rv = usdc.runtimeAllowance({ spender: UNISWAP_V3_ROUTER, owner: WETH_ADDRESS });
    expect(rv.inputParams[0].constraints).toHaveLength(0);
  });

  it('uses accountAddress as owner when owner is omitted', () => {
    const usdcWithAccount = createERC20Token(publicClient, USDC_ADDRESS, WETH_ADDRESS);
    const rv = usdcWithAccount.runtimeAllowance({
      spender: UNISWAP_V3_ROUTER,
      constraint: { gte: 1n },
    });
    expect(rv.inputParams[0].constraints).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ERC20Token — write
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ERC20Token — check
// ---------------------------------------------------------------------------

describe('ERC20Token — check', () => {
  const usdc = createERC20Token(publicClient, USDC_ADDRESS);

  it('check(balanceOf) returns a ComposableCall with a functionSig', () => {
    const call = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    expect(typeof call.functionSig).toBe('string');
    expect(call.functionSig.length).toBeGreaterThan(0);
  });

  it('check(balanceOf) uses the predicate dummy functionSig', () => {
    const call = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    // check() is a predicate — the calldata never executes, so functionSig is always the sentinel
    expect(call.functionSig).toBe('0x11111111');
  });

  it('check(allowance) uses the predicate dummy functionSig', () => {
    const call = usdc.check({
      functionName: 'allowance',
      args: [UNISWAP_V3_ROUTER, WETH_ADDRESS],
      constraint: { gte: 0n },
    });
    expect(call.functionSig).toBe('0x11111111');
  });

  it('check() always produces the same predicate functionSig regardless of function called', () => {
    const a = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    const b = usdc.check({
      functionName: 'allowance',
      args: [UNISWAP_V3_ROUTER, WETH_ADDRESS],
      constraint: { gte: 0n },
    });
    expect(a.functionSig).toBe(b.functionSig);
  });

  it('check(balanceOf) outputParams is empty', () => {
    const call = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    expect(call.outputParams).toHaveLength(0);
  });

  it('check(balanceOf) inputParams contains a STATIC_CALL param', () => {
    const call = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    const staticCallParam = call.inputParams.find(
      (p) => p.fetcherType === InputParamFetcherType.STATIC_CALL,
    );
    expect(staticCallParam).toBeDefined();
  });

  it('one constraint is applied to the STATIC_CALL param', () => {
    const call = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 1_000n },
    });
    const staticCallParam = call.inputParams.find(
      (p) => p.fetcherType === InputParamFetcherType.STATIC_CALL,
    );
    expect(staticCallParam?.constraints).toHaveLength(1);
  });

  it('constraint does not affect paramData of the STATIC_CALL param', () => {
    const a = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 999n },
    });
    const b = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { lte: 1n },
    });
    const staticA = a.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    const staticB = b.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    expect(staticA?.paramData).toBe(staticB?.paramData);
  });

  it('check(balanceOf) produces different paramData for different addresses', () => {
    const a = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    const b = usdc.check({
      functionName: 'balanceOf',
      args: [WETH_ADDRESS],
      constraint: { gte: 0n },
    });
    const staticA = a.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    const staticB = b.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    expect(staticA?.paramData).not.toBe(staticB?.paramData);
  });

  it('check(balanceOf) is deterministic for the same args', () => {
    const a = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    const b = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    expect(a.functionSig).toBe(b.functionSig);
    expect(JSON.stringify(a.inputParams)).toBe(JSON.stringify(b.inputParams));
  });

  it('check on WETH produces different paramData than check on USDC for same owner', () => {
    const weth = createERC20Token(publicClient, WETH_ADDRESS);
    const a = usdc.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    const b = weth.check({
      functionName: 'balanceOf',
      args: [UNISWAP_V3_ROUTER],
      constraint: { gte: 0n },
    });
    const staticA = a.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    const staticB = b.inputParams.find((p) => p.fetcherType === InputParamFetcherType.STATIC_CALL);
    expect(staticA?.paramData).not.toBe(staticB?.paramData);
  });
});

describe('ERC20Token — write', () => {
  const usdc = createERC20Token(publicClient, USDC_ADDRESS);

  it('write(transfer) returns a ComposableCall object', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [UNISWAP_V3_ROUTER, 1_000_000n],
    });
    expect(typeof call).toBe('object');
  });

  it('write(transfer) has a functionSig', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [UNISWAP_V3_ROUTER, 1_000_000n],
    });
    expect(typeof call.functionSig).toBe('string');
    expect(call.functionSig.length).toBeGreaterThan(0);
  });

  it('write(approve) has a functionSig', async () => {
    const call = await usdc.write({
      functionName: 'approve',
      args: [UNISWAP_V3_ROUTER, 1_000_000n],
    });
    expect(typeof call.functionSig).toBe('string');
    expect(call.functionSig.length).toBeGreaterThan(0);
  });

  it('write(transfer) and write(approve) produce different functionSigs', async () => {
    const [transfer, approve] = await Promise.all([
      usdc.write({ functionName: 'transfer', args: [UNISWAP_V3_ROUTER, 1_000_000n] }),
      usdc.write({ functionName: 'approve', args: [UNISWAP_V3_ROUTER, 1_000_000n] }),
    ]);
    expect(transfer.functionSig).not.toBe(approve.functionSig);
  });

  it('write(transfer) accepts a runtimeBalance() as the amount arg', async () => {
    const rv = usdc.runtimeBalance({ owner: UNISWAP_V3_ROUTER });
    const call = await usdc.write({ functionName: 'transfer', args: [WETH_ADDRESS, rv] });
    expect(typeof call).toBe('object');
    expect(call.functionSig).toBeDefined();
  });

  it('write(transfer) produces different inputParams for different amounts', async () => {
    const [a, b] = await Promise.all([
      usdc.write({ functionName: 'transfer', args: [UNISWAP_V3_ROUTER, 1n] }),
      usdc.write({ functionName: 'transfer', args: [UNISWAP_V3_ROUTER, 2n] }),
    ]);
    expect(JSON.stringify(a.inputParams)).not.toBe(JSON.stringify(b.inputParams));
  });

  it('write(transfer) produces different inputParams for different recipients', async () => {
    const [a, b] = await Promise.all([
      usdc.write({ functionName: 'transfer', args: [UNISWAP_V3_ROUTER, 1n] }),
      usdc.write({ functionName: 'transfer', args: [WETH_ADDRESS, 1n] }),
    ]);
    expect(JSON.stringify(a.inputParams)).not.toBe(JSON.stringify(b.inputParams));
  });
});

describe('NativeToken — runtimeBalance with constraint', () => {
  const native = createNativeToken(publicClient);

  it('gte constraint adds one constraint', () => {
    const rv = native.runtimeBalance({ constraint: { gte: 1n }, address: WETH_CONTRACT });
    expect(rv.inputParams[0].constraints).toHaveLength(1);
  });

  it('no constraint defaults to empty', () => {
    const rv = native.runtimeBalance({ address: WETH_CONTRACT });
    expect(rv.inputParams[0].constraints).toHaveLength(0);
  });

  it('uses accountAddress as target when address is omitted', () => {
    const nativeWithAccount = createNativeToken(publicClient, WETH_CONTRACT);
    const rv = nativeWithAccount.runtimeBalance({ constraint: { gte: 1n } });
    expect(rv.inputParams[0].constraints).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ERC20Token — write with capture: execResult
// ---------------------------------------------------------------------------

describe('ERC20Token — write with capture: execResult', () => {
  // transfer(address,uint256) returns (bool) — 1 static output, suitable for execResult
  const usdc = createERC20Token(publicClient, USDC_ADDRESS, ACCOUNT);

  it('outputParams has exactly 1 entry', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1_000_000n],
      capture: { type: 'execResult' },
    });
    expect(call.outputParams).toHaveLength(1);
  });

  it('fetcherType is EXEC_RESULT', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1_000_000n],
      capture: { type: 'execResult' },
    });
    expect(call.outputParams[0].fetcherType).toBe(OutputParamFetcherType.EXEC_RESULT);
  });

  it('paramData is a hex string', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1_000_000n],
      capture: { type: 'execResult' },
    });
    expect(call.outputParams[0].paramData).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it('paramData encodes NAMESPACE_STORAGE_CONTRACT_ADDRESS', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1_000_000n],
      capture: { type: 'execResult' },
    });
    expect(call.outputParams[0].paramData.toLowerCase()).toContain(
      NAMESPACE_STORAGE_CONTRACT_ADDRESS.slice(2).toLowerCase(),
    );
  });

  it('two calls without a storageKey produce different slots (auto-generated key)', async () => {
    const [a, b] = await Promise.all([
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: { type: 'execResult' },
      }),
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: { type: 'execResult' },
      }),
    ]);
    expect(a.outputParams[0].paramData).not.toBe(b.outputParams[0].paramData);
  });

  it('same storageKey produces the same paramData', async () => {
    const storageKey = 77n;
    const [a, b] = await Promise.all([
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: { type: 'execResult', storageKey },
      }),
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: { type: 'execResult', storageKey },
      }),
    ]);
    expect(a.outputParams[0].paramData).toBe(b.outputParams[0].paramData);
  });

  it('without capture, outputParams is empty', async () => {
    const call = await usdc.write({ functionName: 'transfer', args: [WETH_ADDRESS, 1_000_000n] });
    expect(call.outputParams).toHaveLength(0);
  });

  it('throws when accountAddress is omitted', async () => {
    const usdcNoAccount = createERC20Token(publicClient, USDC_ADDRESS);
    await expect(
      usdcNoAccount.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1_000_000n],
        capture: { type: 'execResult' },
      }),
    ).rejects.toThrow('capture requires an accountAddress');
  });
});

// ---------------------------------------------------------------------------
// ERC20Token — write with capture: staticCall
// ---------------------------------------------------------------------------

describe('ERC20Token — write with capture: staticCall', () => {
  // After transfer, capture the recipient's updated balance via a balanceOf staticCall
  const usdc = createERC20Token(publicClient, USDC_ADDRESS, ACCOUNT);

  const STATIC_CALL_CAPTURE = {
    type: 'staticCall' as const,
    abi: erc20Abi,
    functionName: 'balanceOf' as const,
    targetAddress: USDC_ADDRESS,
    args: [ACCOUNT] as const,
    storageKey: 1n,
  };

  it('outputParams has exactly 1 entry', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1_000_000n],
      capture: STATIC_CALL_CAPTURE,
    });
    expect(call.outputParams).toHaveLength(1);
  });

  it('fetcherType is STATIC_CALL', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1_000_000n],
      capture: STATIC_CALL_CAPTURE,
    });
    expect(call.outputParams[0].fetcherType).toBe(OutputParamFetcherType.STATIC_CALL);
  });

  it('paramData is a hex string', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1_000_000n],
      capture: STATIC_CALL_CAPTURE,
    });
    expect(call.outputParams[0].paramData).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it('paramData encodes the targetAddress', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1_000_000n],
      capture: STATIC_CALL_CAPTURE,
    });
    expect(call.outputParams[0].paramData.toLowerCase()).toContain(
      USDC_ADDRESS.slice(2).toLowerCase(),
    );
  });

  it('paramData encodes NAMESPACE_STORAGE_CONTRACT_ADDRESS', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1_000_000n],
      capture: STATIC_CALL_CAPTURE,
    });
    expect(call.outputParams[0].paramData.toLowerCase()).toContain(
      NAMESPACE_STORAGE_CONTRACT_ADDRESS.slice(2).toLowerCase(),
    );
  });

  it('different targetAddress produces different paramData', async () => {
    const [a, b] = await Promise.all([
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: { ...STATIC_CALL_CAPTURE, targetAddress: USDC_ADDRESS },
      }),
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: { ...STATIC_CALL_CAPTURE, targetAddress: WETH_ADDRESS },
      }),
    ]);
    expect(a.outputParams[0].paramData).not.toBe(b.outputParams[0].paramData);
  });

  it('different staticCall args produce different paramData', async () => {
    const [a, b] = await Promise.all([
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: { ...STATIC_CALL_CAPTURE, args: [ACCOUNT] },
      }),
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: { ...STATIC_CALL_CAPTURE, args: [WETH_ADDRESS] },
      }),
    ]);
    expect(a.outputParams[0].paramData).not.toBe(b.outputParams[0].paramData);
  });

  it('throws when accountAddress is omitted', async () => {
    const usdcNoAccount = createERC20Token(publicClient, USDC_ADDRESS);
    await expect(
      usdcNoAccount.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1_000_000n],
        capture: STATIC_CALL_CAPTURE,
      }),
    ).rejects.toThrow('capture requires an accountAddress');
  });
});

// ---------------------------------------------------------------------------
// ERC20Token — write with capture: multiple outputs (storage write example)
// ---------------------------------------------------------------------------

describe('ERC20Token — write with capture: multiple outputs (storage write example)', () => {
  // ERC20 transfer returns bool (1 output); use multipleOutputStaticCall (3 outputs) for staticCall capture
  const usdc = createERC20Token(publicClient, USDC_ADDRESS, ACCOUNT);
  const STORAGE_KEY = 55n;

  it('execResult with 1 output (transfer → bool): paramData encodes count = 1', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1n],
      capture: { type: 'execResult', storageKey: STORAGE_KEY },
    });
    expect(decodeOutputCount(call.outputParams[0].paramData)).toBe(1);
  });

  it('staticCall with 3-output staticCall function: outputParams still has exactly 1 entry', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1n],
      capture: {
        type: 'staticCall',
        abi: STORAGE_WRITE_EXAMPLE_ABI as Abi,
        functionName: 'multipleOutputStaticCall',
        targetAddress: STORAGE_WRITE_EXAMPLE_CONTRACT,
        args: [4n],
        storageKey: STORAGE_KEY,
      },
    });
    expect(call.outputParams).toHaveLength(1);
  });

  it('staticCall with 3-output staticCall function: fetcherType is STATIC_CALL', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1n],
      capture: {
        type: 'staticCall',
        abi: STORAGE_WRITE_EXAMPLE_ABI as Abi,
        functionName: 'multipleOutputStaticCall',
        targetAddress: STORAGE_WRITE_EXAMPLE_CONTRACT,
        args: [4n],
        storageKey: STORAGE_KEY,
      },
    });
    expect(call.outputParams[0].fetcherType).toBe(OutputParamFetcherType.STATIC_CALL);
  });

  it('staticCall with 3-output staticCall function: paramData encodes count = 3', async () => {
    const call = await usdc.write({
      functionName: 'transfer',
      args: [WETH_ADDRESS, 1n],
      capture: {
        type: 'staticCall',
        abi: STORAGE_WRITE_EXAMPLE_ABI as Abi,
        functionName: 'multipleOutputStaticCall',
        targetAddress: STORAGE_WRITE_EXAMPLE_CONTRACT,
        args: [4n],
        storageKey: STORAGE_KEY,
      },
    });
    expect(decodeOutputCount(call.outputParams[0].paramData)).toBe(3);
  });

  it('staticCall count differs between 1-output and 3-output staticCall functions (same storageKey)', async () => {
    const [single, multi] = await Promise.all([
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: {
          type: 'staticCall',
          abi: erc20Abi,
          functionName: 'balanceOf',
          targetAddress: USDC_ADDRESS,
          args: [ACCOUNT],
          storageKey: STORAGE_KEY,
        },
      }),
      usdc.write({
        functionName: 'transfer',
        args: [WETH_ADDRESS, 1n],
        capture: {
          type: 'staticCall',
          abi: STORAGE_WRITE_EXAMPLE_ABI as Abi,
          functionName: 'multipleOutputStaticCall',
          targetAddress: STORAGE_WRITE_EXAMPLE_CONTRACT,
          args: [4n],
          storageKey: STORAGE_KEY,
        },
      }),
    ]);
    expect(decodeOutputCount(single.outputParams[0].paramData)).toBe(1);
    expect(decodeOutputCount(multi.outputParams[0].paramData)).toBe(3);
  });
});
