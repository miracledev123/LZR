// netlify/functions/transferTokens.js
const { Keypair, PublicKey, Connection, Transaction } = require("@solana/web3.js");
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount
} = require("@solana/spl-token");

const RPC_URL = process.env.RPC_URL;
const TOKEN_MINT_ADDRESS = process.env.TOKEN_MINT_ADDRESS;
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || 6);
const TREASURY_SOL_ADDRESS = process.env.TREASURY_SOL_ADDRESS;
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;

if (!RPC_URL || !TREASURY_PRIVATE_KEY || !TOKEN_MINT_ADDRESS) {
  console.error("Missing required env vars.");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { buyer, tokenAmount, solTxSignature, expectedLamports } = JSON.parse(event.body || "{}");
    if (!buyer || !tokenAmount || !solTxSignature || !expectedLamports) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing parameters" }) };
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const mintPubkey = new PublicKey(TOKEN_MINT_ADDRESS);
    const buyerPubkey = new PublicKey(buyer);

    // Verify SOL transaction to treasury
    const solTx = await connection.getTransaction(solTxSignature);
    if (!solTx || !solTx.meta) {
      return { statusCode: 400, body: JSON.stringify({ error: "SOL transaction not found or not confirmed yet" }) };
    }

    const keys = solTx.transaction.message.accountKeys.map(k => k.toString());
    const preBalances = solTx.meta.preBalances;
    const postBalances = solTx.meta.postBalances;
    const treasuryIndex = keys.indexOf(TREASURY_SOL_ADDRESS);

    if (treasuryIndex === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: "Treasury address not in SOL tx" }) };
    }

    const lamportsReceived = postBalances[treasuryIndex] - preBalances[treasuryIndex];
    if (lamportsReceived < expectedLamports) {
      return { statusCode: 400, body: JSON.stringify({ error: "Received lamports less than expected" }) };
    }

    // Setup treasury keypair
    const treasurySecret = Uint8Array.from(JSON.parse(TREASURY_PRIVATE_KEY));
    const treasuryKeypair = Keypair.fromSecretKey(treasurySecret);
    const treasuryPubkey = treasuryKeypair.publicKey;

    const userATA = await getAssociatedTokenAddress(mintPubkey, buyerPubkey, false);
    const treasuryATA = await getAssociatedTokenAddress(mintPubkey, treasuryPubkey, false);

    // Prevent double transfer
    let userHasTokens = false;
    try {
      const account = await getAccount(connection, userATA);
      if (account.amount > 0n) userHasTokens = true;
    } catch {
      // ATA doesn't exist yet, continue
    }
    if (userHasTokens) {
      return { statusCode: 400, body: JSON.stringify({ error: "ALREADY_HAS_TOKENS", message: "Buyer already holds tokens" }) };
    }

    // Ensure treasury has enough tokens
    try {
      const treasuryAcc = await getAccount(connection, treasuryATA);
      if (treasuryAcc.amount < BigInt(tokenAmount) * 10n ** BigInt(TOKEN_DECIMALS)) {
        return { statusCode: 500, body: JSON.stringify({ error: "INSUFFICIENT_TREASURY_BALANCE", message: "Treasury lacks tokens" }) };
      }
    } catch {
      return { statusCode: 500, body: JSON.stringify({ error: "MISSING_TREASURY_ATA", message: "Treasury ATA not found" }) };
    }

    // Build transaction
    const tx = new Transaction();
    tx.feePayer = buyerPubkey;

    // Add ATA creation if needed
    let needCreate = false;
    try {
      await getAccount(connection, userATA);
    } catch {
      needCreate = true;
    }
    if (needCreate) {
      tx.add(
        createAssociatedTokenAccountInstruction(buyerPubkey, userATA, buyerPubkey, mintPubkey)
      );
    }

    // Add token transfer
    const amountRaw = BigInt(tokenAmount) * (10n ** BigInt(TOKEN_DECIMALS));
    tx.add(createTransferInstruction(treasuryATA, userATA, treasuryPubkey, amountRaw));

    // Recent blockhash & partial sign
    tx.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
    tx.partialSign(treasuryKeypair);

    // Serialize and return
    const serialized = tx.serialize({ requireAllSignatures: false }).toString("base64");

    return { statusCode: 200, body: JSON.stringify({ tx: serialized }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};