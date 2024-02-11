import { Address, beginCell, Cell, fromNano, OpenedContract, toNano } from '@ton/core';
import { compile, NetworkProvider, UIProvider} from '@ton/blueprint';
import { JettonMinter, jettonMinterConfigCellToConfig, JettonMinterConfigFull, jettonMinterConfigFullToCell } from '../wrappers/JettonMinter';
import { promptBool, promptAmount, promptAddress, displayContentCell, getLastBlock, waitForTransaction, getAccountLastTx } from '../wrappers/ui-utils';
import { JettonWallet } from '../wrappers/JettonWallet';
import {TonClient4} from "@ton/ton";
let minterContract:OpenedContract<JettonMinter>;

const adminActions  = ['Mint', 'Change admin', 'Upgrade', 'Lock', 'Unlock', 'Force transfer', 'Force burn'];
const userActions   = ['Info', 'Claim admin', 'Quit'];
let minterCode: Cell;
let walletCode: Cell;



const failedTransMessage = (ui:UIProvider) => {
    ui.write("Failed to get indication of transaction completion from API!\nCheck result manually, or try again\n");

};

const infoAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const jettonData = await minterContract.getJettonData();
    ui.write("Jetton info:\n\n");
    ui.write(`Admin:${jettonData.adminAddress}\n`);
    ui.write(`Total supply:${fromNano(jettonData.totalSupply)}\n`);
    ui.write(`Mintable:${jettonData.mintable}\n`);
    const displayContent = await ui.choose('Display content?', ['Yes', 'No'], (c: string) => c);
    if(displayContent == 'Yes') {
        await displayContentCell(jettonData.content, ui);
    }
};
const changeAdminAction = async(provider:NetworkProvider, ui:UIProvider) => {
    let retry:boolean;
    let newAdmin:Address;
    let curAdmin = await minterContract.getAdminAddress();
    do {
        retry = false;
        newAdmin = await promptAddress('Please specify new admin address:', ui);
        if(newAdmin.equals(curAdmin)) {
            retry = true;
            ui.write("Address specified matched current admin address!\nPlease pick another one.\n");
        }
        else {
            ui.write(`New admin address is going to be:${newAdmin}\nKindly double check it!\n`);
            retry = !(await promptBool('Is it ok?', ['yes', 'no'], ui));
        }
    } while(retry);

    const lastTx   = await getAccountLastTx(provider, minterContract.address);

    await minterContract.sendChangeAdmin(provider.sender(), newAdmin);
    const transDone = await waitForTransaction(provider,
                                               minterContract.address,
                                               lastTx,
                                               10);
    if(transDone) {
        ui.write(`Admin change to address:${newAdmin} requested\nNext you need to claim admin from that address`);
    }
    else {
        failedTransMessage(ui);
    }
};

const claimAdminAction = async (provider: NetworkProvider, ui: UIProvider) => {
    const prevAdmin = await minterContract.getAdminAddress();
    const lastTx   = await getAccountLastTx(provider, minterContract.address);

    await minterContract.sendClaimAdmin(provider.sender());

    const transDone = await waitForTransaction(provider,
                                               minterContract.address,
                                               lastTx,
                                               10);
    if(transDone) {
        const newAdmin = await minterContract.getAdminAddress();
        if(newAdmin.equals(prevAdmin)) {
            ui.write("Something went wrong!\nAdmin address didn't change");
        }
        else {
            ui.write(`Admin address changed successfully to:${newAdmin}`);
        }
    }
    else {
        failedTransMessage(ui);
    }
}

const mintAction = async (provider:NetworkProvider, ui:UIProvider) => {
    const sender = provider.sender();
    let retry:boolean;
    let mintAddress:Address;
    let mintAmount:string;

    do {
        retry = false;
        const fallbackAddr = sender.address ?? await minterContract.getAdminAddress();
        mintAddress = await promptAddress(`Please specify address to mint to`, ui, fallbackAddr);
        mintAmount  = await promptAmount('Please provide mint amount in decimal form:', ui);
        ui.write(`Mint ${mintAmount} tokens to ${mintAddress}\n`);
        retry = !(await promptBool('Is it ok?', ['yes', 'no'], ui));
    } while(retry);

    ui.write(`Minting ${mintAmount} to ${mintAddress}\n`);
    const supplyBefore = await minterContract.getTotalSupply();
    const nanoMint     = toNano(mintAmount);
    const lastTx       = await getAccountLastTx(provider, minterContract.address);

    await minterContract.sendMint(sender,
                                  mintAddress,
                                  nanoMint);
    const gotTrans = await waitForTransaction(provider,
                                              minterContract.address,
                                              lastTx,
                                              10);
    if(gotTrans) {
        const supplyAfter = await minterContract.getTotalSupply();

        if(supplyAfter == supplyBefore + nanoMint) {
            ui.write("Mint successfull!\nCurrent supply:" + fromNano(supplyAfter));
        }
        else {
            ui.write("Mint failed!");
        }
    }
    else {
        failedTransMessage(ui);
    }
}

const updateData = async (oldData: Cell, ui: UIProvider) => {
    const curConfig   = jettonMinterConfigCellToConfig(oldData);
    let   newConfig: JettonMinterConfigFull;
    let   retry: boolean;
    do {
        newConfig   = {...curConfig};
        let   updateWallet = false;
        const updateSupply = await promptBool(`Current supply:${fromNano(curConfig.supply)}\nWant to change?`, ['Yes', 'No'], ui, true);
        if(updateSupply)
            newConfig.supply   = toNano(await promptAmount('Enter new supply amount:', ui));
        const updateAdmin  = await promptBool(`Current admin:${curConfig.admin}\nWant to change?`, ['Yes', 'No'], ui, true);
        if(updateAdmin)
            newConfig.admin = await promptAddress('Enter new admin address:', ui);
        if(newConfig.transfer_admin !== null){
            if(!(await promptBool(`Currently admin rights can be transfered to:${curConfig.transfer_admin}\nPreserve?`,['Yes', 'No'], ui))){
                // Drop the transfer rights
                newConfig.transfer_admin = null;
            }
        }
        // If different from contract code
        if(!curConfig.wallet_code.equals(walletCode)) {
            // Demand written answer
            updateWallet = await promptBool("Update wallet code from jetton-wallet.fc?\n(CAUTION:This will break compatability with deployed wallets)", ['Yes', 'No'], ui);
            if(updateWallet) {
                newConfig.wallet_code = walletCode;
            }
        }
        retry = !(await promptBool(`New config:${JSON.stringify({
            supply: newConfig.supply.toString(),
            admin: newConfig.admin.toString(),
            transfer_admin: newConfig.transfer_admin?.toString(),
            wallet_code: updateWallet ? "updated" : "preserved"
        }, null, 2)}\nIs it okay?`, ['Yes', 'No'], ui));
    } while(retry);
    return jettonMinterConfigFullToCell(newConfig);
}
const upgradeAction = async (provider: NetworkProvider, ui: UIProvider) => {
    const api = provider.api() as TonClient4;
    let upgradeCode = await promptBool(`Would you like to upgrade code?\nSource from jetton-minter.fc will be used.`, ['Yes', 'No'], ui, true);
    let upgradeData = await promptBool(`Would you like to upgrade data?`, ['Yes', 'No'], ui, true);

    const contractState = await api.getAccount(await getLastBlock(provider), minterContract.address);

    if(contractState.account.state.type !== 'active')
        throw(Error("Upgrade is only possible for active contract"));

    if(contractState.account.state.code === null)
        throw(Error(`Something is wrong!\nActive contract has to have code`));

    const dataBefore =  contractState.account.state.data ? Cell.fromBase64(contractState.account.state.data) : beginCell().endCell();
    if(upgradeCode || upgradeData) {
        const newCode = upgradeCode ? minterCode : Cell.fromBase64(contractState.account.state.code);
        const newData = upgradeData ? await updateData(dataBefore, ui) : dataBefore;
        await minterContract.sendUpgrade(provider.sender(), newCode, newData, toNano('0.05'));
        const gotTrans = await waitForTransaction(provider,
                                                  minterContract.address,
                                                  contractState.account.last!.lt,
                                                  10);
        if(gotTrans){
            ui.write("Contract upgraded successfully!");
        }
        else {
            failedTransMessage(ui);
        }

    }
    else {
        ui.write('Nothing to do then!');
    }
}

type AccountStateLite = any;
type AccountStateFull = any;

const matchCodeLite = (contractState: AccountStateLite, code: Cell) => {
    let equals = false;

    if(contractState.account.state.type === 'active') {
        const codeHash = code.hash()
        equals = codeHash.equals(Buffer.from(contractState.account.state.codeHash, 'base64'));
    }

    return equals;
}

const matchCodeFull = (contractState: AccountStateFull, code: Cell) => {
    let equals = false;
    if(contractState.account.state.type === 'active') {
        if(contractState.account.state.code !== null) {
            equals = code.equals(Cell.fromBase64(contractState.account.state.code));
        }
    }
    return equals;
}

// Feels like i could have figured out something callback based instead of those three similar handlers...You've guessed it, not today.
const lockAction = async (provider: NetworkProvider, ui: UIProvider, lock: boolean) => {
    const lockPrompt = lock ? 'lock' : 'unlock';
    let   retry: boolean;
    do {
        const lockAddr   = await promptAddress(`Please enter address to ${lockPrompt}:`, ui);
        const jettonAddr = await minterContract.getWalletAddress(lockAddr);
        ui.write(`Owned jetton address:${jettonAddr}`);
        const contractState = await (provider.api() as TonClient4).getAccountLite(await getLastBlock(provider), jettonAddr);
        if(contractState.account.state.type === 'active') {
            if(! (await matchCodeLite(contractState, walletCode))) {
                const action = await ui.choose('Contract code doesn\'t match current wallet version', ['Continue', 'Switch wallet', 'Stop'], (c: string) => c);
                if(action == 'Stop')
                    return;
                if(action == 'Switch wallet') {
                    retry = true;
                    // Jump at the end of the block
                    continue;
                }
            }
            const jettonWalelt = provider.open(JettonWallet.createFromAddress(jettonAddr));
            if((await jettonWalelt.getWalletStatus()) == Number(lock)) {
                ui.write(`Jetton wallet owned by:${lockAddr} is already ${lockPrompt}ed!`);
                retry = false;
            }
            else {
                // We could have re-used data from contractState but it's impossible to tell how long dialogs will take, and we need fresh tx lt
                const prevTx = await getAccountLastTx(provider, minterContract.address);
                await minterContract.sendLockWallet(provider.sender(), lockAddr, lock ? 'full' : 'unlock', toNano('0.05'));
                const gotTrans = await waitForTransaction(provider, minterContract.address, prevTx, 10);
                if(gotTrans) {
                    const lockAfter = await jettonWalelt.getWalletStatus();
                    if(lockAfter !== Number(lock)) {
                        retry = await promptBool(`Failed to ${lockPrompt} wallet.\nSomething went wrong\nRetry?`,['Yes','No'], ui, true);
                    }
                    else {
                        ui.write(`Jetton wallet ${jettonAddr} ${lockPrompt}ed successfully!`);
                        retry = false;
                    }
                }
                else {
                    failedTransMessage(ui);
                    retry = await promptBool('Retry?', ['Yes', 'No'], ui, true);
                }
            }
        }
        else {
            retry = await promptBool("Jetton wallet contract is not active!\nRetry?", ['Yes','No'], ui, true);
        }
    } while(retry);
}

const transferAction = async (provider: NetworkProvider, ui: UIProvider) => {
    let   retry: boolean;
    do {
        const fromAddr = await promptAddress('Please enter jetton owner address to transfer from:', ui);
        const jettonAddr = await minterContract.getWalletAddress(fromAddr);
        ui.write(`Owned jetton address:${jettonAddr}`);
        const contractState = await (provider.api() as TonClient4).getAccountLite(await getLastBlock(provider), jettonAddr);
        if(contractState.account.state.type === 'active') {
            if(! (await matchCodeLite(contractState, walletCode))) {
                const action = await ui.choose('Contract code doesn\'t match current wallet version', ['Continue', 'Switch wallet', 'Stop'], (c: string) => c);
                if(action == 'Stop')
                    return;
                if(action == 'Switch wallet') {
                    retry = true;
                    continue;
                }
            }
            const transferAmount = await promptAmount('Enter transfer amount in decimal form:', ui);
            const defaultAddr    = provider.sender().address ?? await minterContract.getAdminAddress();
            const transferTo     = await promptAddress('Enter destination wallet address:', ui, defaultAddr);
            retry  = await promptBool(`Transfering ${transferAmount} jettons from ${fromAddr} to ${transferTo}\nIs it ok?`, ['Yes', 'No'], ui);
            if(!retry) {
                retry = true;
                continue;
            }
            const nanoAmount = toNano(transferAmount);
            const jettonWalelt = provider.open(JettonWallet.createFromAddress(jettonAddr));
            const balanceBefore = await jettonWalelt.getJettonBalance();

            const prevTx = await getAccountLastTx(provider, minterContract.address);
            await minterContract.sendForceTransfer(provider.sender(), nanoAmount, transferTo, fromAddr, null, 0n, null);
            const gotTrans = await waitForTransaction(provider, minterContract.address, prevTx, 10);
            if(gotTrans) {
                const balanceAfter= await jettonWalelt.getJettonBalance();
                if(balanceAfter == balanceBefore - nanoAmount) {
                    ui.write(`Successfully transfered:${transferAmount} jettons owned by ${fromAddr}`);
                    retry = false;
                }
                else {
                    retry = await promptBool(`Failed to transfer jettons\nRetry?`,['Yes','No'], ui, true);
                }
            }
            else {
                failedTransMessage(ui);
                retry = await promptBool('Retry?', ['Yes', 'No'], ui, true);
            }
        }
        else {
            retry = await promptBool("Jetton wallet contract is not active!\nRetry?", ['Yes','No'], ui, true);
        }
    } while(retry);

}
const burnAction = async (provider: NetworkProvider, ui: UIProvider) => {
    let   retry: boolean;
    do {
        const burnAddr = await promptAddress(`Please enter jetton owner address to burn:`, ui);
        const jettonAddr = await minterContract.getWalletAddress(burnAddr);
        ui.write(`Owned jetton address:${jettonAddr}`);
        const contractState = await (provider.api() as TonClient4).getAccountLite(await getLastBlock(provider), jettonAddr);
        if(contractState.account.state.type === 'active') {
            if(! (await matchCodeLite(contractState, walletCode))) {
                const action = await ui.choose('Contract code doesn\'t match current wallet version', ['Continue', 'Switch wallet', 'Stop'], (c: string) => c);
                if(action == 'Stop')
                    return;
                if(action == 'Switch wallet') {
                    retry = true;
                    continue;
                }
            }
            const burnAmount = await promptAmount('Enter burn amount in decimal form:', ui);
            const allOk      = await promptBool(`Burning ${burnAmount} jettons owned by ${burnAddr}\nIs that ok?`,['Yes', 'No'], ui);
            if(!allOk) {
                retry = true;
                continue;
            }
            const nanoAmount = toNano(burnAmount);
            const jettonWalelt = provider.open(JettonWallet.createFromAddress(jettonAddr));
            const balanceBefore = await jettonWalelt.getJettonBalance();

            const prevTx = await getAccountLastTx(provider, minterContract.address);
            // Maybe wait for tx on jetton wallet? Or the owner wallet even?
            await minterContract.sendForceBurn(provider.sender(), nanoAmount, burnAddr, null);
            const gotTrans = await waitForTransaction(provider, minterContract.address, prevTx, 10);
            if(gotTrans) {
                const balanceAfter= await jettonWalelt.getJettonBalance();
                if(balanceAfter == balanceBefore - nanoAmount) {
                    ui.write(`Successfully burned:${burnAmount} jettons owned by ${burnAddr}`);
                    retry = false;
                }
                else {
                    retry = await promptBool(`Failed to burn jettons\nRetry?`,['Yes','No'], ui, true);
                }
            }
            else {
                failedTransMessage(ui);
                retry = await promptBool('Retry?', ['Yes', 'No'], ui, true);
            }
        }
        else {
            retry = await promptBool("Jetton wallet contract is not active!\nRetry?", ['Yes','No'], ui, true);
        }
    } while(retry);
}

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const sender = provider.sender();
    const hasSender = sender.address !== undefined;
    const api    = provider.api() as TonClient4;
    minterCode = await compile('JettonMinter');
    walletCode = await compile('JettonWallet');
    let   done   = false;
    let   retry:boolean;
    let   minterAddress:Address;

    do {
        retry = false;
        minterAddress = await promptAddress('Please enter minter address:', ui);
        const contractState = await api.getAccount(await getLastBlock(provider), minterAddress);
        if(contractState.account.state.type !== "active" || contractState.account.state.code == null) {
            retry = true;
            ui.write("This contract is not active!\nPlease use another address, or deploy it first");
        }
        else {
            const stateCode = Cell.fromBase64(contractState.account.state.code);
            if(!stateCode.equals(minterCode)) {
                ui.write("Contract code differs from the current contract version!\n");
                const resp = await ui.choose("Use address anyway", ["Yes", "No"], (c: string) => c);
                retry = resp == "No";
            }
        }
    } while(retry);

    minterContract = provider.open(JettonMinter.createFromAddress(minterAddress));
    const isAdmin  = hasSender ? (await minterContract.getAdminAddress()).equals(sender.address) : true;
    let actionList:string[];
    if(isAdmin) {
        actionList = [...adminActions, ...userActions];
        ui.write("Current wallet is minter admin!\n");
    }
    else {
        actionList = userActions;
        ui.write("Current wallet is not admin!\nAvaliable actions restricted\n");
    }

    do {
        ui.clearActionPrompt();
        const action = await ui.choose("Pick action:", actionList, (c: string) => c);
        switch(action) {
            case 'Mint':
                await mintAction(provider, ui);
                break;
            case 'Change admin':
                await changeAdminAction(provider, ui);
                break;
            case 'Claim admin':
                await claimAdminAction(provider, ui);
                break;
            case 'Upgrade':
                await upgradeAction(provider, ui);
                break;
            case 'Info':
                await infoAction(provider, ui);
                break;
            case 'Lock':
                await lockAction(provider, ui, true);
                break;
            case 'Unlock':
                await lockAction(provider, ui, false);
                break;
            case 'Force transfer':
                await transferAction(provider, ui);
                break;
            case 'Force burn':
                await burnAction(provider, ui);
                break;
            case 'Quit':
                done = true;
                break;
            default:
                ui.write('Operation is not yet supported!');
        }
    } while(!done);
}
