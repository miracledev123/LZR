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
      <div>USD total: <strong>\${{ formatNumber(usdTotal, 6) }}</strong></div>
      <div>
        SOL price: <strong v-if="solPrice !== null">\${{ formatNumber(solPrice, 6) }}</strong>
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
import { ref, computed, onMounted } from 'vue';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction
} from '@solana/web3.js';

const TOKEN_PRICE_USD = Number(import.meta.env.VITE_TOKEN_PRICE_USD || 0.00034);
const TOKEN_DECIMALS = Number(import.meta.env.VITE_TOKEN_DECIMALS || 6);
const TOKEN_MINT_ADDRESS = import.meta.env.VITE_TOKEN_MINT_ADDRESS;
const TREASURY_SOL_ADDRESS = import.meta.env.VITE_TREASURY_SOL_ADDRESS;
const MIN_TOKENS = Number(import.meta.env.VITE_MIN_TOKENS || 100000);
const RPC_URL = import.meta.env.VITE_RPC_URL;

const connection = new Connection(RPC_URL, 'confirmed');

const tokenCount = ref('');
const solPrice = ref(null);
const solPriceLoading = ref(false);
const walletPubKey = ref(null);
const walletBalanceSOL = ref(null);
const isConnecting = ref(false);
const buyInProgress = ref(false);
const message = ref('');
const txSignature = ref(null);

const usdTotal = computed(() => {
  const n = Number(tokenCount.value) || 0;
  return n * TOKEN_PRICE_USD;
});
const requiredSOL = computed(() => {
  return solPrice.value ? (usdTotal.value / solPrice.value) : 0;
});

const canShowBuyButton = computed(() => {
  // show buy if wallet connected and has enough balance
  if (!walletPubKey.value) return false;
  if (walletBalanceSOL.value === null) return false;
  const buffer = 0.005; // small buffer for fees
  return walletBalanceSOL.value >= (requiredSOL.value + buffer);
});

function formatNumber(v, decimals = 4) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function shortPubkey(pk) {
  if (!pk) return '';
  return pk.slice(0, 4) + '...' + pk.slice(-4);
}

async function fetchSolPrice() {
  solPriceLoading.value = true;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json();
    solPrice.value = data?.solana?.usd ?? null;
  } catch (e) {
    console.error(e);
    solPrice.value = null;
    message.value = 'Could not fetch SOL price from Coingecko.';
  } finally {
    solPriceLoading.value = false;
  }
}

onMounted(() => {
  fetchSolPrice();
  setInterval(fetchSolPrice, 30000); // refresh every 30s
});

async function connectWallet() {
  isConnecting.value = true;
  message.value = '';

  const desired = Number(tokenCount.value) || 0;
  if (desired < MIN_TOKENS) {
    alert(`Minimum is ${MIN_TOKENS} $LZR`);
    isConnecting.value = false;
    return;
  }

  try {
    // Phantom
    if (window.solana && window.solana.isPhantom) {
      const resp = await window.solana.connect();
      walletPubKey.value = resp.publicKey.toString();
    } else if (window.solflare && window.solflare.isSolflare) {
      await window.solflare.connect();
      walletPubKey.value = window.solflare.publicKey.toString();
    } else {
      message.value = 'No supported wallet found. Install Phantom or Solflare.';
      isConnecting.value = false;
      return;
    }

    // check balance
    await checkBalance();
  } catch (e) {
    console.error(e);
    message.value = 'Wallet connection failed or rejected.';
  } finally {
    isConnecting.value = false;
  }
}

async function checkBalance() {
  try {
    const pk = new PublicKey(walletPubKey.value);
    const lamports = await connection.getBalance(pk);
    walletBalanceSOL.value = lamports / LAMPORTS_PER_SOL;
    const required = requiredSOL.value || 0;
    const buffer = 0.005;
    if ((walletBalanceSOL.value + 1e-12) < (required + buffer)) {
      message.value = `Insufficient SOL. Need ≈ ${formatNumber(required + buffer, 6)} SOL but have ${formatNumber(walletBalanceSOL.value, 6)} SOL.`;
    } else {
      message.value = `Sufficient balance. Click Buy to proceed.`;
    }
  } catch (e) {
    console.error(e);
    message.value = 'Could not fetch wallet balance.';
  }
}

async function buy() {
  if (!walletPubKey.value) {
    message.value = 'Please connect wallet first.';
    return;
  }
  buyInProgress.value = true;
  message.value = 'Creating SOL payment transaction...';

  try {
    const lamportsNeeded = Math.ceil(requiredSOL.value * LAMPORTS_PER_SOL); // round up
    const from = new PublicKey(walletPubKey.value);
    const to = new PublicKey(TREASURY_SOL_ADDRESS);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports: lamportsNeeded
      })
    );

    tx.feePayer = from;
    tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;

    let signature = null;

    // Phantom: use signAndSendTransaction if available
    if (window.solana && window.solana.signAndSendTransaction) {
      const { signature: sig } = await window.solana.signAndSendTransaction(tx);
      signature = sig;
      await connection.confirmTransaction(signature, 'confirmed');
    } else if (window.solana && window.solana.signTransaction) {
      // fallback
      const signed = await window.solana.signTransaction(tx);
      signature = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(signature, 'confirmed');
    } else if (window.solflare && window.solflare.signAndSendTransaction) {
      const { signature: sig } = await window.solflare.signAndSendTransaction(tx);
      signature = sig;
      await connection.confirmTransaction(signature, 'confirmed');
    } else {
      throw new Error('Wallet cannot sign/send transaction from this page.');
    }

    txSignature.value = signature;
    message.value = `SOL sent (sig ${signature}). Requesting token delivery...`;

    // call server to request token transfer
    const resp = await fetch('/.netlify/functions/transferTokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyer: walletPubKey.value,
        tokenAmount: Number(tokenCount.value),
        solTxSignature: signature,
        expectedLamports: lamportsNeeded
      })
    });
    const json = await resp.json();
    if (resp.ok) {
      message.value = `Token transfer succeeded. Token transfer tx: ${json.signature}`;
    } else {
      message.value = `Token transfer failed: ${json.error ?? JSON.stringify(json)}`;
    }
  } catch (e) {
    console.error(e);
    message.value = `Purchase failed: ${e.message || e}`;
  } finally {
    buyInProgress.value = false;
    // refresh wallet balance
    if (walletPubKey.value) checkBalance();
  }
}
</script>

<style scoped>
/* small local styles if needed */
</style>