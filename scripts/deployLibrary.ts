import {Librarian} from '../wrappers/Librarian';
import {compile, NetworkProvider} from '@ton/blueprint';
import {promptToncoin} from "../wrappers/ui-utils";

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    ui.write("This jetton contract uses the jetton-wallet code from library. This reduces network fees when operating with the jetton.");
    ui.write("Librarian is the contract that stores the library.");
    ui.write("If someone is already storing this jetton-wallet library on the blockchain - you don't need to deploy librarian.");
    const jettonWalletCodeRaw = await compile('JettonWallet');
    const librarianCode = await compile('Librarian');

    const tonAmount = await promptToncoin("Enter Toncoin amount to deploy librarian. Some of Toncoins will reserved on the contract to pay storage fees. Excess will be returned.", ui);
    const librarian = provider.open(Librarian.createFromConfig({code: jettonWalletCodeRaw}, librarianCode));
    await librarian.sendDeploy(provider.sender(), tonAmount);
}
