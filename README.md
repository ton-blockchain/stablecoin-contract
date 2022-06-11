# TON-USDT

FunC smart contracts for USDT Jetton on TON.

These are [standard TON jetton smart contracts](https://github.com/ton-blockchain/token-contract/tree/369ae089255edbd807eb499792a0a838c2e1b272/ft) with additional functionality:

- Admin of jetton can make transfers from user's jetton wallet.

- Admin of jetton can burn user's jettons.

- Admin of jetton can lock/unlock user's jetton wallet (`set_status`). If the status is not set to zero, then the user's wallet is locked, the user cannot make transfers; Admin can make transfer even if wallet locked.

- Admin of jetton can change jetton-minter code and it's full data.

# Local Development

The following assumes the use of `node@>=16` and requires `func` and `fift` executable installed and in path.

## Install Dependencies

`npm install`

## Compile Contracts

`npm run build`

## Run Tests

`npm run test`

## Deploy Contracts

`npm run deploy`

## Credits

Author @dariotarantini.

Reviewed by @tolya-yanot.