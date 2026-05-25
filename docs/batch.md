# Batch Reference

`createComposableBatch` is the entry point of the SDK. It returns a `ComposableBatchInstance` — a builder that collects composable calls in order and serialises them for execution.

---

## createComposableBatch

```ts
import { createComposableBatch } from '@biconomy/smart-batching';

const batch = createComposableBatch(publicClient, accountAddress);
```

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `publicClient` | `PublicClient` | Viem public client for the target chain |
| `accountAddress` | `Address` | The smart account address that will execute the batch |

**Returns** `ComposableBatchInstance`

---

## ComposableBatchInstance

### Properties

| Property | Type | Description |
|---|---|---|
| `publicClient` | `PublicClient` | The public client passed at construction |
| `accountAddress` | `Address` | The smart account address |
| `length` | `number` | Number of pending calls currently in the batch |

---

### erc20Token

Returns an `ERC20TokenInstance` for the given token address, bound to the batch's account.

```ts
erc20Token(tokenAddress: Address): ERC20TokenInstance
```

```ts
const USDC = '0xUsdcAddress';
const usdc = batch.erc20Token(USDC);
```

See [token.md](./token.md) for all methods on `ERC20TokenInstance`.

---

### nativeToken

Returns a `NativeTokenInstance` for native ETH, bound to the batch's account.

```ts
nativeToken(): NativeTokenInstance
```

```ts
const eth = batch.nativeToken();
```

See [token.md](./token.md) for all methods on `NativeTokenInstance`.

---

### contract

Returns a fully typed `ContractInstance` for any contract with a given ABI.

```ts
contract<TAbi>(address: Address, abi: TAbi): ContractInstance<TAbi>
```

```ts
const myContract = batch.contract('0xContractAddress', MY_ABI);
```

See [contract.md](./contract.md) for all methods on `ContractInstance`.

---

### storage

Returns a `StorageInstance` scoped to the batch's account address.

```ts
storage(): StorageInstance
```

```ts
const storage = batch.storage();
```

See [storage.md](./storage.md) for all methods on `StorageInstance`.

---

### add

Appends one or more calls to the batch. Order is preserved. Accepts a single call, a `Promise` of a call, or an array of either.

```ts
add(
  calls: ComposableCall | Promise<ComposableCall> | (ComposableCall | Promise<ComposableCall>)[]
): void
```

```ts
const USDC   = '0xUsdcAddress';
const amount = parseUnits('10', 6);

const usdc = batch.erc20Token(USDC);

// Single call
batch.add(
  usdc.write({ functionName: 'transfer', args: ['0xRecipientAddress', amount] }),
);

// Multiple calls — order is preserved
batch.add([
  usdc.check({
    functionName: 'balanceOf',
    args: ['0xRecipientAddress'],
    constraint: { gte: amount },
  }),
  usdc.write({ functionName: 'transfer', args: ['0xRecipientAddress', amount] }),
]);

console.log(batch.length); // 3
```

---

### clear

Removes all pending calls from the batch.

```ts
clear(): void
```

```ts
batch.clear();
console.log(batch.length); // 0
```

---

### toCalls

Resolves all pending calls and returns a `ComposableCall[]`. Use this when your execution client accepts a calls array directly (e.g. MEE).

```ts
toCalls(): Promise<ComposableCall[]>
```

```ts
const calls = await batch.toCalls();

const quote = await meeClient.getQuote({
  instructions: [{ calls, chainId: baseSepolia.id, isComposable: true }],
  feeToken: { address: '0xUsdcAddress', chainId: baseSepolia.id },
});

const { hash } = await meeClient.executeQuote({ quote });
await meeClient.waitForSupertransactionReceipt({ hash });
```

---

### toCalldata

Encodes the full batch as `executeComposable` calldata. Use this when you control the UserOp directly via a bundler (ZeroDev, Alchemy, Pimlico, or any ERC-4337 bundler).

```ts
toCalldata(): Promise<Hex>
```

```ts
const calldata = await batch.toCalldata();

const userOpHash = await kernelClient.sendUserOperation({
  callData: calldata,
});
```
