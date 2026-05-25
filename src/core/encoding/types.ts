import type {
  Abi,
  AbiParameter,
  Address,
  ContractFunctionArgs,
  ContractFunctionName,
  Hex,
} from 'viem';
import type { AnyData } from '../types';

/**
 * fetcherType: Defines how to fetch the param
 * paramData: The data that is used during fetching the param
 * constraints: The constraints that the resulting param needs to satisfy
 * paramType: The type of the param. This field is optional and it is introduced in the composability version 1.1.0
 * If earlier versions are used, this field may not not present.
 */
export interface InputParam {
  paramType?: InputParamType;
  fetcherType: InputParamFetcherType;
  paramData: string;
  constraints: Constraint[];
}

export interface OutputParam {
  fetcherType: OutputParamFetcherType;
  paramData: string;
}

/**
 * paramType: The type of the param.
 * TARGET: The target address => used as a target address for the call
 * VALUE: The value => used as a native value for the call
 * CALL_DATA: processed param will be part of the calldata for the call
 * This field is optional and it is introduced in the composability version 1.1.0
 * If earlier versions are used, this field may not not present.
 */
export const InputParamType = {
  TARGET: 0,
  VALUE: 1,
  CALL_DATA: 2,
} as const;

/**
 * fetcherType: Defines how to fetch the param
 * RAW_BYTES: just use param data as is (raw bytes)
 * STATIC_CALL: param data defines the params for the static call
 * Outputs of the static call will form the processed param
 * BALANCE: param data defines the params for the balance query
 */
export const InputParamFetcherType = {
  RAW_BYTES: 0,
  STATIC_CALL: 1,
  BALANCE: 2,
} as const;

export const OutputParamFetcherType = {
  EXEC_RESULT: 0,
  STATIC_CALL: 1,
} as const;

export const ConstraintType = {
  EQ: 0,
  GTE: 1,
  LTE: 2,
  IN: 3,
  GTE_SIGNED: 4,
  LTE_SIGNED: 5,
  OR: 6,
} as const;

export type InputParamFetcherType =
  (typeof InputParamFetcherType)[keyof typeof InputParamFetcherType];
export type OutputParamFetcherType =
  (typeof OutputParamFetcherType)[keyof typeof OutputParamFetcherType];
export type ConstraintType = (typeof ConstraintType)[keyof typeof ConstraintType];
export type InputParamType = (typeof InputParamType)[keyof typeof InputParamType];

export interface Constraint {
  constraintType: ConstraintType;
  referenceData: string;
}

/**
 * Base composable call type
 * @param functionSig - The function signature of the composable call
 * @param inputParams - The input parameters of the composable call
 * @param outputParams - The output parameters of the composable call
 * Since Composability version 1.1.0, to and value are not required
 * as they are replaced by the input params with according types (TARGET, VALUE)
 */
export interface ComposableCall {
  functionSig: string;
  inputParams: InputParam[];
  outputParams: OutputParam[];
}

export interface ConstraintField {
  type: ConstraintType;
  value: AnyData; // type any is being implicitly used. The appropriate value validation happens in the runtime function
}

/** Accepted value types for a constraint */
type ConstraintValue = bigint | boolean | Hex | Address;

/**
 * A single-value constraint. These are the only types allowed inside an OR group.
 * OR cannot be nested inside another OR.
 */
export type ChildConstraint =
  | { gte: ConstraintValue }
  | { lte: ConstraintValue }
  | { eq: ConstraintValue }
  | { gteSigned: bigint }
  | { lteSigned: bigint };

/**
 * User-facing constraint format. Pass as the `constraint` argument to any runtimeXxx or check method.
 * OR evaluates its sub-constraints and passes if at least one is satisfied.
 * OR cannot be nested inside another OR.
 * @example { gte: 1000n }
 * @example { or: [{ eq: 0n }, { gte: 100n }] }
 */
export type RuntimeConstraint = ChildConstraint | { or: ChildConstraint[] };

export interface RuntimeParamViaCustomStaticCallParams {
  targetContractAddress: Address;
  functionAbi: Abi;
  args: AnyData[];
  functionName: string;
  constraints?: ConstraintField[];
}

export interface runtimeERC20AllowanceOfParams {
  owner: Address;
  spender: Address;
  tokenAddress: Address;
  constraints?: ConstraintField[];
}

export interface RuntimeBalanceOfParams {
  targetAddress: Address;
  tokenAddress: Address;
  constraints?: ConstraintField[];
}

export type RuntimeNativeBalanceOfParams = Omit<RuntimeBalanceOfParams, 'tokenAddress'>;

export interface FunctionContext {
  inputs: readonly AbiParameter[];
  outputs: readonly AbiParameter[];
  name: string;
  functionType: 'read' | 'write';
  functionSig: string;
}

export interface RuntimeValue {
  isRuntime: boolean;
  inputParams: InputParam[];
  outputParams: OutputParam[];
}

/**
 * Describes how to capture the output of a composable write call via an OutputParam.
 *
 * - `execResult` — captures the return value(s) of the executed call itself.
 *   All return types must be static ABI types; dynamic types (bytes, string, T[]) are not supported.
 *   `storageKey` (optional) — namespace storage key (bigint) passed to `getStorageSlot` to derive the
 *   storage slot. When omitted a unique slot is generated automatically.
 *
 * - `staticCall` — captures a value by making a separate static call after execution.
 *   `functionName`, `abi`, `targetAddress`, `args` — define the static call.
 *   All return types of the static call must be static ABI types.
 *   `storageKey` (optional) — namespace storage key (bigint) passed to `getStorageSlot` to derive the
 *   storage slot. When omitted a unique slot is generated automatically.
 */
export type Capture<
  TAbi extends Abi | readonly unknown[] = Abi,
  TFunctionName extends ContractFunctionName<TAbi, 'pure' | 'view'> = ContractFunctionName<
    TAbi,
    'pure' | 'view'
  >,
> =
  | { type: 'execResult'; storageKey?: bigint }
  | {
      type: 'staticCall';
      storageKey?: bigint;
      abi: TAbi;
      functionName: TFunctionName;
      targetAddress: Address;
      args: ContractFunctionArgs<TAbi, 'pure' | 'view', TFunctionName>;
    };
