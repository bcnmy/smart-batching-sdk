import {
  createMeeClient,
  getMEEVersion,
  MEEVersion,
  toMultichainNexusAccount,
} from '@biconomy/abstractjs';
import type { Hex } from 'viem';
import { createPublicClient, createWalletClient, fallback, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const rpcUrls = [
  process.env.BASE_SEPOLIA_RPC_URL,
  'https://sepolia.base.org',
  'https://base-sepolia.blockpi.network/v1/rpc/public',
  'https://base-sepolia-rpc.publicnode.com',
].filter(Boolean) as string[];

export const transport = fallback(rpcUrls.map((url) => http(url)));

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport,
});

// ---------------------------------------------------------------------------
// Account + wallet client (requires PRIVATE_KEY in environment)
// ---------------------------------------------------------------------------

const privateKey = process.env.PRIVATE_KEY;

export const account = privateKey ? privateKeyToAccount(privateKey as Hex) : undefined;

export const walletClient = account
  ? createWalletClient({ account, chain: baseSepolia, transport })
  : undefined;

// ---------------------------------------------------------------------------
// Well-known addresses (Base Sepolia)
// ---------------------------------------------------------------------------

// Mock USDC on Base Sepolia (used in integration tests)
export const USDC_ADDRESS = '0x8976987ebEe0806924Ae17eEd12229Cf4789cB1f' as const;
export const WETH_ADDRESS = '0x4200000000000000000000000000000000000006' as const;

// ---------------------------------------------------------------------------
// Nexus SCA + MEE client — shared init for integration tests
// ---------------------------------------------------------------------------

export async function initNexus() {
  if (!account) throw new Error('PRIVATE_KEY is not set in environment');

  const nexusAccount = await toMultichainNexusAccount({
    signer: account,
    chainConfigurations: [
      {
        chain: baseSepolia,
        transport,
        version: getMEEVersion(MEEVersion.V2_2_2),
      },
    ],
  });

  return {
    nexusAccount,
    scaAddress: nexusAccount.addressOn(baseSepolia.id, true),
    meeClient: await createMeeClient({ account: nexusAccount }),
  };
}
