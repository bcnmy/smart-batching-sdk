import type {
  Abi,
  Address,
  ContractFunctionArgs,
  ContractFunctionName,
  ContractFunctionReturnType,
  erc20Abi,
} from 'viem';
import type { ComposableArgs } from '../contract';
import type { Capture, ComposableCall, RuntimeConstraint, RuntimeValue } from '../encoding';

export type ERC20Abi = typeof erc20Abi;

export interface ERC20RuntimeBalanceParams {
  owner?: Address;
  constraint?: RuntimeConstraint;
}

export interface ERC20RuntimeAllowanceParams {
  spender: Address;
  owner?: Address;
  constraint?: RuntimeConstraint;
}

export interface NativeBalanceParams {
  address?: Address;
}

export interface NativeRuntimeBalanceParams {
  address?: Address;
  constraint?: RuntimeConstraint;
}

export interface ERC20TokenInstance {
  readonly address: Address;
  readonly abi: ERC20Abi;
  read<
    TFunctionName extends ContractFunctionName<ERC20Abi, 'pure' | 'view'>,
    const TArgs extends ContractFunctionArgs<ERC20Abi, 'pure' | 'view', TFunctionName>,
  >(params: {
    functionName: TFunctionName;
    args: TArgs;
  }): Promise<ContractFunctionReturnType<ERC20Abi, 'pure' | 'view', TFunctionName, TArgs>>;
  write<
    TFunctionName extends ContractFunctionName<ERC20Abi, 'nonpayable' | 'payable'>,
    const TArgs extends ContractFunctionArgs<ERC20Abi, 'nonpayable' | 'payable', TFunctionName> &
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
  check<
    TFunctionName extends ContractFunctionName<ERC20Abi, 'pure' | 'view'>,
    const TArgs extends ContractFunctionArgs<ERC20Abi, 'pure' | 'view', TFunctionName>,
  >(params: {
    functionName: TFunctionName;
    args: TArgs;
    constraint: RuntimeConstraint;
  }): ComposableCall;
  runtimeBalance(params?: ERC20RuntimeBalanceParams): RuntimeValue;
  runtimeAllowance(params: ERC20RuntimeAllowanceParams): RuntimeValue;
}

export interface NativeTokenInstance {
  balance(params?: NativeBalanceParams): Promise<bigint>;
  runtimeBalance(params?: NativeRuntimeBalanceParams): RuntimeValue;
}
