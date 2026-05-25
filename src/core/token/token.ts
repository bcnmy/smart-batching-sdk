import type { Address, Chain, PublicClient, Transport } from 'viem';
import { erc20Abi } from 'viem';
import { createContract } from '../contract';
import {
  runtimeERC20AllowanceOf,
  runtimeERC20BalanceOf,
  runtimeNativeBalanceOf,
  toConstraintFields,
} from '../encoding';
import type { ERC20TokenInstance, NativeTokenInstance } from './types';

function resolveAddress(
  provided: Address | undefined,
  fallback: Address | undefined,
  label: string,
): Address {
  const resolved = provided ?? fallback;
  if (!resolved) throw new Error(`${label} is required`);
  return resolved;
}

export function createERC20Token<
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = Chain | undefined,
>(
  publicClient: PublicClient<TTransport, TChain>,
  address: Address,
  accountAddress?: Address,
): ERC20TokenInstance {
  const contractInstance = createContract(publicClient, address, erc20Abi, accountAddress);

  return {
    address,
    abi: erc20Abi,
    read({ functionName, args }) {
      return publicClient.readContract({ abi: erc20Abi, address, functionName, args });
    },
    write({ functionName, args, value, capture }) {
      return contractInstance.write({ functionName, args, value, capture });
    },
    check({ functionName, args, constraint }) {
      return contractInstance.check({ functionName, args, constraint });
    },
    runtimeBalance({ owner, constraint } = {}) {
      return runtimeERC20BalanceOf({
        targetAddress: resolveAddress(owner, accountAddress, 'owner'),
        tokenAddress: address,
        constraints: toConstraintFields(constraint),
      });
    },
    runtimeAllowance({ spender, owner, constraint }) {
      return runtimeERC20AllowanceOf({
        owner: resolveAddress(owner, accountAddress, 'owner'),
        spender,
        tokenAddress: address,
        constraints: toConstraintFields(constraint),
      });
    },
  };
}

export function createNativeToken<
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = Chain | undefined,
>(publicClient: PublicClient<TTransport, TChain>, accountAddress?: Address): NativeTokenInstance {
  return {
    balance({ address } = {}) {
      return publicClient.getBalance({
        address: resolveAddress(address, accountAddress, 'address'),
      });
    },
    runtimeBalance({ address, constraint } = {}) {
      return runtimeNativeBalanceOf({
        targetAddress: resolveAddress(address, accountAddress, 'address'),
        constraints: toConstraintFields(constraint),
      });
    },
  };
}
