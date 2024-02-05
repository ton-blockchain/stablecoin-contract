import { Address, toNano, beginCell, Cell } from '@ton/core';
import { JettonMinter } from '../wrappers/JettonMinter';
import { Librarian } from '../wrappers/Librarian';
import { compile, NetworkProvider, sleep } from '@ton/blueprint';
import { promptAddress, promptBool} from '../wrappers/ui-utils';


const waitForTransaction = async (provider:NetworkProvider, address:Address,
                                  action:string = "transaction",
                                  curTxLt:string | null = null,
                                  maxRetry:number = 15,
                                  interval:number=1000) => {
    let done  = false;
    let count = 0;
    const ui  = provider.ui();
    let blockNum = (await provider.api().getLastBlock()).last.seqno;
    if(curTxLt == null) {
        let initialState = await provider.api().getAccount(blockNum, address);
        let lt = initialState?.account?.last?.lt;
        curTxLt = lt ? lt : null;
    }
    do {
        ui.write(`Awaiting ${action} completion (${++count}/${maxRetry})`);
        await sleep(interval);
        let newBlockNum = (await provider.api().getLastBlock()).last.seqno;
        if (blockNum == newBlockNum) {
            continue;
        }
        blockNum = newBlockNum;
        const curState = await provider.api().getAccount(blockNum, address);
        if(curState?.account?.last !== null){
            done = curState?.account?.last?.lt !== curTxLt;
        }
    } while(!done && count < maxRetry);
    return done;
}

export async function run(provider: NetworkProvider) {
    const ui       = provider.ui();
    const sender   = provider.sender();
    const adminPrompt = `Please specify admin address`;

    let admin: Address;
    let dataCorrect: boolean;
    let jettonMetadataUri = "somejetton.ton/metadata.json";

    do {
        admin  = await promptAddress(adminPrompt, ui, sender.address);
        ui.write("Please verify data:\n")
        ui.write(`Admin:${admin}\n`);
        ui.write(`jettonMetadataUri:${jettonMetadataUri}\n\n`);
        dataCorrect = await promptBool('Is everything ok?(y/n)', ['y','n'], ui);
    } while(!dataCorrect);


    const wallet_code_raw = await compile('JettonWallet');
    const librarian_code = await compile('Librarian');
    const librarian = provider.open(Librarian.createFromConfig({code:wallet_code_raw}, librarian_code));
    await librarian.sendDeploy(provider.sender(), toNano("1000"));
    await waitForTransaction(provider, librarian.address, "Librarian deploy");

    let lib_prep = beginCell().storeUint(2,8).storeBuffer(wallet_code_raw.hash()).endCell();
    const wallet_code = new Cell({ exotic:true, bits: lib_prep.bits, refs:lib_prep.refs});

    const minter  = provider.open(JettonMinter.createFromConfig({admin,
                                                  wallet_code,
                                                  jetton_content:{uri:jettonMetadataUri}
                                                  }, 
                                                  await compile('JettonMinter')));
    await minter.sendDeploy(provider.sender(), toNano("2"));
}
