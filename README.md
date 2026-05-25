# @biconomy/smart-batching

**Type-safe SDK for building composable ERC-8211 transactions on EVM smart accounts.**

With composable transactions, you describe what should happen — not just what to call. Three primitives make this possible:

- **Call dependencies** — wire the output of one on-chain call directly into the input of the next, resolved at execution time. No need to know the value when building the transaction.
- **Pre- and post-conditions** — assert the state of the chain before and after your writes. If any condition fails, the entire transaction reverts atomically and no partial state is committed.
- **On-chain constraints** — attach bounds (`eq`, `gte`, `lte`, `gteSigned`, `lteSigned`) to any runtime value, or combine alternatives with `or`. The composability module enforces them during execution, acting as slippage guards, balance floors, or exact-match assertions.

---

## Table of Contents

- [What is ERC-8211?](#what-is-erc-8211)
- [How composability works](#how-composability-works)
  - [Pre-conditions and post-conditions](#pre-conditions-and-post-conditions)
  - [Runtime values](#runtime-values)
  - [On-chain constraints](#on-chain-constraints)
- [Installation](#installation)
- [Smart Batching Core](#smart-batching-core)
  - [createComposableBatch](#createcomposablebatch)
  - [batch.add](#batchadd)
  - [batch.toCalls and batch.toCalldata](#batchtocalls-and-batchtocalldata)
- [Storage Writes](#storage-writes)
  - [Capture and runtime read](#capture-and-runtime-read)
  - [Explicit write and runtime read](#explicit-write-and-runtime-read)
- [SDK Reference](#sdk-reference)

---

## What is ERC-8211?

[ERC-8211](https://erc8211.com/) is an Ethereum standard that introduces **composable execution** for smart accounts. It defines a module interface that allows a UserOperation to express rich execution logic entirely on-chain: runtime dependencies between calls (the return value of one call becomes an argument to the next), pre- and post-condition assertions that revert the entire batch if violated, and value constraints that act as slippage guards or exact-match checks — all resolved during execution.

Key references:

- **Standard**: [https://erc8211.com/](https://erc8211.com/)
- **EIP discussion**: [https://ethereum-magicians.org/t/erc-8211](https://ethereum-magicians.org/t/erc-8211-composable-modular-smart-account-executions/21994)

### The problem ERC-8211 solves

Traditional transactions are static — all calldata is fixed at signing time, and there is no way to express conditions or dependencies between calls. This forces developers into bad patterns:

1. **Over-estimate and waste** — approve or transfer more than needed because the exact amount is unknown until execution
2. **Multi-step transactions** — execute one UserOp to read a value, then a second to act on it, with a race condition window in between
3. **No safety guarantees** — no way to assert that a swap met a minimum output, a balance is sufficient before transferring, or a pool was fully swept after execution

ERC-8211 eliminates all three. A single transaction can say: _"assert balance ≥ X, then transfer the live balance to recipient, then assert recipient received it"_ — and if any step fails, nothing is committed.

---

## How composability works

A composable batch is a sequence of `ComposableCall` objects. Each call can contain:

- **Static args** — regular values fixed at signing time
- **Runtime values** — placeholders resolved on-chain at execution time from a live balance, allowance, or storage slot
- **Output captures** — instructions to store the return value of a call into a namespace storage slot, making it available as a runtime value for subsequent calls
- **Constraints** — on-chain assertions (`eq`, `gte`, `lte`, `gteSigned`, `lteSigned`, `or`) that revert the entire UserOp if a condition fails

The module resolves the dependency graph and executes each call in order.

---

### Pre-conditions and post-conditions

Pre- and post-conditions are on-chain assertions that guard your batch. They are plain `check` calls placed before or after a write — if any assertion fails, the entire transaction reverts and no state is changed.

**Pre-condition** — verify the world is in the expected state before acting. Common uses: assert a minimum balance exists before a transfer, assert an allowance is sufficient before a swap.

**Post-condition** — verify the outcome after a write. Common uses: assert a recipient received funds, assert a pool position was created, assert a token was fully swept.

```ts
const USDC      = '0xUsdcAddress';
const recipient = '0xRecipientAddress';

const batch  = createComposableBatch(publicClient, scaAddress);
const usdc   = batch.erc20Token(USDC);
const amount = parseUnits('50', 6); // 50 USDC

batch.add([
  // Pre-condition: SCA must hold at least 50 USDC before we attempt the transfer
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: amount },
  }),

  // Action: transfer 50 USDC to the recipient
  usdc.write({
    functionName: 'transfer',
    args: [recipient, amount],
  }),

  // Post-condition: recipient balance must have increased by at least the transfer amount
  usdc.check({
    functionName: 'balanceOf',
    args: [recipient],
    constraint: { gte: amount },
  }),
]);
```

If the pre-condition fails (SCA doesn't have enough balance), the transfer never happens. If the post-condition fails (recipient didn't receive the expected amount), the entire batch reverts. In both cases, the user pays no gas for a partial outcome.

---

### Runtime values

A runtime value is a placeholder argument whose concrete value is fetched **on-chain at execution time**, not at signing time. This is the core primitive that makes composability possible.

The SDK supports three sources of runtime values:

#### ERC-20 balance at execution time

Use `usdc.runtimeBalance()` to pass the live token balance of any address as an argument. This is the key primitive for "sweep the full balance" patterns — you don't need to know the amount at signing time.

```ts
const USDC      = '0xUsdcAddress';
const recipient = '0xRecipientAddress';

const batch = createComposableBatch(publicClient, scaAddress);
const usdc  = batch.erc20Token(USDC);

batch.add([
  // Transfer whatever USDC the SCA holds at execution time — no fixed amount needed
  usdc.write({
    functionName: 'transfer',
    args: [recipient, usdc.runtimeBalance()],
                       // ^^^ resolved on-chain: balanceOf(scaAddress)
  }),
]);
```

Pass an explicit `owner` to read another address's balance:

```ts
usdc.runtimeBalance({ owner: '0xSomeContractAddress' })
// → resolves to balanceOf(0xSomeContractAddress) at execution time
```

#### ERC-20 allowance at execution time

Use `usdc.runtimeAllowance()` to pass the live allowance as an argument — useful when the exact approved amount is unknown and you want to consume precisely what was approved.

```ts
const USDC = '0xUsdcAddress';
const WETH = '0xWethAddress';
const DEX  = '0xDexAddress';

const batch = createComposableBatch(publicClient, scaAddress);
const usdc  = batch.erc20Token(USDC);
const dex   = batch.contract(DEX, DEX_ABI);

batch.add([
  // Swap exactly what has been approved — no need to hard-code the allowance amount
  dex.write({
    functionName: 'swapExactInput',
    args: [USDC, WETH, usdc.runtimeAllowance({ spender: DEX })],
  }),
]);
```

#### Native ETH balance at execution time

```ts
const batch       = createComposableBatch(publicClient, scaAddress);
const nativeToken = batch.nativeToken();
const vault       = batch.contract('0xVaultAddress', VAULT_ABI);

batch.add([
  // Deposit the SCA's full ETH balance into a yield vault — amount resolved at execution time
  vault.write({
    functionName: 'deposit',
    args: [nativeToken.runtimeBalance()],
  }),
]);
```

#### Custom static call at execution time

For any on-chain view function, use `contract.runtimeValue()` to resolve an arbitrary read at execution time:

```ts
const WETH   = '0xWethAddress';
const USDC   = '0xUsdcAddress';
const DEX    = '0xDexAddress';
const amount = parseUnits('1', 18); // 1 WETH

const batch  = createComposableBatch(publicClient, scaAddress);
const dex    = batch.contract(DEX, DEX_ABI);
const oracle = batch.contract('0xOracleAddress', ORACLE_ABI);

batch.add([
  // Use the live ETH/USD price from an oracle as the swap limit
  dex.write({
    functionName: 'swapWithPriceLimit',
    args: [
      WETH,
      USDC,
      amount,
      oracle.runtimeValue({ functionName: 'latestPrice', args: [] }),
    ],
  }),
]);
```

---

### On-chain constraints

Constraints are bounds attached to a runtime value or a `check` call. The composability module evaluates them on-chain before using the value — if any constraint fails, the transaction reverts immediately.

The following constraint operators are available:

| Operator | Comparison | Description |
|---|---|---|
| `{ eq: value }` | unsigned | The resolved value must equal `value` exactly |
| `{ gte: value }` | unsigned | The resolved value must be ≥ `value` |
| `{ lte: value }` | unsigned | The resolved value must be ≤ `value` |
| `{ gteSigned: value }` | signed (`int256`) | The resolved value (as `int256`) must be ≥ `value` |
| `{ lteSigned: value }` | signed (`int256`) | The resolved value (as `int256`) must be ≤ `value` |
| `{ or: [...] }` | — | Passes if **any one** of the listed child constraints passes |

Each `check` or `runtimeValue` call accepts one `constraint`. To require multiple conditions simultaneously, use multiple separate calls. Children inside `or` must be standard or signed constraints — nested `or` is not supported.

#### Constraints on a check call

`check` reads a view function and asserts its return value. If the assertion fails, the entire batch reverts before any writes happen.

```ts
// Assert USDC balance is between 10 and 1000 USDC (range check — two separate calls)
usdc.check({ functionName: 'balanceOf', args: [scaAddress], constraint: { gte: parseUnits('10', 6) } })
usdc.check({ functionName: 'balanceOf', args: [scaAddress], constraint: { lte: parseUnits('1000', 6) } })
```

```ts
// Assert the pool has been fully swept — balance must be exactly zero
usdc.check({
  functionName: 'balanceOf',
  args: [poolAddress],
  constraint: { eq: 0n },
})
```

```ts
// Signed constraint — useful when a value may be negative (e.g. a signed price delta)
oracle.check({ functionName: 'priceDelta', args: [], constraint: { gteSigned: -500n } })
oracle.check({ functionName: 'priceDelta', args: [], constraint: { lteSigned: 500n } })
```

```ts
// OR check — balance must be exactly 0 OR at least 10 USDC
usdc.check({
  functionName: 'balanceOf',
  args: [scaAddress],
  constraint: { or: [{ eq: 0n }, { gte: parseUnits('10', 6) }] },
})
```

#### Constraints on a runtime value

Constraints on a runtime value are evaluated before the value is injected into the call. If the live value falls outside the bounds, the transaction reverts before the write executes.

```ts
const USDC       = '0xUsdcAddress';
const DEX        = '0xDexAddress';
const minExpected = parseUnits('5', 6); // must receive at least 5 USDC

const batch = createComposableBatch(publicClient, scaAddress);
const usdc  = batch.erc20Token(USDC);
const dex   = batch.contract(DEX, DEX_ABI);

batch.add([
  dex.write({
    functionName: 'swapExactETH',
    args: [
      USDC,
      // Inject live USDC balance — but only if it is at least minExpected
      usdc.runtimeBalance({ constraint: { gte: minExpected } }),
    ],
    value: parseEther('0.01'),
  }),
]);
```

This pattern is a slippage guard: the batch only proceeds if the post-swap balance meets your minimum expectation, enforced atomically on-chain.

---

## Installation

```bash
# npm
npm install @biconomy/smart-batching viem

# bun
bun add @biconomy/smart-batching viem
```

---

## Smart Batching Core

Everything starts with `createComposableBatch`. It is the central builder that assembles your composable transaction.

### createComposableBatch

```ts
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createComposableBatch } from '@biconomy/smart-batching';

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

const scaAddress = '0xYourSmartAccountAddress';

const batch = createComposableBatch(publicClient, scaAddress);
```

`createComposableBatch` returns a `ComposableBatchInstance` — a fluent builder with typed accessors for tokens, contracts, and storage. It holds pending calls in order and serialises them when you call `toCalls()` or `toCalldata()`.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `publicClient` | `PublicClient` | Viem public client for the target chain |
| `accountAddress` | `Address` | The smart account address executing the batch |

**Returns: `ComposableBatchInstance`**

| Property / Method | Description |
|---|---|
| `publicClient` | The public client passed at construction |
| `accountAddress` | The SCA address |
| `length` | Number of pending calls |
| `erc20Token(address)` | Get an ERC-20 token instance |
| `nativeToken()` | Get a native ETH token instance |
| `contract(address, abi)` | Get a generic contract instance |
| `storage()` | Get a namespace storage instance |
| `add(call \| call[])` | Append one or more calls to the batch |
| `clear()` | Remove all pending calls |
| `toCalls()` | Resolve and return `ComposableCall[]` |
| `toCalldata()` | Encode the full batch as `executeComposable` calldata |

---

### batch.add

`add` accepts a single call or an array of calls and appends them to the batch in order. Calls can be either resolved `ComposableCall` objects or `Promise<ComposableCall>` — the batch resolves all promises when you call `toCalls()`.

```ts
const amount = parseUnits('1', 6); // 1 USDC

const batch = createComposableBatch(publicClient, scaAddress);
const usdc  = batch.erc20Token('0xUsdcAddress');

// Add a single call
batch.add(
  usdc.write({ functionName: 'transfer', args: ['0xRecipientAddress', amount] }),
);

// Add multiple calls at once — order is preserved
batch.add([
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: amount },
  }),
  usdc.write({ functionName: 'transfer', args: ['0xRecipientAddress', amount] }),
]);

console.log(batch.length); // 3
```

Calls added with an array are equivalent to adding them one by one — the order within the array is maintained.

---

### batch.toCalls and batch.toCalldata

Once your batch is assembled, serialise it in the format your execution layer expects.

**`toCalls()`** — resolves all pending calls and returns a `ComposableCall[]`. Use this when your execution client (e.g. MEE) accepts a `calls` array directly:

```ts
const calls = await batch.toCalls();

const quote = await meeClient.getQuote({
  instructions: [
    {
      calls,
      chainId: baseSepolia.id,
      isComposable: true,
    },
  ],
  feeToken: { address: usdcAddress, chainId: baseSepolia.id },
});

const { hash } = await meeClient.executeQuote({ quote });
await meeClient.waitForSupertransactionReceipt({ hash });
```

**`toCalldata()`** — encodes the full batch as `executeComposable` calldata. Use this when you control the UserOp directly via a bundler such as ZeroDev, Alchemy, Pimlico, or any ERC-4337 bundler:

```ts
const calldata = await batch.toCalldata();

// Pass calldata directly as the UserOp callData field
const userOpHash = await kernelClient.sendUserOperation({
  callData: calldata,
});
```

#### Full example — simple ERC-20 transfer batch

```ts
import { createPublicClient, http, parseUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createComposableBatch } from '@biconomy/smart-batching';

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL),
});

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const scaAddress = '0xYourSmartAccountAddress';
const recipient  = '0xRecipientAddress';
const amount     = parseUnits('10', 6); // 10 USDC

const batch = createComposableBatch(publicClient, scaAddress);
const usdc  = batch.erc20Token(USDC);

batch.add([
  // 1. Pre-condition: assert SCA holds at least 10 USDC before transferring
  usdc.check({
    functionName: 'balanceOf',
    args: [scaAddress],
    constraint: { gte: amount },
  }),

  // 2. Transfer exactly 10 USDC to the recipient
  usdc.write({
    functionName: 'transfer',
    args: [recipient, amount],
  }),

  // 3. Post-condition: assert recipient received the funds
  usdc.check({
    functionName: 'balanceOf',
    args: [recipient],
    constraint: { gte: amount },
  }),
]);

const calls = await batch.toCalls();
// → pass `calls` to your execution client
```

The pre- and post-condition checks (`usdc.check`) are enforced **on-chain** during execution. If either constraint fails, the entire transaction reverts atomically — no partial state is committed.

---

## Storage Writes

Namespace storage is an on-chain key-value store scoped to your smart account. It is the bridge that lets one call's data flow into a later call within the same batch — either written explicitly before execution or captured automatically from a call's return value.

Two patterns exist:

| Pattern | How the value gets into storage | How it is read back |
|---|---|---|
| **Capture** | The composability module writes the return value of a call automatically | `storage.runtimeValue()` injects it; `storage.check()` asserts it |
| **Explicit write** | `storage.write()` — you supply the value at signing time | Same — `storage.runtimeValue()`, `storage.check()` |

---

### Capture and runtime read

Use this pattern when the value is not known at signing time — it is the return value of a call that runs earlier in the same batch. Add a `capture` descriptor to any `contract.write()` call and the composability module automatically stores the return value into the namespace storage slot. Later calls can then read it as a runtime value.

Two capture strategies are available:

- **`execResult`** — captures the return value of the write call itself
- **`staticCall`** — after the write executes, makes a separate view call and captures its return value

#### execResult capture

```ts
import { createPublicClient, http, parseUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createComposableBatch } from '@biconomy/smart-batching';

const USDC = '0xUsdcAddress';

const batch              = createComposableBatch(publicClient, scaAddress);
const storage            = batch.storage();
const usdc               = batch.erc20Token(USDC);
const storageWriteExample = batch.contract('0xContractAddress', CONTRACT_ABI);

const storageKey = await storage.getStorageKey();

batch.add([
  // 1. Call oneOutput(5) — return value (10) is captured into storageKey automatically
  storageWriteExample.write({
    functionName: 'oneOutput',
    args: [5n],
    capture: { type: 'execResult', storageKey },
  }),

  // 2. Assert the captured value on-chain
  await storage.check({
    storageKey,
    constraint: { eq: 10n },
  }),

  // 3. Transfer the captured amount to the recipient
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', await storage.runtimeValue({ storageKey })],
  }),
]);
```

When a call returns multiple values, each is stored at an indexed slot derived from the base slot. Access them with `slotIndex`:

```ts
const storageKey = await storage.getStorageKey();

batch.add([
  // multipleOutput(7, 3) returns (sum=10, product=21, greater=true)
  // slotIndex 0 → 10, slotIndex 1 → 21, slotIndex 2 → 1
  storageWriteExample.write({
    functionName: 'multipleOutput',
    args: [7n, 3n],
    capture: { type: 'execResult', storageKey },
  }),

  await storage.check({ storageKey, slotIndex: 0, constraint: { eq: 10n } }),
  await storage.check({ storageKey, slotIndex: 1, constraint: { eq: 21n } }),
  await storage.check({ storageKey, slotIndex: 2, constraint: { eq: 1n } }),
]);
```

#### staticCall capture

Use `staticCall` when the value you want is not the write call's return value but the result of a separate view function — for example, reading an updated balance or price immediately after a state change.

```ts
import type { Abi } from 'viem';

const storageKey = await storage.getStorageKey();

batch.add([
  // Execute a write trigger, then capture the result of a static view call
  storageWriteExample.write({
    functionName: 'oneOutput',
    args: [1n],
    capture: {
      type: 'staticCall',
      abi: CONTRACT_ABI as Abi,
      functionName: 'oneOutputStaticCall',
      targetAddress: '0xContractAddress',
      args: [4n],       // oneOutputStaticCall(4) → 4 * 3 = 12
      storageKey,
    },
  }),

  // Assert the captured static call result on-chain
  await storage.check({
    storageKey,
    constraint: { eq: 12n },
  }),
]);
```

> **Constraint**: all captured return types must be static ABI types. Dynamic types (`bytes`, `string`, `T[]`) are not supported in captures.

---

### Explicit write and runtime read

Use this pattern when you know the value at signing time but need it available as a runtime input to a later call in the same batch. `storage.write()` queues a write call; `storage.runtimeValue()` produces a placeholder that the module resolves to the stored value at execution time.

```ts
import { createPublicClient, http, parseUnits } from 'viem';
import { baseSepolia } from 'viem/chains';
import { createComposableBatch } from '@biconomy/smart-batching';

const USDC = '0xUsdcAddress';

const batch   = createComposableBatch(publicClient, scaAddress);
const storage = batch.storage();
const usdc    = batch.erc20Token(USDC);

// Obtain a unique storage key scoped to this account
const storageKey = await storage.getStorageKey();
const amount     = parseUnits('10', 6); // 10 USDC

batch.add([
  // 1. Write the transfer amount into storage at signing time
  await storage.write({ storageKey, value: amount }),

  // 2. On-chain assertion: the slot must equal the value we just wrote
  await storage.check({
    storageKey,
    constraint: { eq: amount },
  }),

  // 3. Transfer — the amount is resolved from storage at execution time
  usdc.write({
    functionName: 'transfer',
    args: ['0xRecipientAddress', await storage.runtimeValue({ storageKey })],
  }),
]);
```

`storage.getStorageKey()` returns a unique `bigint` key each time it is called, so multiple storage slots within the same batch never collide.

---

## SDK Reference

Detailed SDK reference for each module — all parameters, return types, and focused examples.

| Module | Description |
|---|---|
| [Batch](./docs/batch.md) | `createComposableBatch` — the entry point. Building, assembling, and serialising a composable batch. |
| [Token](./docs/token.md) | `ERC20TokenInstance` and `NativeTokenInstance` — reads, writes, runtime balances, and allowances. |
| [Contract](./docs/contract.md) | `ContractInstance` — generic contract reads, composable writes, runtime values, captures, and checks. |
| [Storage](./docs/storage.md) | `StorageInstance` — namespace storage writes, runtime values, checks, and slot indexing. |
