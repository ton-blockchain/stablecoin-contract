import {toNano} from '@ton/core';
import {Librarian} from '../wrappers/Librarian';
import {compile, NetworkProvider} from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const wallet_code_raw = await compile('JettonWallet');
    const librarian_code = await compile('Librarian');
    const librarian = provider.open(Librarian.createFromConfig({code: wallet_code_raw}, librarian_code));
    await librarian.sendDeploy(provider.sender(), toNano("10"));
}
