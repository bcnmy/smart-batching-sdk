import {
  type Abi,
  type AbiParameter,
  type Address,
  type ContractFunctionName,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  type Hex,
  isAddress,
  isHex,
  zeroAddress,
} from 'viem';
import { NAMESPACE_STORAGE_CONTRACT_ADDRESS } from '../storage/constants';
import { getBaseStorageSlot } from '../storage/slot';
import type { AnyData } from '../types';
import { COMPOSABILITY_MODULE_ABI_V1_1_0, CONSTRAINT_TUPLE_ABI } from './abis';
import {
  encodeAddress,
  encodeRuntimeFunctionData,
  getFunctionContextFromAbi,
} from './runtimeAbiEncoding';
import {
  type Capture,
  type ChildConstraint,
  type ComposableCall,
  type Constraint,
  type ConstraintField,
  ConstraintType,
  type InputParam,
  InputParamFetcherType,
  InputParamType,
  type OutputParam,
  OutputParamFetcherType,
  type RuntimeBalanceOfParams,
  type RuntimeConstraint,
  type RuntimeNativeBalanceOfParams,
  type RuntimeParamViaCustomStaticCallParams,
  type RuntimeValue,
  type runtimeERC20AllowanceOfParams,
} from './types';
import { isRuntimeComposableValue, toBytes32 } from './utils';

export const prepareInputParam = (
  fetcherType: InputParamFetcherType,
  paramData: string,
  constraints: Constraint[] = [],
): InputParam => {
  return { fetcherType, paramData, constraints };
};

export const prepareOutputParam = (
  fetcherType: OutputParamFetcherType,
  paramData: string,
): OutputParam => {
  return { fetcherType, paramData };
};

export const prepareConstraint = (
  constraintType: ConstraintType,
  referenceData: string,
): Constraint => {
  return { constraintType, referenceData };
};

// type any is being implicitly used. The appropriate value validation happens in the runtime function
export const greaterThanOrEqualTo = (value: AnyData): ConstraintField => {
  return { type: ConstraintType.GTE, value };
};

// type any is being implicitly used. The appropriate value validation happens in the runtime function
export const lessThanOrEqualTo = (value: AnyData): ConstraintField => {
  return { type: ConstraintType.LTE, value };
};

// type any is being implicitly used. The appropriate value validation happens in the runtime function
export const equalTo = (value: AnyData): ConstraintField => {
  return { type: ConstraintType.EQ, value };
};

// type any is being implicitly used. The appropriate value validation happens in the runtime function
export const greaterThanOrEqualToSigned = (value: AnyData): ConstraintField => {
  return { type: ConstraintType.GTE_SIGNED, value };
};

// type any is being implicitly used. The appropriate value validation happens in the runtime function
export const lessThanOrEqualToSigned = (value: AnyData): ConstraintField => {
  return { type: ConstraintType.LTE_SIGNED, value };
};

// value is ConstraintField[] — the sub-constraints that will be ABI-encoded as OR's referenceData
export const orConstraint = (subConstraints: ConstraintField[]): ConstraintField => {
  return { type: ConstraintType.OR, value: subConstraints };
};

export const runtimeParamViaCustomStaticCall = ({
  targetContractAddress,
  functionAbi,
  functionName,
  args,
  constraints = [],
}: RuntimeParamViaCustomStaticCallParams): RuntimeValue => {
  const encodedParam = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [
      targetContractAddress,
      encodeFunctionData({
        abi: functionAbi,
        functionName: functionName,
        args,
      }),
    ],
  );

  const constraintsToAdd = validateAndProcessConstraints(constraints);

  return {
    isRuntime: true,
    inputParams: [
      prepareInputParam(InputParamFetcherType.STATIC_CALL, encodedParam, constraintsToAdd),
    ],
    outputParams: [],
  };
};

/**
 * Returns the runtime value for the ERC20 allowance of the owner for the spender
 * @param owner - The owner of the tokens
 * @param spender - The spender of the tokens
 * @param tokenAddress - The address of the ERC20 token
 * @returns The runtime value for the ERC20 allowance of the owner for the spender
 */
export const runtimeERC20AllowanceOf = ({
  owner,
  spender,
  tokenAddress,
  constraints = [],
}: runtimeERC20AllowanceOfParams): RuntimeValue => {
  const encodedParam = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [
      tokenAddress,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, spender],
      }),
    ],
  );

  const constraintsToAdd = validateAndProcessConstraints(constraints);

  return {
    isRuntime: true,
    inputParams: [
      prepareInputParam(InputParamFetcherType.STATIC_CALL, encodedParam, constraintsToAdd),
    ],
    outputParams: [],
  };
};

/**
 * Returns the runtime value for the native balance of the target address
 * Utilizes the BALANCE fetcherType
 * @param targetAddress - The address of the target account
 * @returns The runtime value for the native balance of the target address
 */
export const runtimeNativeBalanceOf = ({
  targetAddress,
  constraints = [],
}: RuntimeNativeBalanceOfParams): RuntimeValue => {
  return getBalanceOf({
    targetAddress,
    tokenAddress: zeroAddress,
    constraints,
  });
};

/**
 * Returns the runtime value for the ERC20 balance of the target address
 * @param targetAddress - The address of the target account
 * @param tokenAddress - The address of the ERC20 token
 * @returns The runtime value for the ERC20 balance of the target address
 */
export const runtimeERC20BalanceOf = ({
  targetAddress,
  tokenAddress,
  constraints = [],
}: RuntimeBalanceOfParams): RuntimeValue => {
  return getBalanceOf({
    targetAddress,
    tokenAddress,
    constraints,
  });
};

const getBalanceOf = ({
  targetAddress,
  tokenAddress,
  constraints = [],
}: RuntimeBalanceOfParams): RuntimeValue => {
  const constraintsToAdd = validateAndProcessConstraints(constraints);

  const encodedInputParamData = encodePacked(['address', 'address'], [tokenAddress, targetAddress]);

  return {
    isRuntime: true,
    inputParams: [
      prepareInputParam(InputParamFetcherType.BALANCE, encodedInputParamData, constraintsToAdd),
    ],
    outputParams: [],
  };
};

/**
 * Validates and processes constraints for runtime functions
 * @param constraints - Array of constraint fields to validate and process
 * @returns Array of processed constraints ready for use
 */
const SIGNED_CONSTRAINT_TYPES = new Set<ConstraintType>([
  ConstraintType.GTE_SIGNED,
  ConstraintType.LTE_SIGNED,
]);

// Child types: all constraint types that can appear standalone or inside an OR.
// OR itself is not here — it is handled separately and cannot be nested.
const CHILD_CONSTRAINT_TYPES = new Set<ConstraintType>([
  ConstraintType.EQ,
  ConstraintType.GTE,
  ConstraintType.LTE,
  ConstraintType.GTE_SIGNED,
  ConstraintType.LTE_SIGNED,
]);

/**
 * Validates and encodes a single child constraint (non-OR).
 * Throws if the type is OR — nested OR is not supported by the contract.
 */
const validateAndProcessChildConstraint = (constraint: ConstraintField): Constraint => {
  if (constraint.type === ConstraintType.OR) {
    throw new Error('Nested OR constraints are not supported');
  }

  if (!CHILD_CONSTRAINT_TYPES.has(constraint.type)) {
    throw new Error('Invalid constraint type');
  }

  const isSigned = SIGNED_CONSTRAINT_TYPES.has(constraint.type);

  if (isSigned) {
    // Signed constraints only accept bigint (including negative)
    if (typeof constraint.value !== 'bigint') {
      throw new Error('Invalid constraint value: signed constraints require bigint');
    }

    // Encode as int256 to preserve two's-complement representation
    const valueHex = encodeAbiParameters([{ type: 'int256' }], [constraint.value]);
    const encodedConstraintValue = encodeAbiParameters([{ type: 'bytes32' }], [valueHex as Hex]);
    return prepareConstraint(constraint.type, encodedConstraintValue);
  }

  // Unsigned / address / bool / hex path
  if (
    typeof constraint.value !== 'bigint' &&
    typeof constraint.value !== 'boolean' &&
    !isHex(constraint.value) &&
    !isAddress(constraint.value)
  ) {
    throw new Error('Invalid constraint value');
  }

  if (typeof constraint.value === 'bigint' && constraint.value < BigInt(0)) {
    throw new Error('Invalid constraint value');
  }

  const valueHex = toBytes32(constraint.value);
  const encodedConstraintValue = encodeAbiParameters([{ type: 'bytes32' }], [valueHex as Hex]);
  return prepareConstraint(constraint.type, encodedConstraintValue);
};

export const validateAndProcessConstraints = (constraints: ConstraintField[]): Constraint[] => {
  const constraintsToAdd: Constraint[] = [];

  for (const constraint of constraints) {
    if (constraint.type === ConstraintType.OR) {
      // value must be ConstraintField[] — the sub-constraints to OR together
      if (!Array.isArray(constraint.value) || constraint.value.length === 0) {
        throw new Error('OR constraint must have at least one sub-constraint');
      }

      // Process each sub-constraint through the child path — nested OR is rejected inside
      const processedSubs: Constraint[] = (constraint.value as ConstraintField[]).map(
        validateAndProcessChildConstraint,
      );

      // Encode the Constraint[] array as abi.encode(Constraint[]) — what the contract decodes
      const encodedSubs = encodeAbiParameters(
        [CONSTRAINT_TUPLE_ABI],
        [
          processedSubs.map((c) => ({
            constraintType: c.constraintType,
            referenceData: c.referenceData as Hex,
          })),
        ],
      );

      constraintsToAdd.push(prepareConstraint(ConstraintType.OR, encodedSubs));
    } else {
      constraintsToAdd.push(validateAndProcessChildConstraint(constraint));
    }
  }

  return constraintsToAdd;
};

/**
 * Maps the user-facing RuntimeConstraint format to the internal ConstraintField format.
 */
const toChildConstraintField = (c: ChildConstraint): ConstraintField => {
  if ('gte' in c) return greaterThanOrEqualTo(c.gte);
  if ('lte' in c) return lessThanOrEqualTo(c.lte);
  if ('gteSigned' in c) return greaterThanOrEqualToSigned(c.gteSigned);
  if ('lteSigned' in c) return lessThanOrEqualToSigned(c.lteSigned);
  return equalTo(c.eq);
};

export const toConstraintFields = (constraint?: RuntimeConstraint): ConstraintField[] => {
  if (constraint === undefined) return [];
  if ('or' in constraint) return [orConstraint(constraint.or.map(toChildConstraintField))];
  return [toChildConstraintField(constraint)];
};

export const prepareTargetAndValueInputParams = (
  to: Address | RuntimeValue,
  value?: bigint | RuntimeValue,
): {
  targetInputParam: InputParam;
  valueInputParam: InputParam | undefined;
} => {
  // Prepare target and value input params
  // if to is of type Address, then we need to prepare the target input param as raw_bytes
  // else if to is of type RuntimeValue, then we need to prepare the target input param
  let targetInputParam: InputParam;
  if (isAddress(to as Address)) {
    targetInputParam = {
      paramType: InputParamType.TARGET,
      fetcherType: InputParamFetcherType.RAW_BYTES,
      paramData: encodeAddress(to as Hex).data[0] as `0x${string}`,
      constraints: [],
    };
  } else {
    targetInputParam = {
      ...(to as RuntimeValue).inputParams[0],
      paramType: InputParamType.TARGET,
    };
  }

  let valueInputParam: InputParam | undefined;
  if (!value) {
    // value not provided, default to 0
    valueInputParam = undefined;
    // undefined valueInputParam would not be added to the composable call
    // and then the smart contract will use the default value of 0
    // thus saving gas on processing one input param
  } else if ((value as RuntimeValue).isRuntime && (value as RuntimeValue).inputParams.length > 0) {
    // value is a runtime value, use the first input param
    valueInputParam = {
      ...(value as RuntimeValue).inputParams[0],
      paramType: InputParamType.VALUE,
    };
  } else {
    // value is a static value, use it as raw_bytes
    if (value !== 0n) {
      valueInputParam = {
        paramType: InputParamType.VALUE,
        fetcherType: InputParamFetcherType.RAW_BYTES,
        paramData: (value as bigint).toString(16).padStart(64, '0') as `0x${string}`,
        constraints: [],
      };
    }
  }
  return { targetInputParam, valueInputParam };
};

export const prepareComposableInputCalldataParams = (inputs: AbiParameter[], args: AnyData[]) => {
  const composableParams = encodeRuntimeFunctionData(inputs, args).map((calldata) => {
    if (isRuntimeComposableValue(calldata)) {
      // Just handling input params here. In future, we may need to add support for output params as well
      return (calldata as RuntimeValue)?.inputParams;
    }

    // These are non runtime values which are encoded by the encodeRuntimeFunctionData helper.
    // These params are injected are individual raw bytes which will be combined on the composable contract
    return [prepareInputParam(InputParamFetcherType.RAW_BYTES, calldata as Hex)];
  });

  // Head Params,Head Params,Head Params + (len + Tail Params),(len + Tail Params),(len + Tail Params)
  // Static type doesn't have tail
  // Dynamic types have tail params where the head only have offset which points the dynamic param in tail
  return composableParams.flat();
};

/// @dev This is a helper function for composable pseudo-dynamic `bytes` values.
/// which are in fact several static values abi.encoded together
/// and we want one of those static values to be runtime value
/// so what we do here is we just treat runtimeAbiEncode as pseudo-function composable call
/// and just mimic the process of encoding the params for it.
/// it prepares the independent encoding with internal offsets for dynamic params, so
/// every `runtimeAbiEncode` can has nested `runtimeAbiEncode`-s inside it
export const runtimeEncodeAbiParameters = (
  // mimics the interface of the og encodeAbiParameters
  // but is able to work with runtime values
  inputs: AbiParameter[],
  args: AnyData[],
): RuntimeValue => {
  // prepare functionContext and args out of what this helper is expecting
  const inputParams: InputParam[] = prepareComposableInputCalldataParams(inputs, args);

  // so in the upper level function call encoding, there will be a runtime dynamic `bytes` argument
  // wrapped into a RuntimeValue object with several InputParam's.
  // Some of those params will be runtime values (fetcherType: STATIC_CALL)
  // and some of them will be raw bytes (fetcherType: RAW_BYTES)
  // So we should account for that in the `encodeParams` method
  return {
    isRuntime: true,
    inputParams: inputParams,
    outputParams: [],
  };
};

/**
 * Compresses the input params by merging the input params with InputParamFetcherType.RAW_BYTES
 * and no constraints together
 * It does this by creating a new InputParam with InputParamFetcherType.RAW_BYTES and no constraints
 * and paramData as the concat of paramData's
 * It allows for less input params in the composable call => less iterations in the composable smart contract
 * => less gas used
 */
export const compressCalldataInputParams = (inputParams: InputParam[]): InputParam[] => {
  const compressedParams: InputParam[] = [];
  let currentParam: InputParam = {
    fetcherType: InputParamFetcherType.RAW_BYTES,
    constraints: [],
    paramData: '',
  };
  // compress only calldata input params
  for (const param of inputParams) {
    if (param.paramType === InputParamType.TARGET || param.paramType === InputParamType.VALUE) {
      throw new Error('Target or value input params should not be compressed');
    }
    // Static call, balance or constraint based params are left as is
    if (
      param.fetcherType === InputParamFetcherType.STATIC_CALL ||
      param.fetcherType === InputParamFetcherType.BALANCE ||
      param.constraints.length > 0
    ) {
      // If there is a current param, push it to the compressed params
      // and reset the current param
      if (currentParam.paramData.length > 0) {
        compressedParams.push(currentParam);
        currentParam = {
          fetcherType: InputParamFetcherType.RAW_BYTES,
          constraints: [],
          paramData: '',
        };
      }
      compressedParams.push(param);
      continue;
    }

    // If the current param is a raw bytes param with no constraints, merge it with the current param
    currentParam.paramData = concatHex([
      currentParam.paramData as `0x${string}`,
      param.paramData as `0x${string}`,
    ]);
  }

  // If there is a non-empty current param, push it to the compressed params
  if (currentParam.paramData.length > 0) {
    compressedParams.push(currentParam);
  }

  return compressedParams;
};

export const formatInputParams = (inputParams: InputParam[], address: Address, value?: bigint) => {
  const compressedInputParams = compressCalldataInputParams(inputParams);

  // for composability version 1.1.0+, we need to add paramType: CALL_DATA to the input params
  // since the input param type field is required for composability version 1.1.0+
  const formattedInputParams = compressedInputParams.map((param) => ({
    ...param,
    paramType: InputParamType.CALL_DATA,
  }));

  const { targetInputParam, valueInputParam } = prepareTargetAndValueInputParams(address, value);

  return [
    ...formattedInputParams,
    targetInputParam,
    ...(valueInputParam ? [valueInputParam] : []), // do not add valueInputParam if it is undefined
  ];
};

/**
 * Returns true when the ABI parameter is a static (fixed-size) type.
 * Dynamic types — `bytes`, `string`, unbounded arrays (`T[]`), and tuples or
 * fixed arrays whose components contain dynamic types — return false.
 */
function isStaticAbiType(param: AbiParameter): boolean {
  const { type } = param;

  if (type === 'bytes' || type === 'string') return false;
  if (type.endsWith('[]')) return false; // unbounded dynamic arrays

  // Plain tuple: static only when every component is static
  if (type === 'tuple') {
    const components = ('components' in param ? param.components : undefined) ?? [];
    return (components as AbiParameter[]).every(isStaticAbiType);
  }

  // Fixed-size array (e.g. uint256[5], bytes32[3], tuple[2]):
  // recurse on the base type, carrying components for tuple bases
  const fixedArrayMatch = type.match(/^(.+)\[\d+\]$/);
  if (fixedArrayMatch) {
    const baseType = fixedArrayMatch[1];
    const baseParam: AbiParameter =
      baseType === 'tuple'
        ? ({
            type: 'tuple',
            ...('components' in param && { components: param.components }),
          } as AbiParameter)
        : ({ type: baseType } as AbiParameter);
    return isStaticAbiType(baseParam);
  }

  // uint<M>, int<M>, bool, address, bytes<M> — all static
  return true;
}

/**
 * Builds the `outputParams` array for a composable write call from a {@link Capture} descriptor.
 *
 * - `execResult` — validates that every output of the called function is a static ABI type
 *   (dynamic types are not supported by the module) and produces a single EXEC_RESULT OutputParam.
 * - `staticCall` — produces a single STATIC_CALL OutputParam encoding the target address and
 *   calldata of the post-execution static call to fetch.
 *
 * @param outputs - The ABI output parameters of the write function (from {@link FunctionContext}).
 * @param capture - The capture descriptor, or `undefined` to return an empty array.
 */
export const prepareComposableOutputCalldataParams = async <
  TAbi extends Abi | readonly unknown[],
  TFunctionName extends ContractFunctionName<TAbi, 'pure' | 'view'>,
>(
  outputs: readonly AbiParameter[],
  capture: Capture<TAbi, TFunctionName>,
  accountAddress?: Address,
  callerAddress?: Address,
): Promise<OutputParam[]> => {
  if (!accountAddress) {
    throw new Error(
      'capture requires an accountAddress for storage slot generation — use batch.contract() or pass accountAddress to createContract()',
    );
  }

  const resolvedCallerAddress = callerAddress ?? accountAddress;

  // Derive the base storage slot from the provided key (or generate a unique default).
  // The composability module receives this base slot and derives indexed slots from it:
  //   slot_i = keccak256(abi.encodePacked(baseSlot, uint256(i)))
  const slot: Hex = await getBaseStorageSlot(
    accountAddress,
    resolvedCallerAddress,
    capture.storageKey,
  );

  if (capture.type === 'execResult') {
    if (outputs.length === 0) {
      throw new Error('capture execResult: the function has no return values to capture');
    }

    outputs.forEach((output, index) => {
      if (!isStaticAbiType(output)) {
        throw new Error(
          `capture execResult: return value at index ${index} has dynamic type "${output.type}" which is not supported — all return types must be static ABI types`,
        );
      }
    });

    // paramData mirrors: abi.encode(count, storageContract, slot)
    const paramData = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }],
      [BigInt(outputs.length), NAMESPACE_STORAGE_CONTRACT_ADDRESS, slot],
    );

    return [prepareOutputParam(OutputParamFetcherType.EXEC_RESULT, paramData)];
  }

  // staticCall — derive output count from the static call function's own ABI
  const captureAbi = capture.abi as Abi;
  const staticCallContext = getFunctionContextFromAbi(capture.functionName, captureAbi);
  const staticCallOutputs = staticCallContext.outputs;

  if (staticCallOutputs.length === 0) {
    throw new Error('capture staticCall: the static call function has no return values to capture');
  }

  staticCallOutputs.forEach((output, index) => {
    if (!isStaticAbiType(output)) {
      throw new Error(
        `capture staticCall: return value at index ${index} has dynamic type "${output.type}" which is not supported — all return types must be static ABI types`,
      );
    }
  });

  const calldata = encodeFunctionData({
    abi: captureAbi,
    functionName: capture.functionName as string,
    args: capture.args as AnyData[],
  });

  // paramData mirrors: abi.encode(count, targetAddress, calldata, storageContract, slot)
  const paramData = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'address' },
      { type: 'bytes' },
      { type: 'address' },
      { type: 'bytes32' },
    ],
    [
      BigInt(staticCallOutputs.length),
      capture.targetAddress,
      calldata,
      NAMESPACE_STORAGE_CONTRACT_ADDRESS,
      slot,
    ],
  );

  return [prepareOutputParam(OutputParamFetcherType.STATIC_CALL, paramData)];
};

/**
 * @description Encodes a composable calls for execution
 * @param call - The calls to encode
 * @returns The encoded composable compatible call
 */
export const encodeExecuteComposable = (calls: ComposableCall[]): Hex => {
  const composableCalls = calls.map((call) => {
    return {
      functionSig: call.functionSig,
      inputParams: call.inputParams,
      outputParams: call.outputParams,
    };
  });

  return encodeFunctionData({
    abi: COMPOSABILITY_MODULE_ABI_V1_1_0,
    functionName: 'executeComposable', // Function selector in Composability module which executes the composable calls.
    args: [composableCalls], // Multiple composable calls can be batched here.
  });
};
