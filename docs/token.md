# Token Reference

Token instances provide composable access to ERC-20 tokens and native ETH. They are created through the batch builder and automatically bound to the smart account address.

```ts
import { createComposableBatch } from '@bcnmy/smart-batching';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const publicClient = createPublicClient({ chain: base, transport: http() });
const batch = createComposableBatch(publicClient, '0xYourSmartAccountAddress');

const usdc = batch.erc20Token('0xUsdcAddress');
const eth  = batch.nativeToken();
```

---

## ERC20TokenInstance

### Properties

| Property | Type | Description |
|---|---|---|
| `address` | `Address` | The token contract address |
| `abi` | `ERC20Abi` | The standard ERC-20 ABI |

---

### read

Reads any view function on the ERC-20 contract off-chain. Returns the decoded result. Use this for off-chain data fetching before building the batch.

```ts
read(params: { functionName: string; args: TArgs }): Promise<TResult>
```

```ts
const balance = await usdc.read({
  functionName: 'balanceOf',
  args: ['0xOwnerAddress'],
});
// balance: bigint

const allowance = await usdc.read({
  functionName: 'allowance',
  args: ['0xOwnerAddress', '0xSpenderAddress'],
});
// allowance: bigint
```

---

### write

Encodes a state-changing call on the ERC-20 contract as a `ComposableCall`. Accepts runtime values in `args` and an optional `capture` descriptor to store the return value into namespace storage.

```ts
write(params: {
  functionName: string;
  args: ComposableArgs;  // static values or RuntimeValue at any depth
  value?: bigint;        // native ETH to send with the call
  capture?: Capture;     // optional: capture return value into storage
}): Promise<ComposableCall>
```

**Basic transfer:**

```ts
batch.add(
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', parseUnits('10', 6)],
  }),
);
```

**Transfer with a runtime amount** (resolved at execution time):

```ts
batch.add(
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', usdc.runtimeBalance()],
  }),
);
```

**Approve with capture** (store the return value into a storage slot):

```ts
const storage    = batch.storage();
const storageKey = await storage.getStorageKey();

batch.add(
  usdc.write({
    functionName: 'approve',
    args: ['0xSpenderAddress', parseUnits('100', 6)],
    capture: { type: 'execResult', storageKey },
  }),
);
```

---

### check

Reads a view function on-chain during execution and asserts its return value against constraints. If any constraint fails, the entire batch reverts. Returns a `ComposableCall` synchronously.

```ts
check(params: {
  functionName: string;
  args: TArgs;
  constraint: RuntimeConstraint;  // { eq }, { gte }, { lte }, { gteSigned }, { lteSigned }, or { or: [...] }
}): ComposableCall
```

```ts
// Pre-condition: assert the SCA holds at least 50 USDC
batch.add(
  usdc.check({
    functionName: 'balanceOf',
    args: ['0xSmartAccountAddress'],
    constraint: { gte: parseUnits('50', 6) },
  }),
);

// Post-condition: assert the recipient received the funds
batch.add(
  usdc.check({
    functionName: 'balanceOf',
    args: ['0xRecipientAddress'],
    constraint: { gte: parseUnits('10', 6) },
  }),
);

// Range check: balance must be between 10 and 1000 USDC — use two separate check() calls
batch.add(
  usdc.check({
    functionName: 'balanceOf',
    args: ['0xSmartAccountAddress'],
    constraint: { gte: parseUnits('10', 6) },
  }),
);
batch.add(
  usdc.check({
    functionName: 'balanceOf',
    args: ['0xSmartAccountAddress'],
    constraint: { lte: parseUnits('1000', 6) },
  }),
);
```

---

### runtimeBalance

Returns a `RuntimeValue` that resolves to the live ERC-20 balance of an address at execution time. Use it anywhere a static amount argument would go.

```ts
runtimeBalance(params?: {
  owner?: Address;        // defaults to the batch's accountAddress
  constraint?: RuntimeConstraint;
}): RuntimeValue
```

```ts
// Sweep the SCA's full USDC balance to a recipient
batch.add(
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', usdc.runtimeBalance()],
  }),
);

// Read from a different address
batch.add(
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', usdc.runtimeBalance({ owner: '0xSomeContractAddress' })],
  }),
);

// With a minimum constraint — reverts if balance < 5 USDC at execution time
batch.add(
  usdc.write({
    functionName: 'transfer',
    args: [
      '0xRecipientAddress',
      usdc.runtimeBalance({ constraint: { gte: parseUnits('5', 6) } }),
    ],
  }),
);
```

---

### runtimeAllowance

Returns a `RuntimeValue` that resolves to the live ERC-20 allowance at execution time.

```ts
runtimeAllowance(params: {
  spender: Address;
  owner?: Address;        // defaults to the batch's accountAddress
  constraint?: RuntimeConstraint;
}): RuntimeValue
```

```ts
const DEX = '0xDexAddress';

// Swap exactly what has been approved — no need to hard-code the allowance
batch.add(
  dex.write({
    functionName: 'swapExactInput',
    args: [
      '0xUsdcAddress',
      '0xWethAddress',
      usdc.runtimeAllowance({ spender: DEX }),
    ],
  }),
);
```

---

## NativeTokenInstance

### balance

Reads the native ETH balance of an address off-chain.

```ts
balance(params?: { address?: Address }): Promise<bigint>
```

```ts
const eth = batch.nativeToken();

// Read the SCA's ETH balance
const ethBalance = await eth.balance();

// Read any address
const otherBalance = await eth.balance({ address: '0xSomeAddress' });
```

---

### runtimeBalance

Returns a `RuntimeValue` that resolves to the live native ETH balance at execution time. Use it as a function argument wherever a `uint256` ETH amount is expected.

```ts
runtimeBalance(params?: {
  address?: Address;      // defaults to the batch's accountAddress
  constraint?: RuntimeConstraint;
}): RuntimeValue
```

```ts
const eth   = batch.nativeToken();
const vault = batch.contract('0xVaultAddress', VAULT_ABI);

// Deposit the SCA's full ETH balance into a vault — amount resolved at execution time
batch.add(
  vault.write({
    functionName: 'deposit',
    args: [eth.runtimeBalance()],
  }),
);

// With a minimum guard
batch.add(
  vault.write({
    functionName: 'deposit',
    args: [eth.runtimeBalance({ constraint: { gte: parseEther('0.1') } })],
  }),
);
```

---

## RuntimeConstraint

All runtime methods (`runtimeBalance`, `runtimeAllowance`, `runtimeValue`, `check`) accept a single `RuntimeConstraint`.

**Standard constraints** (unsigned — value is treated as `uint256`):

| Shape | Description |
|---|---|
| `{ eq: value }` | Resolved value must equal `value` exactly |
| `{ gte: value }` | Resolved value must be ≥ `value` |
| `{ lte: value }` | Resolved value must be ≤ `value` |

The `value` can be `bigint`, `boolean`, `Hex`, or `Address`.

**Signed constraints** (value is treated as `int256`; use when the resolved value may be negative):

| Shape | Description |
|---|---|
| `{ gteSigned: value }` | Resolved value (as `int256`) must be ≥ `value` |
| `{ lteSigned: value }` | Resolved value (as `int256`) must be ≤ `value` |

The `value` must be a `bigint` (negative bigints are valid).

**OR constraint** (passes if at least one child constraint passes):

| Shape | Description |
|---|---|
| `{ or: ChildConstraint[] }` | Passes if **any one** of the listed child constraints passes |

Children inside `or` must be standard or signed constraints — nested `or` is not supported.

To require multiple conditions simultaneously, make multiple separate `check()` / `runtimeValue()` calls — each gets its own constraint. Examples:

```ts
// Single constraint
constraint: { gte: parseUnits('10', 6) }

// Signed constraint (e.g. a price delta that may be negative)
constraint: { gteSigned: -100n }

// OR: balance must be exactly 0 OR at least 10 USDC
constraint: { or: [{ eq: 0n }, { gte: parseUnits('10', 6) }] }

// Range check: use two separate check() calls
batch.add(usdc.check({ functionName: 'balanceOf', args: [owner], constraint: { gte: parseUnits('10', 6) } }));
batch.add(usdc.check({ functionName: 'balanceOf', args: [owner], constraint: { lte: parseUnits('1000', 6) } }));
```
