// src/App.jsx
import { Buffer } from "buffer";
window.Buffer = Buffer; // for browsers that don't have it
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { useState } from "react";

const TOKEN_MINT = new PublicKey(import.meta.env.VITE_TOKEN_MINT);

export default function App() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [status, setStatus] = useState("");

  // ✅ safer check: just read token account balance
  async function localHasToken() {
    if (!publicKey) return false;
    try {
      const ata = await getAssociatedTokenAddress(TOKEN_MINT, publicKey);
      const info = await connection.getAccountInfo(ata);
      if (!info) return false; // ATA doesn’t exist
      const balance = await connection.getTokenAccountBalance(ata);
      return parseInt(balance.value.amount) > 0;
    } catch (err) {
      console.error("localHasToken error:", err);
      return false;
    }
  }


  async function handleClaim() {
    if (!publicKey) {
      setStatus("Connect your wallet first");
      return;
    }

    setStatus("Checking local balance...");
    try {
      const userHasToken = await localHasToken();
      if (userHasToken) {
        setStatus("You already have this token.");
        return;
      }
    } catch (err) {
      console.error("Error checking local token balance:", err);
      setStatus("❌ Failed to check token balance.");
      return;
    }

    setStatus("Requesting partially-signed transaction from server...");
    let payload;
    try {
      const res = await fetch("/.netlify/functions/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toString() }),
      });

      try {
        payload = await res.json();
      } catch {
        setStatus("❌ Server returned empty or invalid JSON");
        return;
      }

      if (!res.ok) {
        const msg = payload?.message || payload?.error || res.statusText;
        if (payload?.error === "ALREADY_CLAIMED") {
          setStatus("This wallet already has the token.");
          return;
        }
        setStatus("Server error: " + msg);
        return;
      }
    } catch (err) {
      console.error("Fetch claim error:", err);
      setStatus("❌ Failed to request claim: " + err.message);
      return;
    }

    // Deserialize transaction safely
    let tx;
    try {
      const txB64 = payload.tx;
      if (!txB64) throw new Error("No transaction data received");
      tx = Transaction.from(Buffer.from(txB64, "base64"));
    } catch (err) {
      console.error("Transaction deserialization error:", err);
      setStatus("❌ Invalid transaction received from server.");
      return;
    }

    // Ask user's wallet to sign safely
    try {
      const signed = await signTransaction(tx);
      if (!signed) throw new Error("Signing failed");

      const raw = signed.serialize();
      const sig = await connection.sendRawTransaction(raw);
      setStatus(`Sent tx: ${sig}. Waiting for confirmation...`);
      await connection.confirmTransaction(sig, "confirmed");

      // Mainnet explorer link
      setStatus(
        `✅ Claim successful! Tx: https://explorer.solana.com/tx/${sig}?cluster=mainnet-beta`
      );
    } catch (err) {
      console.error("Transaction signing or sending error:", err);
      setStatus("❌ Claim failed: " + (err.message || String(err)));
    }
  }


  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 20 }}>
      <h1>Claim your token</h1>
      <p>
        Click connect, then press <b>Claim</b>. You will pay a small network fee if you need an ATA created.
      </p>
      <WalletMultiButton />
      <div style={{ marginTop: 16 }}>
        <button onClick={handleClaim} disabled={!publicKey}>
          Claim Token
        </button>
        <p style={{ marginTop: 12 }}>{status}</p>
      </div>
    </div>
  );
}