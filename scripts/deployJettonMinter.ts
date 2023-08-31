import { Address, toNano } from '@ton/core';
import { JettonMinter } from '../wrappers/JettonMinter';
import { compile, NetworkProvider} from '@ton/blueprint';
import { promptAddress, promptBool} from '../wrappers/ui-utils';


export async function run(provider: NetworkProvider) {
    const ui       = provider.ui();
    const sender   = provider.sender();
    const adminPrompt = `Please specify admin address`;

    let admin: Address;
    let dataCorrect: boolean;

    do {
        admin  = await promptAddress(adminPrompt, ui, sender.address);
        ui.write("Please verify data:\n")
        ui.write(`Admin:${admin}\n\n`);
        dataCorrect = await promptBool('Is everything ok?(y/n)', ['y','n'], ui);
    } while(!dataCorrect);

    const wallet_code = await compile('JettonWallet');

    const minter  = JettonMinter.createFromConfig({admin,
                                                  wallet_code,
                                                  }, 
                                                  await compile('JettonMinter'));

    await provider.deploy(minter, toNano('0.05'));
}
