<script setup>
import { WalletProvider } from "@solana/wallet-adapter-vue";
import { WalletModalProvider } from "@solana/wallet-adapter-vue-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { ConnectionProvider } from "@solana/wallet-adapter-vue";

const endpoint = import.meta.env.VITE_RPC_URL || "https://api.mainnet-beta.solana.com";
const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new TorusWalletAdapter(),
];
</script>

<template>
  <ConnectionProvider :endpoint="endpoint">
    <WalletProvider :wallets="wallets" autoConnect>
      <WalletModalProvider>
        <!-- Your presale page -->
        <Presale />
      </WalletModalProvider>
    </WalletProvider>
  </ConnectionProvider>
</template>

<script>
import Presale from "./pages/Presale.vue";
export default { components: { Presale } };
</script>
