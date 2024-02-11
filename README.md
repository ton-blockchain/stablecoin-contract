# TON-STABLE

FunC smart contracts for Stable Jetton on TON (for instance equivalent of US Dollar) issued by central entity.

## Contract audit
Contract was [audited by Certik](https://www.certik.com/projects/the-open-network?utm_source=CoinGecko&utm_campaign=AuditByCertiKLink) and all findings have been addressed.

# Targets and goals

This project was created to allow users to exchange and buy assets in the TON DeFi ecosystem for a jetton (token or currency) that is not subject to volatile fluctuations. To meet regulatory requirements, the issuer of the tokens must have additional control over the tokens.

Thus this jetton represents a [standard TON jetton smart contracts](https://github.com/ton-blockchain/token-contract/tree/369ae089255edbd807eb499792a0a838c2e1b272/ft) with additional functionality:

- Admin of jetton can make transfers from user's jetton wallet.

- Admin of jetton can burn user's jettons.

- Admin of jetton can lock/unlock user's jetton wallet (`set_status`). If the status is not set to zero, then the user's wallet is locked, the user cannot make transfers and burns; Admin can make transfer and burn even if wallet locked.

- Admin of jetton can change jetton-minter code and it's full data.

__It is critically important for issuer to carefully manage the admin's account private key to avoid any potential risks of being hacked. It is highly recommend to use multi-signature wallet as admin account with private keys stored on different air-gapped hosts / hardware wallets.__

# Local Development

The following assumes the use of `node@>=16` and requires `func` and `fift` executable installed and in path.

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
