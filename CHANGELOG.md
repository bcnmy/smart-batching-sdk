# @bcnmy/smart-batching

## 0.1.0

### Minor Changes

---

Initial release of @bcnmy/smart-batching — a TypeScript SDK for building composable ERC-8211 transaction batches for EVM smart accounts.

Features:

- Composable batch builder — chain multiple calls atomically via createComposableBatch
- Pre & post conditions — assert on-chain state before or after any call with check(); revert the entire batch if conditions aren't met
- Runtime values — resolve token balances, allowances, and arbitrary view-function return values at execution time rather than construction time
- On-chain constraints — guard runtime values with gte, lte, eq, gt, lt operators; combine conditions with or
- Signed integer support — constraints work on both unsigned and signed (int256) values
- Namespace storage — write values into a temporary on-chain slot and reference them across steps in the same batch
- Capture / output params — capture a call's return value and pipe it as input to a subsequent call
- ERC-20 & native token helpers — first-class erc20Token() and nativeToken() with runtimeBalance and runtimeAllowance
- Generic contract support — wrap any ABI with full TypeScript inference via batch.contract()
