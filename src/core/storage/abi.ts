import type { Abi } from 'viem';

export const NAMESPACE_STORAGE_ABI: Abi = [
  { inputs: [], name: 'SlotNotInitialized', type: 'error' },
  {
    inputs: [
      { internalType: 'address', name: 'account', type: 'address' },
      { internalType: 'address', name: 'caller', type: 'address' },
    ],
    name: 'getNamespace',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'namespace', type: 'bytes32' },
      { internalType: 'bytes32', name: 'slot', type: 'bytes32' },
    ],
    name: 'getNamespacedSlot',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'namespace', type: 'bytes32' },
      { internalType: 'bytes32', name: 'slot', type: 'bytes32' },
    ],
    name: 'isSlotInitialized',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'namespace', type: 'bytes32' },
      { internalType: 'bytes32', name: 'slot', type: 'bytes32' },
    ],
    name: 'readStorage',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'slot', type: 'bytes32' },
      { internalType: 'bytes32', name: 'value', type: 'bytes32' },
      { internalType: 'address', name: 'account', type: 'address' },
    ],
    name: 'writeStorage',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];
