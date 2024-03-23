import {compile, NetworkProvider} from '@ton/blueprint';
import {
    addressToString,
    jettonWalletCodeFromLibrary,
    lockTypeToName,
    promptBool,
    promptLockType,
    promptUserFriendlyAddress
} from "../wrappers/ui-utils";
import {checkJettonMinter} from "./JettonMinterChecker";
import {checkJettonWallet} from "./JettonWalletChecker";
import {LOCK_TYPES, LockType} from "../wrappers/JettonMinter";

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';

    const ui = provider.ui();

    const jettonMinterCode = await compile('JettonMinter');
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const jettonWalletCode = jettonWalletCodeFromLibrary(jettonWalletCodeRaw);

    const jettonMinterAddress = await promptUserFriendlyAddress("Enter the address of the jetton minter", ui, isTestnet);

    try {
        const {jettonMinterContract} = await checkJettonMinter(jettonMinterAddress, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, true);

        const userAddress = await promptUserFriendlyAddress("Please enter user address:", ui, isTestnet);
        const fromJettonWalletAddress = await jettonMinterContract.getWalletAddress(userAddress.address);
        const {jettonBalance} = await checkJettonWallet({
            address: fromJettonWalletAddress,
            isBounceable: true,
            isTestOnly: isTestnet
        }, jettonMinterCode, jettonWalletCode, provider, ui, isTestnet, true);


        LOCK_TYPES.forEach(lockType => {
            ui.write(lockType + ' - ' + lockTypeToName(lockType as LockType));
        });

        const newStatus = await promptLockType(`Enter new status (${LOCK_TYPES.join(', ')})`, ui);

        if (!(await promptBool(`Set status ${newStatus} to ${addressToString(userAddress)}?`, ['yes', 'no'], ui))) {
            return;
        }

        await jettonMinterContract.sendLockWallet(provider.sender(),
            userAddress.address,
            newStatus
        );

        ui.write('Transaction sent');

    } catch (e: any) {
        ui.write(e.message);
        return;
    }
}
