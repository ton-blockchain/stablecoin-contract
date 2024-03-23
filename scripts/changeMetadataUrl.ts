import {compile, NetworkProvider} from '@ton/blueprint';
import {jettonWalletCodeFromLibrary, promptBool, promptUrl, promptUserFriendlyAddress} from "../wrappers/ui-utils";
import {checkJettonMinter} from "./JettonMinterChecker";

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';

    const ui = provider.ui();

    const jettonMinterCode = await compile('JettonMinter');
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const jettonWalletCode = jettonWalletCodeFromLibrary(jettonWalletCodeRaw);

    const jettonMinterAddress = await promptUserFriendlyAddress("Enter the address of the jetton minter", ui, isTestnet);

    try {
        const {
            jettonMinterContract,
            adminAddress
        } = await checkJettonMinter(jettonMinterAddress, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, true);

        if (!provider.sender().address!.equals(adminAddress)) {
            ui.write('You are not admin of this jetton minter');
            return;
        }

        // e.g "https://bridge.ton.org/token/1/0x111111111117dC0aa78b770fA6A738034120C302.json"
        const jettonMetadataUri = await promptUrl("Enter jetton metadata uri (https://jettonowner.com/jetton.json)", ui)

        if (!(await promptBool(`Change metadata url to "${jettonMetadataUri}"?`, ['yes', 'no'], ui))) {
            return;
        }

        await jettonMinterContract.sendChangeContent(provider.sender(), {
            uri: jettonMetadataUri
        });

        ui.write('Transaction sent');

    } catch (e: any) {
        ui.write(e.message);
        return;
    }
}
