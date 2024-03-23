import {compile, NetworkProvider} from '@ton/blueprint';
import {
    addressToString,
    jettonWalletCodeFromLibrary,
    promptBool,
    promptUserFriendlyAddress
} from "../wrappers/ui-utils";
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

        const newAdminAddress = await promptUserFriendlyAddress("Enter new admin address", ui, isTestnet);

        if (!(await promptBool(`Change admin to to ${addressToString(newAdminAddress)}?`, ['yes', 'no'], ui))) {
            return;
        }

        await jettonMinterContract.sendChangeAdmin(provider.sender(), newAdminAddress.address);

        ui.write('Transaction sent');

    } catch (e: any) {
        ui.write(e.message);
        return;
    }
}
