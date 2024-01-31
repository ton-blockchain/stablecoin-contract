import { Blockchain, SandboxContract, TreasuryContract, internal, BlockchainSnapshot, SendMessageResult, defaultConfigSeqno, BlockchainTransaction } from '@ton/sandbox';
import { Cell, toNano, beginCell, Address, Transaction, TransactionComputeVm, TransactionStoragePhase, storeAccountStorage, Sender, Dictionary, storeMessage, fromNano, DictionaryValue, storeStateInit } from '@ton/core';
import { jettonContentToCell, JettonMinter, jettonMinterConfigToCell, JettonMinterContent, LockType } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import { compile } from '@ton/blueprint';
import '@ton/test-utils';
import { collectCellStats } from '../gasUtils';
import { Op, Errors } from '../wrappers/JettonConstants';

let blockchain: Blockchain;
let deployer: SandboxContract<TreasuryContract>;
let jettonMinter:SandboxContract<JettonMinter>;
let minter_code: Cell;
let wallet_code: Cell;
let jwallet_code_raw: Cell;
let jwallet_code: Cell;
let userWallet: (address: Address) => Promise<SandboxContract<JettonWallet>>;

describe('State init tests', () => {
    beforeAll(async () => {
        blockchain = await Blockchain.create();
        deployer   = await blockchain.treasury('deployer');
        jwallet_code_raw = await compile('JettonWallet');
        minter_code    = await compile('JettonMinter');

        //jwallet_code is library
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${jwallet_code_raw.hash().toString('hex')}`), jwallet_code_raw);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        blockchain.libs = libs;
        let lib_prep = beginCell().storeUint(2,8).storeBuffer(jwallet_code_raw.hash()).endCell();
        jwallet_code = new Cell({ exotic:true, bits: lib_prep.bits, refs:lib_prep.refs});

        console.log('jetton minter code hash = ', minter_code.hash().toString('hex'));
        console.log('jetton wallet code hash = ', jwallet_code.hash().toString('hex'));

        jettonMinter   = blockchain.openContract(
                   JettonMinter.createFromConfig(
                     {
                       admin: deployer.address,
                       wallet_code: jwallet_code,
                       jetton_content: jettonContentToCell({uri: "https://ton.org/"})
                     },
                     minter_code));

        userWallet = async (address:Address) => blockchain.openContract(
                          JettonWallet.createFromAddress(
                            await jettonMinter.getWalletAddress(address)
                          )
                     );

    });
    it('should deploy', async () => {

        //await blockchain.setVerbosityForAddress(jettonMinter.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
        const deployResult = await jettonMinter.sendDeploy(deployer.getSender(), toNano('10'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
        });
        // Make sure it didn't bounce
        expect(deployResult.transactions).not.toHaveTransaction({
            on: deployer.address,
            from: jettonMinter.address,
            inMessageBounced: true
        });
    });
    it('should mint max jetton walue', async () => {
        const maxValue = (2n ** 120n) - 1n;
        const deployerWallet = await userWallet(deployer.address);
        const res = await jettonMinter.sendMint(deployer.getSender(),
                                                deployer.address,
                                                maxValue,
                                                null, null, null);
        expect(res.transactions).toHaveTransaction({
            on: deployerWallet.address,
            op: Op.internal_transfer,
            success: true,
        });

        const curBalance = await deployerWallet.getJettonBalance();
        expect(curBalance).toEqual(maxValue);
        const smc   = await blockchain.getContract(deployerWallet.address);
        if(smc.accountState === undefined)
            throw new Error("Can't access wallet account state");
        if(smc.accountState.type !== "active")
            throw new Error("Wallet account is not active");
        if(smc.account.account === undefined || smc.account.account === null)
            throw new Error("Can't access wallet account!");
        console.log("Jetton wallet max storage stats:", smc.account.account.storageStats.used);
        const state = smc.accountState.state;
        const stateCell = beginCell().store(storeStateInit(state)).endCell();
        console.log("State init stats:", collectCellStats(stateCell, []));
    });
});

