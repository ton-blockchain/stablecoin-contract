# Precompiled constants

All of the contents are result of contract emulation tests

## Storage

Get calculated in a separate test file [https://https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/StateInit.spec.ts](StateInit.spec.ts)
- `JETTON_WALLET_BITS` [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/StateInit.spec.ts#L92](L92) 
- `JETTON_WALLET_CELLS`: [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/StateInit.spec.ts#L92](L92) 

- `JETTON_WALLET_INITSTATE_BITS` [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/StateInit.spec.ts#L95](L95)  
- `JETTON_WALLET_CELLS` [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/StateInit.spec.ts#L95](L95)

## Gas

Gas constants are calculated in the main test suite.
First the related transaction is found, and then it's
resulting gas consumption is printed to the console.

- `SEND_TRANSFER_GAS_CONSUMPTION` [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/JettonWallet.spec.ts#L853](L853)
- `RECEIVE_TRANSFER_GAS_CONSUMPTION` [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/JettonWallet.spec.ts#L862](L862) 
- `SEND_BURN_GAS_CONSUMPTION` [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/JettonWallet.spec.ts#L1154](L1154)
- `RECEIVE_BURN_GAS_CONSUMPTION` [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/JettonWallet.spec.ts#L1155](L1155) 

## Minimal fees

- Transfer [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/JettonWallet.spec.ts#L935](L935) `0.028627415` TON
- Burn [https://github.com/ton-blockchain/stablecoin-contract/blob/hopefully_final_edits/sandbox_tests/JettonWallet.spec.ts#L1185](L1185) `0.016492002` TON

Current state only, subject of change once finilized.
