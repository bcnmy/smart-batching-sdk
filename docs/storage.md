# Storage Reference

`StorageInstance` provides access to a namespace storage contract — an on-chain key-value store scoped to your smart account. It is the mechanism that lets one call's output flow into a later call as a runtime value, within the same batch.

Created via `batch.storage()`:

```ts
const storage = batch.storage();
```

All methods that produce composable calls (`write`, `check`, `runtimeValue`) are `async` — always `await` them when passing into `batch.add`.

---

## StorageInstance

### Properties

| Property | Type | Description |
|---|---|---|
| `accountAddress` | `Address` | The smart account address this storage instance is scoped to |

---

### getStorageKey

Generates a unique `bigint` storage key scoped to this account. Each call returns a different key, so multiple slots within the same batch never collide.

```ts
getStorageKey(params?: {
  accountAddress?: Address;  // override the scoped account
  callerAddress?: Address;   // defaults to accountAddress
}): Promise<bigint>
```

```ts
const storage = batch.storage();

const key1 = await storage.getStorageKey(); // unique key
const key2 = await storage.getStorageKey(); // different unique key — no collision
```

---

### write

Encodes a call to write a value into a storage slot. The value is written at execution time when the composability module processes the batch.

```ts
write(params: {
  value: bigint | boolean | Address | Hex | number;  // value to store
  storageKey?: bigint;    // key returned by getStorageKey(); auto-generated if omitted
  slotIndex?: number;     // slot index within the key; defaults to 0
  accountAddress?: Address;
  callerAddress?: Address;
}): Promise<ComposableCall>
```

```ts
const storageKey = await storage.getStorageKey();
const amount     = parseUnits('10', 6);

batch.add([
  // Write a known value into storage at signing time
  await storage.write({ storageKey, value: amount }),

  // Then use it as a runtime arg in a later call
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', await storage.runtimeValue({ storageKey })],
  }),
]);
```

All supported value types:

```ts
await storage.write({ storageKey, value: 42n });                        // bigint
await storage.write({ storageKey, value: true });                       // boolean
await storage.write({ storageKey, value: '0xSomeAddress' });            // Address
await storage.write({ storageKey, value: '0xdeadbeef' });               // Hex
await storage.write({ storageKey, value: 100 });                        // number
```

---

### runtimeValue

Returns a `RuntimeValue` that resolves to the value in a storage slot at execution time. Pass it as an argument to any `write` call that follows the slot being populated.

```ts
runtimeValue(params?: {
  storageKey?: bigint;
  slotIndex?: number;     // defaults to 0
  constraints?: RuntimeConstraint[];
  accountAddress?: Address;
  callerAddress?: Address;
}): Promise<RuntimeValue>
```

```ts
const storageKey = await storage.getStorageKey();

batch.add([
  // Populate the slot via capture
  myContract.write({
    functionName: 'computeAmount',
    args: [parseUnits('5', 6)],
    capture: { type: 'execResult', storageKey },
  }),

  // Use the captured value as a runtime arg in the next call
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', await storage.runtimeValue({ storageKey })],
  }),
]);
```

**With constraints** — reverts if the slot value does not satisfy all constraints at execution time:

```ts
await storage.runtimeValue({
  storageKey,
  constraints: [{ gte: parseUnits('1', 6) }],  // slot must hold at least 1 USDC
})
```

```ts
// Signed constraint — slot value is compared as int256
await storage.runtimeValue({
  storageKey,
  constraints: [{ gteSigned: -100n }, { lteSigned: 500n }],
})
```

```ts
// OR constraint — passes if any one child passes
await storage.runtimeValue({
  storageKey,
  constraints: [{ or: [{ eq: 0n }, { gte: parseUnits('1', 6) }] }],
})
```

See [RuntimeConstraint reference](./token.md#runtimeconstraint) for all available constraint shapes.

**Multi-output — reading indexed slots:**

```ts
// myContract.multiReturn() returns (uint256 a, uint256 b)
// slotIndex 0 → a, slotIndex 1 → b
myContract.write({
  functionName: 'multiReturn',
  args: [],
  capture: { type: 'execResult', storageKey },
}),

usdc.write({
  functionName: 'transfer',
  args: ['0xRecipientA', await storage.runtimeValue({ storageKey, slotIndex: 0 })],
}),
usdc.write({
  functionName: 'transfer',
  args: ['0xRecipientB', await storage.runtimeValue({ storageKey, slotIndex: 1 })],
}),
```

---

### check

Reads a storage slot on-chain during execution and asserts its value against constraints. If any constraint fails the entire batch reverts.

```ts
check(params: {
  constraints: RuntimeConstraint[];  // required
  storageKey?: bigint;
  slotIndex?: number;               // defaults to 0
  accountAddress?: Address;
  callerAddress?: Address;
}): Promise<ComposableCall>
```

```ts
const storageKey = await storage.getStorageKey();

batch.add([
  myContract.write({
    functionName: 'computeAmount',
    args: [parseUnits('5', 6)],
    capture: { type: 'execResult', storageKey },
  }),

  // Assert the captured value equals the expected result on-chain
  await storage.check({
    storageKey,
    constraints: [{ eq: parseUnits('10', 6) }],
  }),

  // Only proceed with the transfer if the captured value passes
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', await storage.runtimeValue({ storageKey })],
  }),
]);
```

**Checking a specific slot index:**

```ts
await storage.check({ storageKey, slotIndex: 0, constraints: [{ eq: 10n }] })
await storage.check({ storageKey, slotIndex: 1, constraints: [{ eq: 21n }] })
```

**Signed and OR constraints work the same way:**

```ts
// Signed — slot value compared as int256
await storage.check({ storageKey, constraints: [{ gteSigned: -100n }] })

// OR — passes if any one child passes
await storage.check({ storageKey, constraints: [{ or: [{ eq: 0n }, { gte: 100n }] }] })
```

See [RuntimeConstraint reference](./token.md#runtimeconstraint) for all available constraint shapes.

---

## Slot indexing

When a captured call returns multiple values, the composability module stores each at an indexed slot derived from the base slot:

- `slotIndex: 0` → first return value
- `slotIndex: 1` → second return value
- `slotIndex: 2` → third return value

When a captured call returns a single value, `slotIndex` defaults to `0` and can be omitted.

```ts
// multiReturn(7, 3) → (sum=10, product=21, greater=true)
myContract.write({
  functionName: 'multiReturn',
  args: [7n, 3n],
  capture: { type: 'execResult', storageKey },
}),

await storage.check({ storageKey, slotIndex: 0, constraints: [{ eq: 10n }] }),
await storage.check({ storageKey, slotIndex: 1, constraints: [{ eq: 21n }] }),
await storage.check({ storageKey, slotIndex: 2, constraints: [{ eq: 1n }] }),
```
