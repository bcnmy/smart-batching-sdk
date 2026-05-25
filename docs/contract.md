# Contract Reference

`ContractInstance` wraps any contract with its ABI, providing composable `write`, `check`, and `runtimeValue` methods alongside an off-chain `read`. Created via `batch.contract(address, abi)`.

```ts
import { createComposableBatch } from '@biconomy/smart-batching';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const MY_ABI = [ /* your contract ABI */ ] as const;

const publicClient = createPublicClient({ chain: base, transport: http() });
const batch = createComposableBatch(publicClient, '0xYourSmartAccountAddress');

const myContract = batch.contract('0xContractAddress', MY_ABI);
```

The ABI is preserved as a generic type parameter, so all `functionName` and `args` fields are fully type-checked against your ABI.

---

## ContractInstance

### Properties

| Property | Type | Description |
|---|---|---|
| `address` | `Address` | The contract address |
| `abi` | `TAbi` | The ABI passed at construction |

---

### read

Calls a view or pure function off-chain and returns the decoded result. Use this before building the batch to fetch data you need at signing time.

```ts
read(params: {
  functionName: string;
  args: TArgs;
}): Promise<TResult>
```

```ts
const price = await oracle.read({
  functionName: 'latestPrice',
  args: [],
});
// price: bigint

const poolBalance = await pool.read({
  functionName: 'balanceOf',
  args: ['0xTokenAddress'],
});
```

---

### write

Encodes a state-changing call as a `ComposableCall`. Accepts `RuntimeValue` at any depth inside `args` (including inside arrays and struct fields). Optionally attaches a `capture` descriptor to store the return value into namespace storage for use by later calls.

```ts
write(params: {
  functionName: string;
  args: ComposableArgs;  // any arg or nested field can be a RuntimeValue
  value?: bigint;        // native ETH to send with the call (msg.value)
  capture?: Capture;
}): Promise<ComposableCall>
```

**Static args:**

```ts
batch.add(
  myContract.write({
    functionName: 'execute',
    args: ['0xTargetAddress', parseUnits('100', 6)],
  }),
);
```

**With a runtime value arg:**

```ts
const usdc = batch.erc20Token('0xUsdcAddress');

batch.add(
  myContract.write({
    functionName: 'deposit',
    args: [usdc.runtimeBalance()],  // resolved at execution time
  }),
);
```

**With native ETH value:**

```ts
batch.add(
  myContract.write({
    functionName: 'stake',
    args: ['0xValidatorAddress'],
    value: parseEther('1'),
  }),
);
```

**With execResult capture** — stores the return value into a storage slot:

```ts
const storage    = batch.storage();
const storageKey = await storage.getStorageKey();

batch.add(
  myContract.write({
    functionName: 'computeAmount',
    args: [parseUnits('5', 6)],
    capture: { type: 'execResult', storageKey },
  }),
);

// Later calls can read the captured value from storage
batch.add(
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', await storage.runtimeValue({ storageKey })],
  }),
);
```

**With staticCall capture** — runs a view call after the write and stores its result:

```ts
import type { Abi } from 'viem';

const storageKey = await storage.getStorageKey();

batch.add(
  myContract.write({
    functionName: 'triggerUpdate',
    args: [42n],
    capture: {
      type: 'staticCall',
      abi: PRICE_ORACLE_ABI as Abi,
      functionName: 'getPrice',
      targetAddress: '0xOracleAddress',
      args: ['0xTokenAddress'],
      storageKey,
    },
  }),
);
```

**Capture field reference**

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `'execResult' \| 'staticCall'` | Yes | Capture strategy |
| `storageKey` | `bigint` | No | Storage key for the slot; auto-generated if omitted |
| `abi` | `Abi` | `staticCall` only | ABI of the contract to call |
| `functionName` | `string` | `staticCall` only | View function to call |
| `targetAddress` | `Address` | `staticCall` only | Address to call |
| `args` | `TArgs` | `staticCall` only | Arguments for the static call |

> All return types in a capture must be static ABI types. Dynamic types (`bytes`, `string`, `T[]`) are not supported.

---

### runtimeValue

Returns a `RuntimeValue` that resolves to the return value of a view function at execution time. Use it as an argument in a later `write` call.

```ts
runtimeValue(params: {
  functionName: string;
  args: TArgs;
  constraint?: RuntimeConstraint;
}): RuntimeValue
```

```ts
const oracle = batch.contract('0xOracleAddress', ORACLE_ABI);
const dex    = batch.contract('0xDexAddress', DEX_ABI);

// Use the live oracle price as an argument to a swap
batch.add(
  dex.write({
    functionName: 'swapWithLimit',
    args: [
      '0xTokenInAddress',
      '0xTokenOutAddress',
      parseUnits('1', 18),
      oracle.runtimeValue({ functionName: 'latestPrice', args: [] }),
    ],
  }),
);
```

**With a constraint** — the call reverts if the resolved value does not satisfy the constraint:

```ts
oracle.runtimeValue({
  functionName: 'latestPrice',
  args: [],
  constraint: { gte: parseUnits('1000', 8) },  // price must be >= 1000
})
```

```ts
// Signed constraint — useful when the resolved value may be negative
oracle.runtimeValue({
  functionName: 'priceDelta',
  args: [],
  constraint: { gteSigned: -500n },
})
```

```ts
// OR constraint — passes if any one child passes
oracle.runtimeValue({
  functionName: 'score',
  args: [],
  constraint: { or: [{ eq: 0n }, { gte: 100n }] },
})
```

See [RuntimeConstraint reference](./token.md#runtimeconstraint) for all available constraint shapes.

---

### check

Calls a view function on-chain during execution and asserts its return value. If any constraint fails the entire batch reverts. Returns a `ComposableCall` synchronously — no `await` needed.

```ts
check(params: {
  functionName: string;
  args: TArgs;
  constraint: RuntimeConstraint;
}): ComposableCall
```

```ts
const pool = batch.contract('0xPoolAddress', POOL_ABI);

// Pre-condition: pool must have sufficient liquidity before a swap
batch.add(
  pool.check({
    functionName: 'getLiquidity',
    args: [],
    constraint: { gte: parseUnits('10000', 6) },
  }),
);

// Post-condition: assert the pool was fully drained after a sweep
batch.add(
  pool.check({
    functionName: 'balanceOf',
    args: ['0xTokenAddress'],
    constraint: { eq: 0n },
  }),
);

// Signed constraint — assert a signed delta is within acceptable bounds
batch.add(
  pool.check({
    functionName: 'priceDelta',
    args: [],
    constraint: { gteSigned: -500n },
  }),
);

// OR constraint — passes if any one child passes
batch.add(
  pool.check({
    functionName: 'getLiquidity',
    args: [],
    constraint: { or: [{ eq: 0n }, { gte: parseUnits('10000', 6) }] },
  }),
);
```

See [RuntimeConstraint reference](./token.md#runtimeconstraint) for all available constraint shapes.
