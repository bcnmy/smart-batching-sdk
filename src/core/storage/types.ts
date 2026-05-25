import type { Address } from 'viem';
import type { ComposableCall, RuntimeConstraint, RuntimeValue } from '../encoding';
import type { Bytes32SupportedType } from '../encoding/utils';

export interface WriteStorageParams {
  value: Bytes32SupportedType;
  storageKey?: bigint;
  slotIndex?: number;
  accountAddress?: Address;
  callerAddress?: Address;
}

export interface RuntimeValueStorageParams {
  constraint?: RuntimeConstraint;
  storageKey?: bigint;
  slotIndex?: number;
  accountAddress?: Address;
  callerAddress?: Address;
}

export interface CheckStorageParams {
  constraint: RuntimeConstraint;
  storageKey?: bigint;
  slotIndex?: number;
  accountAddress?: Address;
  callerAddress?: Address;
}

export interface GetStorageKeyParams {
  accountAddress?: Address;
  callerAddress?: Address;
}

export interface StorageInstance {
  readonly accountAddress: Address;
  getStorageKey(params?: GetStorageKeyParams): Promise<bigint>;
  write(params: WriteStorageParams): Promise<ComposableCall>;
  runtimeValue(params?: RuntimeValueStorageParams): Promise<RuntimeValue>;
  check(params: CheckStorageParams): Promise<ComposableCall>;
}
