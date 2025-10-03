// netlify/functions/claim.js
const { Keypair, PublicKey, Connection, Transaction } = require("@solana/web3.js");
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount
} = require("@solana/spl-token");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Use POST instead." })
      };
    }

    const { wallet } = JSON.parse(event.body || "{}");
    if (!wallet) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "MISSING_WALLET", message: "Missing wallet pubkey" })
      };
    }

    const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
    const TOKEN_MINT = process.env.TOKEN_MINT;
    const TREASURY_SECRET = process.env.TREASURY_SECRET;
    if (!TOKEN_MINT || !TREASURY_SECRET) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "SERVER_MISCONFIGURED", message: "Missing env vars" })
      };
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const mintPubkey = new PublicKey(TOKEN_MINT);
    const userPubkey = new PublicKey(wallet);

    const secretArray = JSON.parse(TREASURY_SECRET);
    const treasuryKeypair = Keypair.fromSecretKey(Uint8Array.from(secretArray));
    const treasuryPubkey = treasuryKeypair.publicKey;

    const userATA = await getAssociatedTokenAddress(mintPubkey, userPubkey, false);
    const treasuryATA = await getAssociatedTokenAddress(mintPubkey, treasuryPubkey, false);

    // prevent double-claim
    try {
      const userAcc = await getAccount(connection, userATA);
      if (userAcc.amount > 0n) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "ALREADY_CLAIMED", message: "This wallet already holds the token." })
        };
      }
    } catch (err) {
      // no ATA yet, continue
    }

    // ensure treasury funded
    try {
      const treasuryAcc = await getAccount(connection, treasuryATA);
      if (treasuryAcc.amount <= 0n) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "NO_TREASURY_BALANCE", message: "Treasury is empty." })
        };
      }
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "MISSING_TREASURY_ATA", message: "Treasury ATA not found." })
      };
    }

    const tx = new Transaction();
    tx.feePayer = userPubkey;

    let needCreate = false;
    try {
      await getAccount(connection, userATA);
    } catch (err) {
      needCreate = true;
    }
    if (needCreate) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          userPubkey,
          userATA,
          userPubkey,
          mintPubkey
        )
      );
    }

    const AMOUNT = process.env.VITE_AMOUNT_IN_BASE_UNITS ? BigInt(process.env.VITE_AMOUNT_IN_BASE_UNITS) : 1n;
    tx.add(
      createTransferInstruction(treasuryATA, userATA, treasuryPubkey, AMOUNT)
    );

    tx.recentBlockhash = (await connection.getLatestBlockhash("finalized")).blockhash;
    tx.partialSign(treasuryKeypair);

    const serialized = tx.serialize({ requireAllSignatures: false }).toString("base64");
    return { statusCode: 200, body: JSON.stringify({ tx: serialized }) };

  } catch (err) {
    console.error("claim.js error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "SERVER_ERROR",
        message: err.message || String(err)
      })
    };
  }
};