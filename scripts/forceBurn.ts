import {compile, NetworkProvider} from '@ton/blueprint';
import {
    addressToString,
    jettonWalletCodeFromLibrary,
    promptAmount,
    promptBool,
    promptUserFriendlyAddress
} from "../wrappers/ui-utils";
import {checkJettonMinter} from "./JettonMinterChecker";
import {checkJettonWallet} from "./JettonWalletChecker";
import {fromUnits} from "./units";

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
            adminAddress,
            decimals
        } = await checkJettonMinter(jettonMinterAddress, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, true);

        const fromAddress = await promptUserFriendlyAddress("Please enter user address to burn from:", ui, isTestnet);
        const fromJettonWalletAddress = await jettonMinterContract.getWalletAddress(fromAddress.address);

        const {jettonBalance} = await checkJettonWallet({
            address: fromJettonWalletAddress,
            isBounceable: true,
            isTestOnly: isTestnet
        }, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, true);

        if (!provider.sender().address!.equals(adminAddress)) {
            ui.write('You are not admin of this jetton minter');
            return;
        }

        const amount = await promptAmount("Enter jetton amount to burn", decimals, ui);

        if (jettonBalance < amount) {
            ui.write(`This user have only ${fromUnits(jettonBalance, decimals)}`);
            return;
        }

        if (!(await promptBool(`Burn ${fromUnits(amount, decimals)} from ${addressToString(fromAddress)}?`, ['yes', 'no'], ui))) {
            return;
        }

        await jettonMinterContract.sendForceBurn(provider.sender(),
            amount,
            fromAddress.address,
            null);

        ui.write('Transaction sent');

    } catch (e: any) {
        ui.write(e.message);
        return;
    }
}
