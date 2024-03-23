import {compile, NetworkProvider} from '@ton/blueprint';
import {jettonWalletCodeFromLibrary, promptBool, promptToncoin, promptUserFriendlyAddress} from "../wrappers/ui-utils";
import {checkJettonMinter} from "./JettonMinterChecker";
import {fromNano} from "@ton/core";

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';

    const ui = provider.ui();

    const jettonMinterCode = await compile('JettonMinter');
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const jettonWalletCode = jettonWalletCodeFromLibrary(jettonWalletCodeRaw);

    const jettonMinterAddress = await promptUserFriendlyAddress("Enter the address of the jetton minter", ui, isTestnet);

    try {
        const {jettonMinterContract} = await checkJettonMinter(jettonMinterAddress, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, true);

        const tonAmount = await promptToncoin("Enter Toncoin amount to top-up jetton-minter Toncoins balance.", ui);

        if (!(await promptBool(`${fromNano(tonAmount)} TON top-up ?`, ['yes', 'no'], ui))) {
            return;
        }

        await jettonMinterContract.sendTopUp(provider.sender(), tonAmount);

        ui.write('Transaction sent');

    } catch (e: any) {
        ui.write(e.message);
        return;
    }
}
