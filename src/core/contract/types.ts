import type {
  Abi,
  Address,
  ContractFunctionArgs,
  ContractFunctionName,
  ContractFunctionReturnType,
} from 'viem';
import type { Capture, ComposableCall, RuntimeConstraint, RuntimeValue } from '../encoding';

/**
 * Recursively allows RuntimeValue at any depth — inside arrays, struct fields, or at the top level.
 * This mirrors the encoding layer, which already handles RuntimeValue at any nesting level.
 *
 * - Primitive (bigint, string, boolean, …): T | RuntimeValue
 * - Array:  (DeepComposable<Element> | RuntimeValue)[] | RuntimeValue
 * - Object: { [K]: DeepComposable<V> } | RuntimeValue
 */
type DeepComposable<T> = T extends readonly (infer U)[]
  ? readonly (DeepComposable<U> | RuntimeValue)[] | RuntimeValue
  : T extends object
    ? { [K in keyof T]: DeepComposable<T[K]> } | RuntimeValue
    : T | RuntimeValue;

/**
 * Maps each top-level arg in an ABI args tuple to its deeply-composable form,
 * allowing RuntimeValue at any nesting level within each argument.
 */
export type ComposableArgs<T extends readonly unknown[]> = {
  [K in keyof T]: DeepComposable<T[K]>;
};

export interface ContractInstance<TAbi extends Abi | readonly unknown[]> {
  readonly address: Address;
  readonly abi: TAbi;
  read<
    TFunctionName extends ContractFunctionName<TAbi, 'pure' | 'view'>,
    const TArgs extends ContractFunctionArgs<TAbi, 'pure' | 'view', TFunctionName>,
  >(params: {
    functionName: TFunctionName;
    args: TArgs;
  }): Promise<ContractFunctionReturnType<TAbi, 'pure' | 'view', TFunctionName, TArgs>>;
  write<
    TFunctionName extends ContractFunctionName<TAbi, 'nonpayable' | 'payable'>,
    const TArgs extends ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TFunctionName> &
      readonly unknown[],
    const TCaptureAbi extends Abi | readonly unknown[] = Abi,
    TCaptureFunction extends ContractFunctionName<
      TCaptureAbi,
      'pure' | 'view'
    > = ContractFunctionName<TCaptureAbi, 'pure' | 'view'>,
  >(params: {
    functionName: TFunctionName;
    args: ComposableArgs<TArgs>;
    value?: bigint;
    capture?: Capture<TCaptureAbi, TCaptureFunction>;
  }): Promise<ComposableCall>;
  runtimeValue<
    TFunctionName extends ContractFunctionName<TAbi, 'pure' | 'view'>,
    const TArgs extends ContractFunctionArgs<TAbi, 'pure' | 'view', TFunctionName>,
  >(params: {
    functionName: TFunctionName;
    args: TArgs;
    constraint?: RuntimeConstraint;
  }): RuntimeValue;
  check<
    TFunctionName extends ContractFunctionName<TAbi, 'pure' | 'view'>,
    const TArgs extends ContractFunctionArgs<TAbi, 'pure' | 'view', TFunctionName>,
  >(params: {
    functionName: TFunctionName;
    args: TArgs;
    constraint: RuntimeConstraint;
  }): ComposableCall;
}
