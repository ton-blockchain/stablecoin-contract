import {beginCell, Cell, toNano} from '@ton/core';
import {JettonMinter} from '../wrappers/JettonMinter';
import {compile, NetworkProvider} from '@ton/blueprint';
import {promptUrl, promptUserFriendlyAddress} from "../wrappers/ui-utils";

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';

    const ui = provider.ui();
    const jettonWalletCodeRaw = await compile('JettonWallet');

    const adminAddress = await promptUserFriendlyAddress("Enter the address of the jetton owner (admin):", ui, isTestnet);

    // e.g "https://bridge.ton.org/token/1/0x111111111117dC0aa78b770fA6A738034120C302.json"
    const jettonMetadataUri = await promptUrl("Enter jetton metadata uri (https://jettonowner.com/jetton.json)", ui)

    // https://docs.ton.org/tvm.pdf, page 30
    // Library reference cell — Always has level 0, and contains 8+256 data bits, including its 8-bit type integer 2
    // and the representation hash Hash(c) of the library cell being referred to. When loaded, a library
    // reference cell may be transparently replaced by the cell it refers to, if found in the current library context.

    const libraryReferenceCell = beginCell().storeUint(2, 8).storeBuffer(jettonWalletCodeRaw.hash()).endCell();
    const jettonWalletCode = new Cell({exotic: true, bits: libraryReferenceCell.bits, refs: libraryReferenceCell.refs});

    const minter = provider.open(JettonMinter.createFromConfig({
            admin: adminAddress.address,
            wallet_code: jettonWalletCode,
            jetton_content: {uri: jettonMetadataUri}
        },
        await compile('JettonMinter')));

    await minter.sendDeploy(provider.sender(), toNano("1.5")); // send 1.5 TON
}
