// netlify/functions/transferTokens.js
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  TOKEN_PROGRAM_ID
} = require('@solana/spl-token');

const RPC_URL = process.env.RPC_URL;
const TOKEN_MINT_ADDRESS = process.env.TOKEN_MINT_ADDRESS;
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || 6);
const TREASURY_SOL_ADDRESS = process.env.TREASURY_SOL_ADDRESS; // optional duplication
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY; // JSON array string

if (!RPC_URL || !TREASURY_PRIVATE_KEY || !TOKEN_MINT_ADDRESS) {
  console.error('Missing required env vars.');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { buyer, tokenAmount, solTxSignature, expectedLamports } = body;
    if (!buyer || !tokenAmount || !solTxSignature || !expectedLamports) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing parameters' }) };
    }

    const connection = new Connection(RPC_URL, 'confirmed');

    // Verify SOL transaction occurred and funds were sent to your treasury
    const onChain = await connection.getTransaction(solTxSignature);
    if (!onChain || !onChain.meta) {
      return { statusCode: 400, body: JSON.stringify({ error: 'SOL transaction not found or not confirmed yet' }) };
    }

    // Find treasury key within transaction account keys
    const accountKeys = onChain.transaction.message.accountKeys.map(k => k.toString());
    const preBalances = onChain.meta.preBalances;
    const postBalances = onChain.meta.postBalances;

    const treasuryIndex = accountKeys.indexOf(process.env.TREASURY_SOL_ADDRESS);
    if (treasuryIndex === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Treasury address not present in SOL transaction' }) };
    }

    const lamportsReceived = postBalances[treasuryIndex] - preBalances[treasuryIndex];
    if (lamportsReceived < expectedLamports) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Received lamports less than expected' }) };
    }

    // Prepare to send tokens from treasury to buyer
    const secret = Uint8Array.from(JSON.parse(TREASURY_PRIVATE_KEY));
    const treasuryKeypair = Keypair.fromSecretKey(secret);

    const connection2 = connection;
    const mintPubkey = new PublicKey(TOKEN_MINT_ADDRESS);
    const buyerPubkey = new PublicKey(buyer);

    // Ensure treasury associated token account (source) exists
    const treasuryATA = await getOrCreateAssociatedTokenAccount(connection2, treasuryKeypair, mintPubkey, treasuryKeypair.publicKey);
    const buyerATA = await getOrCreateAssociatedTokenAccount(connection2, treasuryKeypair, mintPubkey, buyerPubkey);

    // compute raw token amount respecting decimals
    // use BigInt for safety
    const amountRaw = BigInt(tokenAmount) * (BigInt(10) ** BigInt(TOKEN_DECIMALS));
    // Transfer instruction expects a number in many versions; convert safely:
    const amountNumber = Number(amountRaw); // expect amounts to be reasonably sized

    const transferIx = createTransferInstruction(
      treasuryATA.address,
      buyerATA.address,
      treasuryKeypair.publicKey,
      amountNumber,
      [],
      TOKEN_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    tx.feePayer = treasuryKeypair.publicKey;
    tx.recentBlockhash = (await connection2.getRecentBlockhash()).blockhash;
    tx.sign(treasuryKeypair);

    const raw = tx.serialize();
    const txSig2 = await connection2.sendRawTransaction(raw);
    await connection2.confirmTransaction(txSig2, 'confirmed');

    return {
      statusCode: 200,
      body: JSON.stringify({ signature: txSig2 })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};