require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { DEPLOYER_PRIVATE_KEY, ARC_RPC_URL } = process.env;

module.exports = {
  solidity: "0.8.24",
  networks: {
    arcTestnet: {
      url: ARC_RPC_URL || "https://rpc.testnet.arc.network",
      chainId: 5042002,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
