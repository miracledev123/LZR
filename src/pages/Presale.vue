<template>
  <div class="max-w-xl mx-auto p-6 bg-white rounded-lg shadow">
    <h1 class="text-2xl font-semibold mb-4">$LZR Presale</h1>

    <label class="block mb-2">Amount of tokens to buy</label>
    <input
      v-model="tokenCount"
      type="number"
      min="0"
      class="w-full p-2 border rounded mb-3"
      placeholder="enter number of $LZR"
    />

    <div class="mb-3">
      <div>Token price (USD): <strong>{{ TOKEN_PRICE_USD }}</strong></div>
      <div>USD total: <strong>${{ formatNumber(usdTotal, 6) }}</strong></div>
      <div>
        SOL price:
        <strong v-if="solPrice !== null">${{ formatNumber(solPrice, 6) }}</strong>
        <span v-else>loading...</span>
      </div>
      <div v-if="solPrice !== null">
        Estimated SOL required:
        <strong>{{ formatNumber(requiredSOL, 6) }} SOL</strong>
      </div>
    </div>

    <!-- Wallet adapter connect/disconnect button -->
    <div class="flex gap-2 mb-3">
      <WalletMultiButton class="px-4 py-2 bg-indigo-600 text-white rounded" />

      <button
        v-if="publicKey && canShowBuyButton"
        @click="buy"
        class="px-4 py-2 bg-green-600 text-white rounded"
        :disabled="buyInProgress"
      >
        {{ buyInProgress ? 'Processing...' : 'Buy' }}
      </button>
    </div>

    <div class="text-sm text-gray-700">
      <div
        v-if="message"
        class="p-2 bg-yellow-50 border-l-4 border-yellow-300 rounded"
      >
        {{ message }}
      </div>
      <div v-if="walletBalanceSOL !== null" class="mt-2">
        Wallet SOL balance:
        <strong>{{ formatNumber(walletBalanceSOL, 6) }} SOL</strong>
      </div>
      <div v-if="txSignature" class="mt-2">
        Last SOL tx: <code class="break-all">{{ txSignature }}</code>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWallet, WalletMultiButton } from "@solana/wallet-adapter-vue";

const TOKEN_PRICE_USD = Number(import.meta.env.VITE_TOKEN_PRICE_USD || 0.00001);
const MIN_TOKENS = Number(import.meta.env.VITE_MIN_TOKENS || 1000);
const RPC_URL = import.meta.env.VITE_RPC_URL;

const connection = new Connection(RPC_URL, "confirmed");

const tokenCount = ref("");
const solPrice = ref(null);
const walletBalanceSOL = ref(null);
const buyInProgress = ref(false);
const message = ref("");
const txSignature = ref(null);

const usdTotal = computed(() => (Number(tokenCount.value) || 0) * TOKEN_PRICE_USD);
const requiredSOL = computed(() => solPrice.value ? (usdTotal.value / solPrice.value) : 0);

// Wallet hook
const { publicKey, signTransaction } = useWallet();

function formatNumber(v, decimals = 4) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

async function fetchSolPrice() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await res.json();
    solPrice.value = data?.solana?.usd ?? null;
  } catch (e) {
    console.error(e);
    solPrice.value = null;
    message.value = "Could not fetch SOL price.";
  }
}

onMounted(() => {
  fetchSolPrice();
  setInterval(fetchSolPrice, 30000);
  if (publicKey.value) checkBalance();
});

async function checkBalance() {
  if (!publicKey.value) return;
  try {
    const lamports = await connection.getBalance(new PublicKey(publicKey.value.toString()));
    walletBalanceSOL.value = lamports / LAMPORTS_PER_SOL;
  } catch (e) {
    console.error(e);
    message.value = "Failed to fetch wallet balance.";
  }
}

async function buy() {
  if (!publicKey.value) {
    message.value = "Connect wallet first.";
    return;
  }

  const desired = Number(tokenCount.value) || 0;
  if (desired < MIN_TOKENS) {
    alert(`Minimum is ${MIN_TOKENS} $LZR`);
    return;
  }

  buyInProgress.value = true;
  message.value = "Requesting partially-signed transaction...";

  try {
    const lamportsNeeded = Math.ceil(requiredSOL.value * LAMPORTS_PER_SOL);

    const res = await fetch("/.netlify/functions/transferTokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buyer: publicKey.value.toString(),
        tokenAmount: desired,
        expectedLamports: lamportsNeeded
      })
    });

    const payload = await res.json();
    if (!res.ok) {
      const msg = payload?.error || JSON.stringify(payload);
      message.value = "Server error: " + msg;
      return;
    }

    const tx = Transaction.from(Buffer.from(payload.tx, "base64"));
    tx.feePayer = new PublicKey(publicKey.value.toString());
    tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

    const signed = await signTransaction.value(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction(sig, "confirmed");

    txSignature.value = sig;
    message.value = `✅ Purchase complete! Tx: https://explorer.solana.com/tx/${sig}?cluster=mainnet-beta`;
  } catch (e) {
    console.error(e);
    message.value = "Purchase failed: " + (e.message || String(e));
  } finally {
    buyInProgress.value = false;
    if (publicKey.value) checkBalance();
  }
}
</script>



<style scoped>
/* small local styles if needed */
</style>