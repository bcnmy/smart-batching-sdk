// Reusable ABI shape for a Constraint struct — used when ABI-encoding OR sub-constraints
export const CONSTRAINT_TUPLE_ABI = {
  type: 'tuple[]',
  components: [
    { name: 'constraintType', type: 'uint8' },
    { name: 'referenceData', type: 'bytes' },
  ],
} as const;

export const COMPOSABILITY_MODULE_ABI_V1_1_0 = [
  {
    type: 'constructor',
    inputs: [{ name: '_defaultEpAddress', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'DEFAULT_EP_ADDRESS',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'executeComposable',
    inputs: [
      {
        name: 'cExecutions',
        type: 'tuple[]',
        internalType: 'struct ComposableExecution[]',
        components: [
          { name: 'functionSig', type: 'bytes4', internalType: 'bytes4' },
          {
            name: 'inputParams',
            type: 'tuple[]',
            internalType: 'struct InputParam[]',
            components: [
              {
                name: 'paramType',
                type: 'uint8',
                internalType: 'enum InputParamType',
              },
              {
                name: 'fetcherType',
                type: 'uint8',
                internalType: 'enum InputParamFetcherType',
              },
              { name: 'paramData', type: 'bytes', internalType: 'bytes' },
              {
                name: 'constraints',
                type: 'tuple[]',
                internalType: 'struct Constraint[]',
                components: [
                  {
                    name: 'constraintType',
                    type: 'uint8',
                    internalType: 'enum ConstraintType',
                  },
                  {
                    name: 'referenceData',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
            ],
          },
          {
            name: 'outputParams',
            type: 'tuple[]',
            internalType: 'struct OutputParam[]',
            components: [
              {
                name: 'fetcherType',
                type: 'uint8',
                internalType: 'enum OutputParamFetcherType',
              },
              { name: 'paramData', type: 'bytes', internalType: 'bytes' },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'executeComposableCall',
    inputs: [
      {
        name: 'cExecutions',
        type: 'tuple[]',
        internalType: 'struct ComposableExecution[]',
        components: [
          { name: 'functionSig', type: 'bytes4', internalType: 'bytes4' },
          {
            name: 'inputParams',
            type: 'tuple[]',
            internalType: 'struct InputParam[]',
            components: [
              {
                name: 'paramType',
                type: 'uint8',
                internalType: 'enum InputParamType',
              },
              {
                name: 'fetcherType',
                type: 'uint8',
                internalType: 'enum InputParamFetcherType',
              },
              { name: 'paramData', type: 'bytes', internalType: 'bytes' },
              {
                name: 'constraints',
                type: 'tuple[]',
                internalType: 'struct Constraint[]',
                components: [
                  {
                    name: 'constraintType',
                    type: 'uint8',
                    internalType: 'enum ConstraintType',
                  },
                  {
                    name: 'referenceData',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
            ],
          },
          {
            name: 'outputParams',
            type: 'tuple[]',
            internalType: 'struct OutputParam[]',
            components: [
              {
                name: 'fetcherType',
                type: 'uint8',
                internalType: 'enum OutputParamFetcherType',
              },
              { name: 'paramData', type: 'bytes', internalType: 'bytes' },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeComposableDelegateCall',
    inputs: [
      {
        name: 'cExecutions',
        type: 'tuple[]',
        internalType: 'struct ComposableExecution[]',
        components: [
          { name: 'functionSig', type: 'bytes4', internalType: 'bytes4' },
          {
            name: 'inputParams',
            type: 'tuple[]',
            internalType: 'struct InputParam[]',
            components: [
              {
                name: 'paramType',
                type: 'uint8',
                internalType: 'enum InputParamType',
              },
              {
                name: 'fetcherType',
                type: 'uint8',
                internalType: 'enum InputParamFetcherType',
              },
              { name: 'paramData', type: 'bytes', internalType: 'bytes' },
              {
                name: 'constraints',
                type: 'tuple[]',
                internalType: 'struct Constraint[]',
                components: [
                  {
                    name: 'constraintType',
                    type: 'uint8',
                    internalType: 'enum ConstraintType',
                  },
                  {
                    name: 'referenceData',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
            ],
          },
          {
            name: 'outputParams',
            type: 'tuple[]',
            internalType: 'struct OutputParam[]',
            components: [
              {
                name: 'fetcherType',
                type: 'uint8',
                internalType: 'enum OutputParamFetcherType',
              },
              { name: 'paramData', type: 'bytes', internalType: 'bytes' },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getEntryPoint',
    inputs: [{ name: 'account', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isInitialized',
    inputs: [{ name: 'account', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isModuleType',
    inputs: [{ name: 'moduleTypeId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'onInstall',
    inputs: [{ name: 'data', type: 'bytes', internalType: 'bytes' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'onUninstall',
    inputs: [{ name: 'data', type: 'bytes', internalType: 'bytes' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setEntryPoint',
    inputs: [{ name: '_entryPoint', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'error',
    name: 'AlreadyInitialized',
    inputs: [{ name: 'smartAccount', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'ComposableExecutionFailed', inputs: [] },
  {
    type: 'error',
    name: 'ConstraintNotMet',
    inputs: [
      {
        name: 'constraintType',
        type: 'uint8',
        internalType: 'enum ConstraintType',
      },
    ],
  },
  { type: 'error', name: 'DelegateCallOnly', inputs: [] },
  { type: 'error', name: 'FailedToReturnMsgValue', inputs: [] },
  { type: 'error', name: 'InvalidConstraintType', inputs: [] },
  { type: 'error', name: 'InvalidOutputParamFetcherType', inputs: [] },
  {
    type: 'error',
    name: 'InvalidParameterEncoding',
    inputs: [{ name: 'message', type: 'string', internalType: 'string' }],
  },
  {
    type: 'error',
    name: 'NotInitialized',
    inputs: [{ name: 'smartAccount', type: 'address', internalType: 'address' }],
  },
  { type: 'error', name: 'OnlyEntryPointOrAccount', inputs: [] },
  { type: 'error', name: 'Output_StaticCallFailed', inputs: [] },
  { type: 'error', name: 'ZeroAddressNotAllowed', inputs: [] },
];
