# Jetton with Governance

Jetton-with-governance FunC smart contracts. 

# Targets and goals

This project was created to allow users to exchange and buy assets in the TON DeFi ecosystem for a jetton (token or currency) that is not subject to volatile fluctuations. To meet regulatory requirements, the issuer of the tokens must have additional control over the tokens.

Thus this jetton represents a [standard TON jetton smart contracts](https://github.com/ton-blockchain/token-contract/tree/369ae089255edbd807eb499792a0a838c2e1b272/ft) with additional functionality:

- Admin of jetton can make transfers from user's jetton wallet.

- Admin of jetton can burn user's jettons.

- Admin of jetton can lock/unlock user's jetton wallet (`set_status`). Admin can make transfer and burn even if wallet locked.

- Admin of jetton can change jetton-minter code and it's full data.

__⚠️ It is critically important for issuer to carefully manage the admin's account private key to avoid any potential risks of being hacked. It is highly recommend to use multi-signature wallet as admin account with private keys stored on different air-gapped hosts / hardware wallets.__

__⚠️ The contract does not check the code and data on `upgrade` message, so it is possible to brick the contract if you send invalid data or code. Therefore you should always check the upgrade in the testnet.__

# Local Development

## Install Dependencies

`npm install`

## Compile Contracts

`npm run build`

## Run Tests

`npm run test`

### Deploy or run another script

`npx blueprint run` or `yarn blueprint run`

use Toncenter API:

`npx blueprint run --custom https://testnet.toncenter.com/api/v2/ --custom-version v2 --custom-type testnet --custom-key <API_KEY> `

API_KEY can be obtained on https://toncenter.com or https://testnet.toncenter.com

## Notes

- The jetton-wallet contract does not include functionality that allows the owner to withdraw Toncoin funds from jetton-wallet Toncoin balance.

- The contract prices gas based on the *current* blockchain configuration. 
   It is worth keeping in mind the situation when the configuration has changed at the moment when the message goes from one jetton-wallet to another.
   Reducing fees in a blockchain configuration does not require additional actions.
   However, increasing fees in a blockchain configuration requires preliminary preparation - e.g. wallets and services must start sending Toncoins for gas in advance based on future parameters.

- If you set the status of Jetton Wallet to prohibit receiving jettons - there is no guarantee that when you send jettons to such a jetton-wallet, jettons will bounce back and be credited to the sender. In case of gas shortage they can be lost.
   Toncoin for gas and forward will also not be returned to the sender but will remain on the sender’s jetton-wallet.

# Security

The stablecoin contract has been created by TON Core team and audited by security companies:

- Trail of Bits: [Audit Report](https://github.com/ton-blockchain/stablecoin-contract/blob/main/audits/202403TON_Foundation_Stablecoin_Contracts_Report_+_Fix_Review.pdf)

Feel free to review these reports for a detailed understanding of the contract's security measures.