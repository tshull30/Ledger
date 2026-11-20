// QuickNode Streams filter: paste this into the Stream's filter editor.
//
//   Network:  Arc testnet
//   Dataset:  Block with Receipts
//
// Every block on Arc passes through here. We keep only events emitted by OUR rules
// contract (AgentPolicy) and drop everything else, so the webhook receives a few small
// JSON objects instead of whole blocks. Blocks with nothing for us return null (no delivery).

// Change this to your deployed AgentPolicy address (lowercase).
const POLICY = "0x18731c3e4dde85e8d8fc14c67dffe20e2e69b737";

// keccak256 of each event signature in AgentPolicy.sol
const EVENTS = {
  "0x9ac1095a59e12b73fa8e846a551489a13d1abae991272eb6c37b76a3eb3a1bad": "SpendRequested",
  "0xa17882e7b5de1199aa10d2a5f7f21429b15b932702e936d7a357e2230bd5c952": "ApprovalRequired",
  "0xd0abfd4acbe0003003432b2bc085e50197a8dc098513c995ad771e295844cf7a": "SpendApproved",
  "0x21e1c9ac3f84ed6ef1b89258a702e46c7128ffbdc5d293e7dab64a8dae25b335": "SpendRejected",
  "0xfe4498497f9cafe3e6ca968080a0b93908e4112b4b780f95370d29508c4be130": "SpendExecuted",
  "0x0e2fb031ee032dc02d8011dc50b816eb450cf856abd8261680dac74f72165bd2": "Paused",
  "0xcc8d22e807ea92fa44cbc984df35dfbb8351ddf6302b105e5e3cef56dbe45712": "LimitsChanged",
};

// The dataset's shape differs a little between chains and versions, so collect receipts defensively.
function collectReceipts(data) {
  const out = [];
  const visit = (item) => {
    if (!item) return;
    if (Array.isArray(item)) return item.forEach(visit);
    if (Array.isArray(item.receipts)) return item.receipts.forEach(visit);
    if (Array.isArray(item.logs)) out.push(item);
  };
  visit(data);
  return out;
}

function main(stream) {
  const events = [];
  for (const receipt of collectReceipts(stream.data)) {
    for (const log of receipt.logs || []) {
      if (!log.address || log.address.toLowerCase() !== POLICY) continue;
      const name = EVENTS[(log.topics && log.topics[0] || "").toLowerCase()];
      if (!name) continue;
      events.push({
        name,
        address: log.address,
        topics: log.topics,
        data: log.data,
        blockNumber: parseInt(log.blockNumber || receipt.blockNumber, 16),
        transactionHash: log.transactionHash || receipt.transactionHash,
        logIndex: parseInt(log.logIndex, 16),
      });
    }
  }
  return events.length ? { events } : null;
}
