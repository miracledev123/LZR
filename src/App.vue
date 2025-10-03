<script setup>
import { WalletProvider } from "@solana/wallet-adapter-vue";
import { WalletModalProvider } from "@solana/wallet-adapter-vue-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter, TorusWalletAdapter } from "@solana/wallet-adapter-wallets";

import Presale from "./pages/Presale.vue";

// Solana RPC endpoint
const endpoint = "https://api.mainnet-beta.solana.com";

// Wallet adapters
const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new TorusWalletAdapter()];
</script>

<template>
  <!-- Removed ConnectionProvider -->
  <WalletProvider :wallets="wallets" autoConnect>
    <WalletModalProvider>
      <Presale />
    </WalletModalProvider>
  </WalletProvider>
</template>
