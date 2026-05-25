import type { Address, Chain, PublicClient, Transport } from 'viem';
import { createContract } from '../contract';
import { toBytes32 } from '../encoding/utils';
import { NAMESPACE_STORAGE_ABI } from './abi';
import { NAMESPACE_STORAGE_CONTRACT_ADDRESS } from './constants';
import { getStorageNamespace, getStorageSlot, getStorageSlotKey } from './slot';
import type {
  CheckStorageParams,
  GetStorageKeyParams,
  RuntimeValueStorageParams,
  StorageInstance,
  WriteStorageParams,
} from './types';

// ---------------------------------------------------------------------------
// StorageInstance factory
// ---------------------------------------------------------------------------

export function createStorage<
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = Chain | undefined,
>(publicClient: PublicClient<TTransport, TChain>, accountAddress: Address): StorageInstance {
  const contractInstance = createContract(
    publicClient,
    NAMESPACE_STORAGE_CONTRACT_ADDRESS,
    NAMESPACE_STORAGE_ABI,
    accountAddress,
  );

  return {
    accountAddress,

    async getStorageKey({
      accountAddress: accountAddressOverride,
      callerAddress: callerAddressOverride,
    }: GetStorageKeyParams = {}) {
      const resolvedAccountAddress = accountAddressOverride ?? accountAddress;
      const resolvedCallerAddress = callerAddressOverride ?? resolvedAccountAddress;
      return getStorageSlotKey(resolvedAccountAddress, resolvedCallerAddress);
    },

    async write({
      value,
      storageKey,
      slotIndex = 0,
      accountAddress: accountAddressOverride,
      callerAddress: callerAddressOverride,
    }: WriteStorageParams) {
      const resolvedAccountAddress = accountAddressOverride ?? accountAddress;
      const resolvedCallerAddress = callerAddressOverride ?? resolvedAccountAddress;

      const slot = await getStorageSlot(
        resolvedAccountAddress,
        resolvedCallerAddress,
        storageKey,
        slotIndex,
      );

      return contractInstance.write({
        functionName: 'writeStorage',
        args: [slot, toBytes32(value), resolvedAccountAddress],
      });
    },

    async runtimeValue({
      constraint,
      storageKey,
      slotIndex = 0,
      accountAddress: accountAddressOverride,
      callerAddress: callerAddressOverride,
    }: RuntimeValueStorageParams = {}) {
      const resolvedAccountAddress = accountAddressOverride ?? accountAddress;
      const resolvedCallerAddress = callerAddressOverride ?? resolvedAccountAddress;

      const slot = await getStorageSlot(
        resolvedAccountAddress,
        resolvedCallerAddress,
        storageKey,
        slotIndex,
      );
      const namespace = getStorageNamespace(resolvedAccountAddress, resolvedCallerAddress);

      return contractInstance.runtimeValue({
        functionName: 'readStorage',
        args: [namespace, slot],
        constraint,
      });
    },

    async check({
      constraint,
      storageKey,
      slotIndex = 0,
      accountAddress: accountAddressOverride,
      callerAddress: callerAddressOverride,
    }: CheckStorageParams) {
      const resolvedAccountAddress = accountAddressOverride ?? accountAddress;
      const resolvedCallerAddress = callerAddressOverride ?? resolvedAccountAddress;

      const slot = await getStorageSlot(
        resolvedAccountAddress,
        resolvedCallerAddress,
        storageKey,
        slotIndex,
      );
      const namespace = getStorageNamespace(resolvedAccountAddress, resolvedCallerAddress);

      return contractInstance.check({
        functionName: 'readStorage',
        args: [namespace, slot],
        constraint,
      });
    },
  };
}
