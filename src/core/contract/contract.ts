import {
  type Abi,
  type Address,
  type Chain,
  encodeAbiParameters,
  encodeFunctionData,
  type PublicClient,
  type Transport,
  zeroAddress,
} from 'viem';
import {
  type ComposableCall,
  formatInputParams,
  type InputParam,
  InputParamFetcherType,
  prepareComposableInputCalldataParams,
  prepareComposableOutputCalldataParams,
  prepareInputParam,
  runtimeParamViaCustomStaticCall,
  toConstraintFields,
  validateAndProcessConstraints,
} from '../encoding';
import { getFunctionContextFromAbi } from '../encoding/runtimeAbiEncoding';
import type { AnyData } from '../types';
import type { ContractInstance } from './types';

export function createContract<
  const TAbi extends Abi | readonly unknown[],
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = Chain | undefined,
>(
  publicClient: PublicClient<TTransport, TChain>,
  address: Address,
  abi: TAbi,
  accountAddress?: Address,
): ContractInstance<TAbi> {
  return {
    address,
    abi,
    read({ functionName, args }) {
      return publicClient.readContract({ abi, address, functionName, args });
    },
    async write({ functionName, args, value, capture }) {
      const functionContext = getFunctionContextFromAbi(functionName, abi as Abi);

      const inputParams: InputParam[] = prepareComposableInputCalldataParams(
        [...functionContext.inputs],
        args as AnyData[],
      );

      const composableCall: ComposableCall = {
        functionSig: functionContext.functionSig,
        inputParams: formatInputParams(inputParams, address, value),
        outputParams: [],
      };

      if (capture) {
        composableCall.outputParams = await prepareComposableOutputCalldataParams(
          functionContext.outputs,
          capture,
          accountAddress,
        );
      }

      return composableCall;
    },
    runtimeValue({ functionName, args, constraint }) {
      return runtimeParamViaCustomStaticCall({
        targetContractAddress: address,
        functionAbi: abi as Abi,
        functionName,
        args: args as AnyData[],
        constraints: toConstraintFields(constraint),
      });
    },
    check({ functionName, args, constraint }) {
      const encodedParam = encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes' }],
        [
          address,
          encodeFunctionData({
            abi: abi as Abi,
            functionName: functionName as string,
            args: args as never[],
          }),
        ],
      );

      const constraintsToAdd = validateAndProcessConstraints(toConstraintFields(constraint));

      const inputParams: InputParam[] = [
        prepareInputParam(InputParamFetcherType.STATIC_CALL, encodedParam, constraintsToAdd),
      ];

      const composableCall: ComposableCall = {
        // Dummy functionSig, as this is a predicate call the calldata execution will not happen
        functionSig: '0x11111111',
        // target address will be always zero address here, which converts this composable call into predicate composable call
        inputParams: formatInputParams(inputParams, zeroAddress),
        // In the current scope, output params are not handled. When more composability functions are added, this will change
        outputParams: [],
      };

      return composableCall;
    },
  };
}
