import {compile, NetworkProvider} from '@ton/blueprint';
import {jettonWalletCodeFromLibrary, promptUserFriendlyAddress} from "../wrappers/ui-utils";
import {checkJettonWallet} from "./JettonWalletChecker";

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';

    const ui = provider.ui();

    const jettonMinterCode = await compile('JettonMinter');
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const jettonWalletCode = jettonWalletCodeFromLibrary(jettonWalletCodeRaw);

    const jettonWalletAddress = await promptUserFriendlyAddress("Enter the address of the jetton wallet", ui, isTestnet);

    try {
        await checkJettonWallet(jettonWalletAddress, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, false);
    } catch (e: any) {
        ui.write(e.message);
        return;
    }
}
