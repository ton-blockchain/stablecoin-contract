import {JettonMinter} from '../wrappers/JettonMinter';
import {compile, NetworkProvider} from '@ton/blueprint';
import {
    addressToString,
    assert,
    base64toCell,
    formatAddressAndUrl,
    jettonWalletCodeFromLibrary,
    promptUserFriendlyAddress,
    sendToIndex
} from "../wrappers/ui-utils";
import {fromNano, OpenedContract} from "@ton/core";
import {JettonWallet, parseJettonWalletData} from "../wrappers/JettonWallet";

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';

    const ui = provider.ui();

    const jettonMinterCode = await compile('JettonMinter');
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const jettonWalletCode = jettonWalletCodeFromLibrary(jettonWalletCodeRaw);

    const jettonWalletAddress = await promptUserFriendlyAddress("Enter the address of the jetton wallet", ui, isTestnet);

    // Account State and Data
    
    const result = await sendToIndex('account', {address: addressToString(jettonWalletAddress)}, provider);
    ui.write('Contract status: ' + result.status);

    assert(result.status === 'active', "Contract not active", ui);
    
    if (base64toCell(result.code).equals(jettonWalletCode)) {
        ui.write('The contract code matches the jetton-wallet code from this repository');
    } else {
        ui.write('The contract code DOES NOT match the jetton-wallet code from this repository');
        return;
    }

    ui.write('Toncoin balance on jetton-wallet: ' + fromNano(result.balance) + ' TON');

    const data = base64toCell(result.data);
    const parsedData = parseJettonWalletData(data);
    ui.write('Jetton-wallet status: ' + parsedData.status); // todo: human-readable status
    ui.write('Balance: ' + parsedData.balance + ' units'); // todo: show with decimals
    ui.write('Owner address: ' + (await formatAddressAndUrl(parsedData.ownerAddress, provider, isTestnet)));
    ui.write('Jetton-minter address: ' + (await formatAddressAndUrl(parsedData.jettonMasterAddress, provider, isTestnet)));

    // Check in jetton-minter

    const jettonMinterContract: OpenedContract<JettonMinter> = provider.open(JettonMinter.createFromAddress(parsedData.jettonMasterAddress));
    const jettonWalletAddress2 = await jettonMinterContract.getWalletAddress(parsedData.ownerAddress);
    assert(jettonWalletAddress2.equals(jettonWalletAddress.address), "fake jetton-minter", ui);


    // Get-methods

    const jettonWalletContract: OpenedContract<JettonWallet> = provider.open(JettonWallet.createFromAddress(jettonWalletAddress.address));
    const getData = await jettonWalletContract.getWalletData();

    assert(getData.balance === parsedData.balance, "Balance doesn't match", ui);
    assert(getData.owner.equals(parsedData.ownerAddress), "Owner address doesn't match", ui);
    assert(getData.minter.equals(parsedData.jettonMasterAddress), "Jetton master address doesn't match", ui);
    assert(getData.wallet_code.equals(jettonWalletCode), "Jetton wallet code doesn't match", ui);

    assert((await jettonWalletContract.getWalletStatus()) === parsedData.status, "Jetton wallet status doesn't match", ui);

    // StateInit

    const jettonWalletContract2 = JettonWallet.createFromConfig({
        ownerAddress: parsedData.ownerAddress,
        jettonMasterAddress: parsedData.jettonMasterAddress
    }, jettonWalletCode);

    if (jettonWalletContract2.address.equals(jettonWalletAddress.address)) {
        ui.write('StateInit matches');
    }

}
