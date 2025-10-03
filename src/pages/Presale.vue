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
        SOL price: <strong v-if="solPrice !== null">${{ formatNumber(solPrice, 6) }}</strong>
        <span v-else>loading...</span>
      </div>
      <div v-if="solPrice !== null">Estimated SOL required: <strong>{{ formatNumber(requiredSOL, 6) }} SOL</strong></div>
    </div>

    <div class="flex gap-2 mb-3">
      <button
        @click="connectWallet"
        class="px-4 py-2 bg-indigo-600 text-white rounded disabled:opacity-50"
        :disabled="isConnecting"
      >
        {{ walletPubKey ? 'Connected: ' + shortPubkey(walletPubKey) : (isConnecting ? 'Connecting...' : 'Connect Wallet') }}
      </button>

      <button
        v-if="walletPubKey && canShowBuyButton"
        @click="buy"
        class="px-4 py-2 bg-green-600 text-white rounded"
        :disabled="buyInProgress"
      >
        {{ buyInProgress ? 'Processing...' : 'Buy' }}
      </button>
    </div>

    <div class="text-sm text-gray-700">
      <div v-if="message" class="p-2 bg-yellow-50 border-l-4 border-yellow-300 rounded">{{ message }}</div>
      <div v-if="walletBalanceSOL !== null" class="mt-2">Wallet SOL balance: <strong>{{ formatNumber(walletBalanceSOL,6) }} SOL</strong></div>
      <div v-if="txSignature" class="mt-2">Last SOL tx: <code class="break-all">{{ txSignature }}</code></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";

const TOKEN_PRICE_USD = Number(import.meta.env.VITE_TOKEN_PRICE_USD || 0.00001);
const TOKEN_DECIMALS = Number(import.meta.env.VITE_TOKEN_DECIMALS || 6);
const TOKEN_MINT_ADDRESS = import.meta.env.VITE_TOKEN_MINT_ADDRESS;
const TREASURY_SOL_ADDRESS = import.meta.env.VITE_TREASURY_SOL_ADDRESS;
const MIN_TOKENS = Number(import.meta.env.VITE_MIN_TOKENS || 1000);
const RPC_URL = import.meta.env.VITE_RPC_URL;

const connection = new Connection(RPC_URL, "confirmed");

const tokenCount = ref("");
const solPrice = ref(null);
const walletPubKey = ref(null);
const walletBalanceSOL = ref(null);
const isConnecting = ref(false);
const buyInProgress = ref(false);
const message = ref("");
const txSignature = ref(null);

const usdTotal = computed(() => (Number(tokenCount.value) || 0) * TOKEN_PRICE_USD);
const requiredSOL = computed(() => solPrice.value ? (usdTotal.value / solPrice.value) : 0);

function formatNumber(v, decimals = 4) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function shortPubkey(pk) {
  if (!pk) return "";
  return pk.slice(0, 4) + "..." + pk.slice(-4);
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
});

// Wallet connection
async function connectWallet() {
  isConnecting.value = true;
  message.value = "";
  const desired = Number(tokenCount.value) || 0;
  if (desired < MIN_TOKENS) {
    alert(`Minimum is ${MIN_TOKENS} $LZR`);
    isConnecting.value = false;
    return;
  }

  try {
    if (window.solana?.isPhantom) {
      const resp = await window.solana.connect();
      walletPubKey.value = resp.publicKey.toString();
    } else if (window.solflare?.isSolflare) {
      await window.solflare.connect();
      walletPubKey.value = window.solflare.publicKey.toString();
    } else {
      message.value = "No supported wallet found. Install Phantom or Solflare.";
      return;
    }

    await checkBalance();
  } catch (e) {
    console.error(e);
    message.value = "Wallet connection failed.";
  } finally {
    isConnecting.value = false;
  }
}

async function checkBalance() {
  try {
    const lamports = await connection.getBalance(new PublicKey(walletPubKey.value));
    walletBalanceSOL.value = lamports / LAMPORTS_PER_SOL;
  } catch (e) {
    console.error(e);
    message.value = "Failed to fetch wallet balance.";
  }
}

// New presale buy function using partially-signed tx
async function buy() {
  if (!walletPubKey.value) {
    message.value = "Connect wallet first.";
    return;
  }
  buyInProgress.value = true;
  message.value = "Requesting partially-signed transaction...";

  try {
    const lamportsNeeded = Math.ceil(requiredSOL.value * LAMPORTS_PER_SOL);

    // Request backend to prepare partially-signed tx
    const res = await fetch("/.netlify/functions/transferTokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buyer: walletPubKey.value,
        tokenAmount: Number(tokenCount.value),
        solTxSignature: null, // can be handled in backend if payment is needed
        expectedLamports: lamportsNeeded
      })
    });

    const payload = await res.json();
    if (!res.ok) {
      const msg = payload?.error || JSON.stringify(payload);
      message.value = "Server error: " + msg;
      return;
    }

    // Deserialize partially-signed tx
    const tx = Transaction.from(Buffer.from(payload.tx, "base64"));
    tx.feePayer = new PublicKey(walletPubKey.value);
    tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

    // Let wallet sign
    let signedTx;
    if (window.solana?.signTransaction) {
      signedTx = await window.solana.signTransaction(tx);
    } else if (window.solflare?.signTransaction) {
      signedTx = await window.solflare.signTransaction(tx);
    } else {
      throw new Error("Wallet cannot sign transaction from this page.");
    }

    // Send transaction
    const sig = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    txSignature.value = sig;
    message.value = `✅ Purchase complete! Tx: https://explorer.solana.com/tx/${sig}?cluster=mainnet-beta`;
  } catch (e) {
    console.error(e);
    message.value = "Purchase failed: " + (e.message || String(e));
  } finally {
    buyInProgress.value = false;
    if (walletPubKey.value) checkBalance();
  }
}
</script>

<style scoped>
/* small local styles if needed */
</style>