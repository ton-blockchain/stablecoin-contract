import {compile, NetworkProvider} from '@ton/blueprint';
import {jettonWalletCodeFromLibrary, promptBool, promptUserFriendlyAddress} from "../wrappers/ui-utils";
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
            nextAdminAddress
        } = await checkJettonMinter(jettonMinterAddress, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, true);

        if (!nextAdminAddress || !provider.sender().address!.equals(nextAdminAddress)) {
            ui.write('You are not new admin of this jetton minter');
            return;
        }

        if (!(await promptBool(`Claim admin?`, ['yes', 'no'], ui))) {
            return;
        }

        await jettonMinterContract.sendClaimAdmin(provider.sender());

        ui.write('Transaction sent');

    } catch (e: any) {
        ui.write(e.message);
        return;
    }
}
