import {JettonMinter, parseJettonMinterData} from '../wrappers/JettonMinter';
import {compile, NetworkProvider} from '@ton/blueprint';
import {
    addressToString,
    assert,
    base64toCell,
    equalsMsgAddresses,
    formatAddressAndUrl,
    jettonWalletCodeFromLibrary,
    parseContentCell,
    promptUserFriendlyAddress,
    sendToIndex
} from "../wrappers/ui-utils";
import {Cell, fromNano, OpenedContract} from "@ton/core";

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';

    const ui = provider.ui();

    const jettonMinterCode = await compile('JettonMinter');
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const jettonWalletCode = jettonWalletCodeFromLibrary(jettonWalletCodeRaw);

    const jettonMinterAddress = await promptUserFriendlyAddress("Enter the address of the jetton minter", ui, isTestnet);

    // Account State and Data

    const result = await sendToIndex('account', {address: addressToString(jettonMinterAddress)}, provider);
    ui.write('Contract status: ' + result.status);

    assert(result.status === 'active', "Contract not active", ui);

    if (base64toCell(result.code).equals(jettonMinterCode)) {
        ui.write('The contract code matches the jetton-minter code from this repository');
    } else {
        ui.write('The contract code DOES NOT match the jetton-minter code from this repository');
        return;
    }

    ui.write('Toncoin balance on jetton-minter: ' + fromNano(result.balance) + ' TON');

    const data = base64toCell(result.data);
    const parsedData = parseJettonMinterData(data);
    ui.write('Total Supply: ' + parsedData.supply + ' units'); // todo: show with decimals
    ui.write('Current admin address: ' + (await formatAddressAndUrl(parsedData.admin, provider, isTestnet)));
    const nextAdminAddress = parsedData.transfer_admin;
    if (!nextAdminAddress) {
        ui.write('Next admin address: null');
    } else {
        ui.write('Next admin address: ' + (await formatAddressAndUrl(nextAdminAddress, provider, isTestnet)));
    }

    if (parsedData.wallet_code.equals(jettonWalletCode)) {
        ui.write('The jetton-wallet code matches the jetton-wallet code from this repository');
    } else {
        ui.write('The jetton-wallet DOES NOT match the jetton-wallet code from this repository');
        return;
    }

    const metadataUrl: string = (parsedData.jetton_content as Cell).beginParse().loadStringTail();
    ui.write(`Metadata URL: "${metadataUrl}"`);

    // Get-methods

    const jettonMinterContract: OpenedContract<JettonMinter> = provider.open(JettonMinter.createFromAddress(jettonMinterAddress.address));
    const getData = await jettonMinterContract.getJettonData();

    assert(getData.totalSupply === parsedData.supply, "Total supply doesn't match", ui);
    ui.write('Mintable: ' + getData.mintable);
    assert(getData.adminAddress.equals(parsedData.admin), "Admin address doesn't match", ui);

    const parsedContent = await parseContentCell(getData.content);
    if (parsedContent instanceof String) {
        throw new Error('content not HashMap');
    } else {
        const contentMap: any = parsedContent;
        console.assert(contentMap['uri'], metadataUrl, "Metadata URL doesn't match");
        const decimalsString = contentMap['decimals'];
        const decimals = parseInt(decimalsString);
        if (isNaN(decimals)) {
            throw new Error('invalid decimals');
        }
        ui.write('Decimals: ' + decimals);
    }

    assert(getData.walletCode.equals(parsedData.wallet_code), "Jetton-wallet code doesn't match", ui);

    const getNextAdminAddress = await jettonMinterContract.getNextAdminAddress();
    console.assert(equalsMsgAddresses(getNextAdminAddress, parsedData.transfer_admin), "Next admin address doesn't match");

    // StateInit

    const jettonMinterContract2 = JettonMinter.createFromConfig({
        admin: parsedData.admin,
        wallet_code: jettonWalletCode,
        jetton_content: {
            uri: metadataUrl
        }
    }, jettonMinterCode)

    if (jettonMinterContract2.address.equals(jettonMinterAddress.address)) {
        ui.write('StateInit matches');
    }
}
