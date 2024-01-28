import { Blockchain, SandboxContract, TreasuryContract, internal, BlockchainSnapshot, SendMessageResult, defaultConfigSeqno } from '@ton/sandbox';
import { Cell, toNano, beginCell, Address, Transaction, TransactionComputeVm, TransactionStoragePhase, storeAccountStorage, Sender, Dictionary, DictionaryValue } from '@ton/core';
import { JettonWallet } from '../wrappers/JettonWallet';
import { jettonContentToCell, JettonMinter, jettonMinterConfigToCell, JettonMinterContent, LockType } from '../wrappers/JettonMinter';
import '@ton/test-utils';
import {findTransactionRequired} from '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { randomAddress, getRandomTon, differentAddress, getRandomInt, testJettonTransfer, testJettonInternalTransfer, testJettonNotification, testJettonBurnNotification } from './utils';
import { Op, Errors } from '../wrappers/JettonConstants';
import { sha256 } from 'ton-crypto';

/*
   These tests check compliance with the TEP-74 and TEP-89,
   but also checks some implementation details.
   If you want to keep only TEP-74 and TEP-89 compliance tests,
   you need to remove/modify the following tests:
     mint tests (since minting is not covered by standard)
     exit_codes
     prove pathway
*/

//jetton params

let fwd_fee = 1804014n, gas_consumption = 15000000n, min_tons_for_storage = 10000000n;
//let fwd_fee = 1804014n, gas_consumption = 14000000n, min_tons_for_storage = 10000000n;

describe('JettonWallet', () => {
    let jwallet_code_raw = new Cell(); // true code
    let jwallet_code = new Cell();     // library cell with reference to jwallet_code_raw
    let minter_code = new Cell();
    let blockchain: Blockchain;
    let deployer:SandboxContract<TreasuryContract>;
    let notDeployer:SandboxContract<TreasuryContract>;
    let jettonMinter:SandboxContract<JettonMinter>;
    let userWallet: (address: Address) => Promise<SandboxContract<JettonWallet>>;
    let defaultContent: JettonMinterContent;
    let computedGeneric : (trans:Transaction) => TransactionComputeVm;

    let storageGeneric : (trans:Transaction) => TransactionStoragePhase;
    let printTxGasStats: (name: string, trans: Transaction) => bigint;

    class StorageStats {
        bits: bigint;
        cells: bigint;

        constructor(bits?: number | bigint, cells?: number | bigint) {
            this.bits  = bits  !== undefined ? BigInt(bits)  : 0n;
            this.cells = cells !== undefined ? BigInt(cells) : 0n;
        }
        add(...stats: StorageStats[]) {
            let cells = this.cells, bits = this.bits;
            for (let stat of stats) {
                bits  += stat.bits;
                cells += stat.cells;
            }
            return new StorageStats(bits, cells);
        }
        sub(...stats: StorageStats[]) {
            let cells = this.cells, bits = this.bits;
            for (let stat of stats) {
                bits  -= stat.bits;
                cells -= stat.cells;
            }
            return new StorageStats(bits, cells);
        }
        addBits(bits: number | bigint) {
            return new StorageStats(this.bits + BigInt(bits), this.cells);
        }
        subBits(bits: number | bigint) {
            return new StorageStats(this.bits - BigInt(bits), this.cells);
        }
        addCells(cells: number | bigint) {
            return new StorageStats(this.bits, this.cells + BigInt(cells));
        }
        subCells(cells: number | bigint) {
            return new StorageStats(this.bits, this.cells - BigInt(cells));
        }

        toString() : string {
            return JSON.stringify({
                bits: this.bits.toString(),
                cells: this.cells.toString()
            });
        }
    }

    function collectCellStats(cell: Cell, visited:Array<string>, skipRoot: boolean = false): StorageStats {
        let bits  = skipRoot ? 0n : BigInt(cell.bits.length);
        let cells = skipRoot ? 0n : 1n;
        let hash = cell.hash().toString();
        if (visited.includes(hash)) {
            // We should not account for current cell data if visited
            return new StorageStats();
        }
        else {
            visited.push(hash);
        }
        for (let ref of cell.refs) {
            let r = collectCellStats(ref, visited);
            cells += r.cells;
            bits += r.bits;
        }
        return new StorageStats(bits, cells);
    }

    beforeAll(async () => {
        jwallet_code_raw   = await compile('JettonWallet');
        minter_code    = await compile('JettonMinter');
        blockchain     = await Blockchain.create();
        deployer       = await blockchain.treasury('deployer');
        notDeployer    = await blockchain.treasury('notDeployer');
        defaultContent = {
                           uri: 'https://some_stablecoin.org/meta.json'
                       };

        //jwallet_code is library
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${jwallet_code_raw.hash().toString('hex')}`), jwallet_code_raw);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        blockchain.libs = libs;
        let lib_prep = beginCell().storeUint(2,8).storeBuffer(jwallet_code_raw.hash()).endCell();
        jwallet_code = new Cell({ exotic:true, bits: lib_prep.bits, refs:lib_prep.refs});

        console.log('jetton minter code hash = ', minter_code.hash().toString('hex'));
        console.log('jetton wallet code hash = ', jwallet_code.hash().toString('hex'));
        blockchain.now = Math.floor(Date.now() / 1000);

        jettonMinter   = blockchain.openContract(
                   JettonMinter.createFromConfig(
                     {
                       admin: deployer.address,
                       wallet_code: jwallet_code,
                       jetton_content: jettonContentToCell(defaultContent)
                     },
                     minter_code));
        userWallet = async (address:Address) => blockchain.openContract(
                          JettonWallet.createFromAddress(
                            await jettonMinter.getWalletAddress(address)
                          )
                     );

        computedGeneric = (transaction) => {
            if(transaction.description.type !== "generic")
                throw("Expected generic transactionaction");
            if(transaction.description.computePhase.type !== "vm")
                throw("Compute phase expected")
            return transaction.description.computePhase;
        }

        storageGeneric = (transaction) => {
            if(transaction.description.type !== "generic")
                throw("Expected generic transactionaction");
            const storagePhase = transaction.description.storagePhase;
            if(storagePhase  === null || storagePhase === undefined)
                throw("Storage phase expected")
            return storagePhase;
        };

        printTxGasStats = (name, transaction) => {
            const txComputed = computedGeneric(transaction);
            console.log(`${name} used ${txComputed.gasUsed} gas`);
            console.log(`${name} gas cost: ${txComputed.gasFees}`);
            return txComputed.gasUsed;
        }
    });

    // implementation detail
    it('should deploy', async () => {
        const deployResult = await jettonMinter.sendDeploy(deployer.getSender(), toNano('1'));

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
    // implementation detail
    it('minter admin should be able to mint jettons', async () => {
        // can mint from deployer
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = toNano('1000.23');
        const mintResult = await jettonMinter.sendMint(deployer.getSender(), deployer.address, initialJettonBalance, null, null, null, toNano('0.05'), toNano('1'));

        const mintTx = findTransactionRequired(mintResult.transactions, {
            from: jettonMinter.address,
            to: deployerJettonWallet.address,
            deploy: true,
            success: true
        });

        printTxGasStats("Mint transaction:", mintTx);
		/*
		 * No excess in this jetton
        expect(mintResult.transactions).toHaveTransaction({ // excesses
            from: deployerJettonWallet.address,
            to: jettonMinter.address
        });
		*/

        // const jettonSmc = await blockchain.getContract(deployerJettonWallet.address);
        // jettonSmc.setVerbosity({print: true, blockchainLogs: true, vmLogs: 'vm_logs_location', debugLogs: true});
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply + initialJettonBalance);
        initialTotalSupply += initialJettonBalance;
        // can mint from deployer again
        let additionalJettonBalance = toNano('2.31');
        await jettonMinter.sendMint(deployer.getSender(), deployer.address, additionalJettonBalance, null, null, null, toNano('0.05'), toNano('1'));
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance + additionalJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply + additionalJettonBalance);
        initialTotalSupply += additionalJettonBalance;
        // can mint to other address
        let otherJettonBalance = toNano('3.12');
        await jettonMinter.sendMint(deployer.getSender(), notDeployer.address, otherJettonBalance, null, null, null, toNano('0.05'), toNano('1'));
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(otherJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply + otherJettonBalance);
    });

    // implementation detail
    it('not a minter admin should not be able to mint jettons', async () => {
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const unAuthMintResult = await jettonMinter.sendMint(notDeployer.getSender(), deployer.address, toNano('777'), null, null, null, toNano('0.05'), toNano('1'));

        expect(unAuthMintResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: Errors.not_owner, // error::unauthorized_mint_request
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('minter admin can change admin', async () => {
        const adminBefore = await jettonMinter.getAdminAddress();
        expect(adminBefore).toEqualAddress(deployer.address);
        let res = await jettonMinter.sendChangeAdmin(deployer.getSender(), notDeployer.address);
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true
        });

        res = await jettonMinter.sendClaimAdmin(notDeployer.getSender());

        expect(res.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonMinter.address,
            success: true
        });

	const adminAfter = await jettonMinter.getAdminAddress();
        expect(adminAfter).toEqualAddress(notDeployer.address);
        await jettonMinter.sendChangeAdmin(notDeployer.getSender(), deployer.address);
        await jettonMinter.sendClaimAdmin(deployer.getSender());
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
    });
    it('not a minter admin can not change admin', async () => {
        const adminBefore = await jettonMinter.getAdminAddress();
        expect(adminBefore).toEqualAddress(deployer.address);
        let changeAdmin = await jettonMinter.sendChangeAdmin(notDeployer.getSender(), notDeployer.address);
        expect((await jettonMinter.getAdminAddress()).equals(deployer.address)).toBe(true);
        expect(changeAdmin.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: jettonMinter.address,
            aborted: true,
            exitCode: Errors.not_owner, // error::unauthorized_change_admin_request
        });
    });
    it('only address specified in change admin action should be able to claim admin', async () => {
        const adminBefore = await jettonMinter.getAdminAddress();
        expect(adminBefore).toEqualAddress(deployer.address);
        let changeAdmin = await jettonMinter.sendChangeAdmin(deployer.getSender(), notDeployer.address);
        expect(changeAdmin.transactions).toHaveTransaction({
            from: deployer.address,
            on: jettonMinter.address,
            success: true
        });

        // At this point transfer_admin is set to notDeployer.address
        const sneaky = differentAddress(notDeployer.address);
        changeAdmin = await jettonMinter.sendClaimAdmin(blockchain.sender(sneaky));
        expect(changeAdmin.transactions).toHaveTransaction({
            from: sneaky,
            on: jettonMinter.address,
            success: false,
            aborted: true
        });
    });

    describe('Content tests', () => {
        let newContent : JettonMinterContent = {
            uri: `https://some_super_l${Buffer.alloc(200, '0')}ng_stable.org/`
        };
        const snakeString : DictionaryValue<string> = {
            serialize: function (src, builder)  {
                builder.storeUint(0, 8).storeStringTail(src);
            },
            parse: function (src)  {
                let outStr = src.loadStringTail();
                if(outStr.charCodeAt(0) !== 0) {
                    throw new Error("No snake prefix");
                }
                return outStr.substr(1);
            }
        };
        const loadContent = (data: Cell) => {
            const ds = data.beginParse();
            expect(ds.loadUint(8)).toEqual(0);
            const content = ds.loadDict(Dictionary.Keys.Buffer(32), snakeString);;
            expect(ds.remainingBits == 0 && ds.remainingRefs == 0).toBe(true);
            return content;
        }

        it('minter admin can change content', async () => {
            const oldContent = loadContent(await jettonMinter.getContent());
            // console.log(Buffer.from(oldContent.get(await sha256('uri'))!));
            expect(oldContent.get(await sha256('uri'))! === defaultContent.uri).toBe(true);
            expect(oldContent.get(await sha256('decimals'))! === "9").toBe(true);
            let changeContent = await jettonMinter.sendChangeContent(deployer.getSender(), newContent);
            expect(changeContent.transactions).toHaveTransaction({
                on: jettonMinter.address,
                from: deployer.address,
                op: Op.change_metadata_url,
                success: true
            });
            let contentUpd  = loadContent(await jettonMinter.getContent());
            expect(contentUpd.get(await sha256('uri'))! == newContent.uri).toBe(true);
            // Update back;
            changeContent = await jettonMinter.sendChangeContent(deployer.getSender(), defaultContent);
            contentUpd  = loadContent(await jettonMinter.getContent());
            expect(oldContent.get(await sha256('uri'))! === defaultContent.uri).toBe(true);
            expect(oldContent.get(await sha256('decimals'))! === "9").toBe(true);
        });
        it('not a minter admin can not change content', async () => {
            const oldContent = loadContent(await jettonMinter.getContent());
            let changeContent = await jettonMinter.sendChangeContent(notDeployer.getSender(), newContent);
            expect(oldContent.get(await sha256('uri'))).toEqual(defaultContent.uri);
            expect(oldContent.get(await sha256('decimals'))).toEqual("9");

            expect(changeContent.transactions).toHaveTransaction({
                from: notDeployer.address,
                to: jettonMinter.address,
                aborted: true,
                exitCode: Errors.not_owner,
            });
        });
    });

    it('storage stats', async() => {
        const prev = blockchain.snapshot();

        const deployerJettonWallet = await userWallet(deployer.address);
        const smc = await blockchain.getContract(deployerJettonWallet.address);
        const stats = collectCellStats(beginCell().store(storeAccountStorage(smc.account.account!.storage)).endCell(), []);
        console.log("Jetton wallet storage stats:", stats);
        blockchain.now =  blockchain.now! + 5 * 365 * 24 * 3600;
        const res = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('1'), 0n, null, null);
        const storagePhase = storageGeneric(res.transactions[1]);
        console.log("Storage fees:", storagePhase.storageFeesCollected);

        await blockchain.loadFrom(prev);
    });
    it('wallet owner should be able to send jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        const balanceBefore = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.17'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, null);
        //console.log(sendResult.transactions[1].vmLogs);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            on : deployer.address,
            from: notDeployerJettonWallet.address,
            op: Op.excesses,
            success: true
        });

        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount
        });

        const balanceAfter = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;
        // Make sure we're not draining balance
        expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore);
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });


    it('not wallet owner should not be able to send jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply = await jettonMinter.getTotalSupply();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        const sendResult = await deployerJettonWallet.sendTransfer(notDeployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, toNano('0.05'), null);
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: Errors.not_owner, //error::unauthorized_transfer
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('impossible to send too much jettons', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = initialJettonBalance + 1n;
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: Errors.balance_error, //error::not_enough_jettons
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2);
    });

    describe('Malformed transfer', () => {
        let sendTransferPayload: (from: Address, to: Address, payload: Cell) => Promise<SendMessageResult>;
        let assertFailTransfer: <T extends Transaction> (from: Address, to: Address, txs: Array<T>, codes: Array<number>) => void;
        beforeAll(() => {
            sendTransferPayload = async (from, to, payload) => {
                return await blockchain.sendMessage(internal({
                    from,
                    to,
                    body: payload,
                    value: toNano('1')
                }));
            };
            assertFailTransfer = (from, to, txs, codes) => {
                expect(txs).toHaveTransaction({
                    on: to,
                    from,
                    aborted: true,
                    success: false,
                    exitCode: (c) => codes.includes(c!)
                });
                expect(txs).not.toHaveTransaction({
                    from: to,
                    op: Op.internal_transfer
                });
            }
        });
        it('malfored custom payload', async () => {
            const deployerJettonWallet    = await userWallet(deployer.address);
            const notDeployerJettonWallet = await userWallet(notDeployer.address);

            let sentAmount     = toNano('0.5');
            let forwardPayload = beginCell().storeUint(getRandomInt(100000, 200000), 128).endCell();
            let customPayload  = beginCell().storeUint(getRandomInt(100000, 200000), 128).endCell();

            let forwardTail    = beginCell().storeCoins(toNano('0.05')).storeMaybeRef(forwardPayload);
            const msgTemplate  = beginCell().storeUint(0xf8a7ea5, 32).storeUint(0, 64) // op, queryId
                                            .storeCoins(sentAmount).storeAddress(notDeployer.address)
                                            .storeAddress(deployer.address)
            let testPayload  = beginCell()
                                .storeBuilder(msgTemplate)
                                .storeBit(true)
                                .storeBuilder(forwardTail)
                               .endCell();

            let errCodes = [9, Errors.invalid_mesage];
            let res = await sendTransferPayload(deployer.address,
                                                deployerJettonWallet.address, 
                                                testPayload);
            assertFailTransfer(deployer.address, deployerJettonWallet.address,
                       res.transactions, errCodes);

            testPayload = beginCell()
                             .storeBuilder(msgTemplate)
                             .storeBit(false)
                             .storeRef(customPayload)
                             .storeBuilder(forwardTail)
                           .endCell();
            res = await sendTransferPayload(deployer.address,
                                            deployerJettonWallet.address, 
                                            testPayload);
            assertFailTransfer(deployer.address, deployerJettonWallet.address,
                       res.transactions, errCodes);
            // Now self test that we didnt screw the payloads ourselves
            testPayload = beginCell()
                             .storeBuilder(msgTemplate)
                             .storeBit(true)
                             .storeRef(customPayload)
                             .storeBuilder(forwardTail)
                           .endCell();

            res = await sendTransferPayload(deployer.address,
                                            deployerJettonWallet.address, 
                                            testPayload);

            expect(res.transactions).toHaveTransaction({
                on: deployerJettonWallet.address,
                from: deployer.address,
                op: Op.transfer,
                success: true
            });
        });
        it('malformed forward payload', async() => {

            const deployerJettonWallet    = await userWallet(deployer.address);
            const notDeployerJettonWallet = await userWallet(notDeployer.address);

            let sentAmount     = toNano('0.5');
            let forwardAmount  = getRandomTon(0.01, 0.05); // toNano('0.05');
            let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
            let msgTemplate    = beginCell().storeUint(0xf8a7ea5, 32).storeUint(0, 64) // op, queryId
                                            .storeCoins(sentAmount).storeAddress(notDeployer.address)
                                            .storeAddress(deployer.address)
                                            .storeMaybeRef(null)
                                            .storeCoins(toNano('0.05')) // No forward payload indication
            let errCodes = [9, Errors.invalid_mesage];
            let res = await sendTransferPayload(deployer.address,
                                                deployerJettonWallet.address, msgTemplate.endCell());

            assertFailTransfer(deployer.address, deployerJettonWallet.address,
                               res.transactions,errCodes);

            // Now test that we can't send message without payload if either flag is set
            let testPayload = beginCell().storeBuilder(msgTemplate).storeBit(true).endCell();
            res =  await sendTransferPayload(deployer.address,
                                             deployerJettonWallet.address, testPayload);

            assertFailTransfer(deployer.address, deployerJettonWallet.address,
                               res.transactions,errCodes);
            // Now valid payload
            testPayload = beginCell().storeBuilder(msgTemplate).storeBit(true).storeRef(forwardPayload).endCell();

            res =  await sendTransferPayload(deployer.address,
                                             deployerJettonWallet.address, testPayload);

            expect(res.transactions).toHaveTransaction({
                from: deployer.address,
                to: deployerJettonWallet.address,
                op: Op.transfer,
                success: true,
            });
        });
    });

    it('correctly sends forward_payload', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        // Let's use this case for fees calculation
        // Put the forward payload into custom payload, to make sure maximum possible gas used during computation
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.17'), //tons
               sentAmount, notDeployer.address,
               deployer.address, forwardPayload, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        });
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount,
            body: beginCell().storeUint(Op.transfer_notification, 32).storeUint(0, 64) //default queryId
                              .storeCoins(sentAmount)
                              .storeAddress(deployer.address)
                              .storeUint(1, 1)
                              .storeRef(forwardPayload)
                  .endCell()
        });
        const transferTx = findTransactionRequired(sendResult.transactions, {
            on: deployerJettonWallet.address,
            from: deployer.address,
            op: Op.transfer,
            success: true
        });
        printTxGasStats("Jetton transfer", transferTx);

        const receiveTx = findTransactionRequired(sendResult.transactions, {
            on: notDeployerJettonWallet.address,
            from: deployerJettonWallet.address,
            op: Op.internal_transfer,
            success: true
        });
        printTxGasStats("Receive jetton", receiveTx);

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
    });

    it('no forward_ton_amount - no forward', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = 0n;
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        });

        expect(sendResult.transactions).not.toHaveTransaction({ //no notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
    });

    it('check revert on not enough tons for forward', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let sentAmount = toNano('0.1');
        let forwardAmount = toNano('0.3');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), forwardAmount, // not enough tons, no tons for gas
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: deployerJettonWallet.address,
            aborted: true,
            exitCode: Errors.not_enough_gas, //error::not_enough_tons
        });
        // Make sure value bounced
        expect(sendResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            on: deployer.address,
            inMessageBounced: true,
            success: true
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
    });

    // implementation detail
    it.skip('works with minimal ton amount', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const someAddress = Address.parse("EQD__________________________________________0vo");
        const someJettonWallet = await userWallet(someAddress);
        let initialJettonBalance2 = await someJettonWallet.getJettonBalance();
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let forwardAmount = toNano('0.3');
        /*
                     forward_ton_amount +
                     fwd_count * fwd_fee +
                     (2 * gas_consumption + min_tons_for_storage));
        */
        let minimalFee = 2n* fwd_fee + 2n*gas_consumption + min_tons_for_storage;
        let sentAmount = forwardAmount + minimalFee; // not enough, need >
        let forwardPayload = null;
        let tonBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let tonBalance2 = (await blockchain.getContract(someJettonWallet.address)).balance;
        let sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), sentAmount,
               sentAmount, someAddress,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: Errors.not_enough_gas, //error::not_enough_tons
        });
        sentAmount += 1n; // now enough
        sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), sentAmount,
               sentAmount, someAddress,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).not.toHaveTransaction({ //no excesses
            from: someJettonWallet.address,
            to: deployer.address,
        });
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: someJettonWallet.address,
            to: someAddress,
            value: forwardAmount,
            body: beginCell().storeUint(Op.transfer_notification, 32).storeUint(0, 64) //default queryId
                              .storeCoins(sentAmount)
                              .storeAddress(deployer.address)
                              .storeUint(0, 1)
                  .endCell()
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await someJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);

        tonBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        expect((await blockchain.getContract(someJettonWallet.address)).balance).toBeGreaterThan(min_tons_for_storage);
    });

    // implementation detail
    it('wallet does not accept internal_transfer not from wallet', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
/*
  internal_transfer  query_id:uint64 amount:(VarUInteger 16) from:MsgAddress
                     response_address:MsgAddress
                     forward_ton_amount:(VarUInteger 16)
                     forward_payload:(Either Cell ^Cell)
                     = InternalMsgBody;
*/
        let internalTransfer = beginCell().storeUint(0x178d4519, 32).storeUint(0, 64) //default queryId
                              .storeCoins(toNano('0.01'))
                              .storeAddress(deployer.address)
                              .storeAddress(deployer.address)
                              .storeCoins(toNano('0.05'))
                              .storeUint(0, 1)
                  .endCell();
        const sendResult = await blockchain.sendMessage(internal({
                    from: notDeployer.address,
                    to: deployerJettonWallet.address,
                    body: internalTransfer,
                    value:toNano('0.3')
                }));
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: Errors.not_valid_wallet, //error::unauthorized_incoming_transfer
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
    });

    it('wallet owner should be able to burn jettons', async () => {
           const deployerJettonWallet = await userWallet(deployer.address);
            let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
            let initialTotalSupply = await jettonMinter.getTotalSupply();
            let burnAmount = toNano('0.01');
            const sendResult = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                                 burnAmount, deployer.address, null); // amount, response address, custom payload
            const burnReqTx  = findTransactionRequired(sendResult.transactions, {
                on: deployerJettonWallet.address,
                from: deployer.address,
                op: Op.burn,
                success: true
            });

            printTxGasStats("Burn send transaction", burnReqTx);

            const notificationTx = findTransactionRequired(sendResult.transactions, { //burn notification
                from: deployerJettonWallet.address,
                to: jettonMinter.address,
                op: Op.burn_notification,
                success: true
            });
            printTxGasStats("Burn notification transaction", notificationTx);

            expect(sendResult.transactions).toHaveTransaction({ //excesses
                from: jettonMinter.address,
                to: deployer.address,
                op: Op.excesses
            });
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - burnAmount);
            expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount);

    });

    it('not wallet owner should not be able to burn jettons', async () => {
              const deployerJettonWallet = await userWallet(deployer.address);
              let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
              let initialTotalSupply = await jettonMinter.getTotalSupply();
              let burnAmount = toNano('0.01');
              const sendResult = await deployerJettonWallet.sendBurn(notDeployer.getSender(), toNano('0.1'), // ton amount
                                    burnAmount, deployer.address, null); // amount, response address, custom payload
              expect(sendResult.transactions).toHaveTransaction({
                 from: notDeployer.address,
                 to: deployerJettonWallet.address,
                 aborted: true,
                 exitCode: Errors.not_owner, //error::unauthorized_transfer
                });
              expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
              expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('wallet owner can not burn more jettons than it has', async () => {
                const deployerJettonWallet = await userWallet(deployer.address);
                let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
                let initialTotalSupply = await jettonMinter.getTotalSupply();
                let burnAmount = initialJettonBalance + 1n;
                const sendResult = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                                        burnAmount, deployer.address, null); // amount, response address, custom payload
                expect(sendResult.transactions).toHaveTransaction({
                     from: deployer.address,
                     to: deployerJettonWallet.address,
                     aborted: true,
                     exitCode: Errors.balance_error, //error::not_enough_jettons
                    });
                expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance);
                expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it.skip('minimal burn message fee', async () => {
       const deployerJettonWallet = await userWallet(deployer.address);
       let initialJettonBalance   = await deployerJettonWallet.getJettonBalance();
       let initialTotalSupply     = await jettonMinter.getTotalSupply();
       let burnAmount   = toNano('0.01');
       let fwd_fee      = 1492012n /*1500012n*/, gas_consumption = 15000000n;
       let minimalFee   = fwd_fee + 2n*gas_consumption;

       const sendLow    = await deployerJettonWallet.sendBurn(deployer.getSender(), minimalFee, // ton amount
                            burnAmount, deployer.address, null); // amount, response address, custom payload

       expect(sendLow.transactions).toHaveTransaction({
                from: deployer.address,
                to: deployerJettonWallet.address,
                aborted: true,
                exitCode: Errors.not_enough_gas, //error::burn_fee_not_matched
             });

        const sendExcess = await deployerJettonWallet.sendBurn(deployer.getSender(), minimalFee + 1n,
                                                                      burnAmount, deployer.address, null);

        expect(sendExcess.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerJettonWallet.address,
            success: true
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - burnAmount);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount);

    });

    it('minter should only accept burn messages from jetton wallets', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        const burnAmount = toNano('1');
        const burnNotification = (amount: bigint, addr: Address) => {
        return beginCell()
                .storeUint(Op.burn_notification, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeAddress(addr)
                .storeAddress(deployer.address)
               .endCell();
        }

        let res = await blockchain.sendMessage(internal({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            body: burnNotification(burnAmount, randomAddress(0)),
            value: toNano('0.1')
        }));

        expect(res.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: Errors.not_valid_wallet// Unauthorized burn
        });

        res = await blockchain.sendMessage(internal({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            body: burnNotification(burnAmount, deployer.address),
            value: toNano('0.1')
        }));

        expect(res.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            success: true
        });
   });

    // TEP-89
    it('report correct discovery address', async () => {
        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), deployer.address, true);
        /*
          take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress) = InternalMsgBody;
        */
        const deployerJettonWallet = await userWallet(deployer.address);

        const discoveryTx = findTransactionRequired(discoveryResult.transactions, {
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                              .storeAddress(deployerJettonWallet.address)
                              .storeUint(1, 1)
                              .storeRef(beginCell().storeAddress(deployer.address).endCell())
                  .endCell()
        });

        printTxGasStats("Discovery transaction", discoveryTx);

        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), notDeployer.address, true);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                              .storeAddress(notDeployerJettonWallet.address)
                              .storeUint(1, 1)
                              .storeRef(beginCell().storeAddress(notDeployer.address).endCell())
                  .endCell()
        });

        // do not include owner address
        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), notDeployer.address, false);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                              .storeAddress(notDeployerJettonWallet.address)
                              .storeUint(0, 1)
                  .endCell()
        });

    });

    it.skip('Minimal discovery fee', async () => {
       // 5000 gas-units + msg_forward_prices.lump_price + msg_forward_prices.cell_price = 0.0061
        const fwdFee     = 1464012n;
        const minimalFee = fwdFee + 10000000n; // toNano('0.0061');

        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                                      notDeployer.address,
                                                                      false,
                                                                      minimalFee);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: Errors.discovery_fee_not_matched // discovery_fee_not_matched
        });

        /*
         * Might be helpfull to have logical OR in expect lookup
         * Because here is what is stated in standard:
         * and either throw an exception if amount of incoming value is not enough to calculate wallet address
         * or response with message (sent with mode 64)
         * https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md
         * At least something like
         * expect(discoveryResult.hasTransaction({such and such}) ||
         * discoveryResult.hasTransaction({yada yada})).toBeTruethy()
         */
        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                           notDeployer.address,
                                                           false,
                                                           minimalFee + 1n);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            success: true
        });

    });

    it('Correctly handles not valid address in discovery', async () =>{
        const badAddr       = randomAddress(-1);
        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                               badAddr,
                                                               false);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                             .storeUint(0, 2) // addr_none
                             .storeUint(0, 1)
                  .endCell()

        });

        // Include address should still be available

        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
                                                           badAddr,
                                                           true); // Include addr

        expect(discoveryResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                             .storeUint(0, 2) // addr_none
                             .storeUint(1, 1)
                             .storeRef(beginCell().storeAddress(badAddr).endCell())
                  .endCell()

        });
    });

    // This test consume a lot of time: 18 sec
    // and is needed only for measuring ton accruing
    /*it('jettonWallet can process 250 transfer', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerJettonWallet.getJettonBalance();
        let sentAmount = 1n, count = 250n;
        let forwardAmount = toNano('0.05');
        let sendResult: any;
        let payload = beginCell()
                          .storeUint(0x12345678, 32).storeUint(0x87654321, 32)
                          .storeRef(beginCell().storeUint(0x12345678, 32).storeUint(0x87654321, 108).endCell())
                          .storeRef(beginCell().storeUint(0x12345671, 32).storeUint(0x87654321, 240).endCell())
                          .storeRef(beginCell().storeUint(0x12345672, 32).storeUint(0x87654321, 77)
                                               .storeRef(beginCell().endCell())
                                               .storeRef(beginCell().storeUint(0x1245671, 91).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x2245671, 180).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x8245671, 255).storeUint(0x87654321, 32).endCell())
                                    .endCell())
                      .endCell();
        let initialBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let initialBalance2 = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;
        for(let i = 0; i < count; i++) {
            sendResult = await deployerJettonWallet.sendTransferMessage(deployer.getSender(), toNano('0.1'), //tons
                   sentAmount, notDeployer.address,
                   deployer.address, null, forwardAmount, payload);
        }
        // last chain was successful
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerJettonWallet.address,
            to: deployer.address,
        });
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerJettonWallet.address,
            to: notDeployer.address,
            value: forwardAmount
        });

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount*count);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount*count);

        let finalBalance =(await blockchain.getContract(deployerJettonWallet.address)).balance;
        let finalBalance2 = (await blockchain.getContract(notDeployerJettonWallet.address)).balance;

        // if it is not true, it's ok but gas_consumption constant is too high
        // and excesses of TONs will be accrued on wallet
        expect(finalBalance).toBeLessThan(initialBalance + toNano('0.001'));
        expect(finalBalance2).toBeLessThan(initialBalance2 + toNano('0.001'));
        expect(finalBalance).toBeGreaterThan(initialBalance - toNano('0.001'));
        expect(finalBalance2).toBeGreaterThan(initialBalance2 - toNano('0.001'));

    });
    */
    // implementation detail
    it('can not send to masterchain', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, Address.parse("Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU"),
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: deployer.address,
            to: deployerJettonWallet.address,
            aborted: true,
            exitCode: Errors.wrong_workchain //error::wrong_workchain
        });
    });

    describe('Locking', () => {
    let prevState : BlockchainSnapshot;
    let testLockable : (from: Sender, addr: Address, exp: boolean ) => Promise<void>;
    let testUnlockable: (from: Sender, addr: Address, exp: boolean) => Promise<void>;
    let testCap: (lock: Array<LockType>, addr: Address, cb: () => Promise<void>) => Promise<void>;

    beforeAll( () => {
        prevState = blockchain.snapshot();
        testLockable = async (from, addr, exp) => {
            const lockTypes : Array<LockType>  = ['out', 'in', 'full'];
            const lockWallet = await userWallet(addr);
            let i = 0;

            for (let type of lockTypes) {
                let res = await jettonMinter.sendLockWallet(from, addr, type);
                let status = await lockWallet.getWalletStatus();
                expect(Boolean(status & (++i))).toBe(exp);
            }
        };
        testCap = async (locks, addr, cb) => {
            const lockTypes : Array<LockType>  = ['unlock', 'out', 'in', 'full'];
            const lockWallet = await userWallet(addr);

            for (let mode of locks) {
                let res = await jettonMinter.sendLockWallet(deployer.getSender(), addr, mode);
                expect(await lockWallet.getWalletStatus()).toEqual(lockTypes.findIndex(t => t == mode));
                await cb();
            }

        }
        testUnlockable = async (from, addr, exp) => {
            // Meh
            const lockTypes : Array<LockType>  = ['out', 'in', 'full'];
            const lockWallet = await userWallet(addr);
            const statusBefore = await lockWallet.getWalletStatus();
            if(statusBefore == 0) {
                await jettonMinter.sendLockWallet(deployer.getSender(), addr, 'unlock');
                expect(await lockWallet.getWalletStatus()).toEqual(0);
            }

            let i = 0;

            for (let type of lockTypes) {
                let res = await jettonMinter.sendLockWallet(deployer.getSender(), addr, type);
                expect((await lockWallet.getWalletStatus())).toEqual(++i);
                // Now try unlock from that state
                res = await jettonMinter.sendLockWallet(from, addr, 'unlock');
                if(exp) {
                    expect(await lockWallet.getWalletStatus()).toEqual(0);
                }
                else {
                    expect(await lockWallet.getWalletStatus()).not.toEqual(0);
                }
            }
        }
    });
    afterEach( async () => await blockchain.loadFrom(prevState));
    it('admin should be able to lock arbitrary jetton wallet', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        const msgValue = getRandomTon(1, 2);
        const statusBefore = await deployerJettonWallet.getWalletStatus();

        expect(statusBefore).toEqual(0);

        await testLockable(deployer.getSender(), deployer.address, true);

    });
    it('not admin should not be able to lock or unlock wallet', async() => {
        const deployerJettonWallet = await userWallet(deployer.address);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        const msgValue = getRandomTon(1, 2);
        const statusBefore = await deployerJettonWallet.getWalletStatus();
        expect(statusBefore).toEqual(0);
        // Can't lock
        await testLockable(notDeployer.getSender(), notDeployer.address, false);

        // Can't unlock
        await testUnlockable(notDeployer.getSender(), deployer.address, false);
    });
    it('out and full locked wallet should not be able to send tokens', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        await testCap(['out', 'full'], deployer.address, async () => {
            const balanceBefore = await deployerJettonWallet.getJettonBalance();
            const res = await deployerJettonWallet.sendTransfer(deployer.getSender(),
                                                                toNano('1'), // value
                                                                1n, // jetton_amount
                                                                notDeployer.address, // to
                                                                deployer.address, // response_address
                                                                null, // custom payload
                                                                0n, // forward_ton_amount
                                                                null);
            expect(res.transactions).toHaveTransaction({
                on: deployerJettonWallet.address,
                from: deployer.address,
                op: Op.transfer,
                success: false,
                aborted: true,
                exitCode: Errors.contract_locked
            });
            expect(res.transactions).not.toHaveTransaction({
                from: deployerJettonWallet.address,
                op: Op.transfer_notification
            });
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore)
        });
    });
    it('out and full locked wallet should not be able to burn tokens', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        const statusBefore = await deployerJettonWallet.getWalletStatus();

        await testCap(['out', 'full'], deployer.address, async () => {

            const balanceBefore = await deployerJettonWallet.getJettonBalance();

            const res = await deployerJettonWallet.sendBurn(deployer.getSender(), toNano('1'), 1n, deployer.address, null);

            expect(res.transactions).toHaveTransaction({
                on: deployerJettonWallet.address,
                from: deployer.address,
                op: Op.burn,
                success: false,
                aborted: true,
                exitCode: Errors.contract_locked
            });
            expect(res.transactions).not.toHaveTransaction({
                from: deployerJettonWallet.address,
                op: Op.burn_notification
            });

            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore)
        });
    });
    it('out locked wallet should be able to receive jettons', async () => {
        const deployerJettonWallet    = await userWallet(deployer.address);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);

        await jettonMinter.sendLockWallet(deployer.getSender(), notDeployer.address, 'out');
        expect(await notDeployerJettonWallet.getWalletStatus()).toEqual(1);

        const balanceBefore = await notDeployerJettonWallet.getJettonBalance();

        await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('1'), 1n,
                                                notDeployer.address, deployer.address,
                                                null, toNano('0.05'), null);
        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(balanceBefore + 1n);
    });
    it('in and full locked wallet should not be able to receive jettons', async () => {
        const deployerJettonWallet    = await userWallet(deployer.address);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        await testCap(['in','full'], notDeployer.address, async () => {
            const balanceBefore  = await notDeployerJettonWallet.getJettonBalance();
            const deployerBefore = await deployerJettonWallet.getJettonBalance(); 

            let res = await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('1'), 1n,
                                                notDeployer.address, deployer.address,
                                                null, toNano('0.05'), null);
            expect(res.transactions).toHaveTransaction({
                on: notDeployerJettonWallet.address,
                op: Op.internal_transfer,
                success: false,
                exitCode: Errors.contract_locked
            });
            // Bonus check that deployer didn't loose any balance due to bounce
            expect(res.transactions).toHaveTransaction({
                on: deployerJettonWallet.address,
                from: notDeployerJettonWallet.address,
                inMessageBounced: true
            });
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(deployerBefore);
            // Main check
            expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(balanceBefore);
        });
    })
    it('admin should be able to unlock locked wallet', async () => {
        await testUnlockable(deployer.getSender(), deployer.address, true);
        await testUnlockable(deployer.getSender(), notDeployer.address, true);
    });
    describe('Force transfer', () => {

    let prevState : BlockchainSnapshot;
    beforeAll( () => prevState = blockchain.snapshot());
    afterAll( async () => await blockchain.loadFrom(prevState));

    it('admin should be able to force jetton transfer', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        const msgValue = getRandomTon(10, 20);
        const fwdAmount = msgValue / 2n;
        const txAmount = BigInt(getRandomInt(1, 100));
        const customPayload = beginCell().storeUint(getRandomInt(1000, 2000), 32).endCell();
        const fwdPayload = beginCell().storeUint(getRandomInt(1000, 2000), 32).endCell();
        const balanceBefore = await deployerJettonWallet.getJettonBalance();

        const res = await jettonMinter.sendForceTransfer(deployer.getSender(),
                                                         txAmount,
                                                         deployer.address,
                                                         notDeployer.address,
                                                         customPayload,
                                                         fwdAmount,
                                                         fwdPayload,
                                                         msgValue);
        // Transfer request was sent to notDeployer wallet and was processed
        expect(res.transactions).toHaveTransaction({
            from: jettonMinter.address,
            on: notDeployerJettonWallet.address,
            op: Op.transfer,
            body: (x) => testJettonTransfer(x!, {
                to: deployer.address,
                response_address: deployer.address,
                amount: txAmount,
                forward_amount: fwdAmount,
                custom_payload: customPayload,
                forward_payload: fwdPayload
            }),
            success: true,
            value: msgValue
        });
        expect(res.transactions).toHaveTransaction({
            from: notDeployerJettonWallet.address,
            on: deployerJettonWallet.address,
            op: Op.internal_transfer,
            body: (x) => testJettonInternalTransfer(x!, {
                from: notDeployer.address,
                response: deployer.address,
                amount: txAmount,
                forwardAmount: fwdAmount,
                payload: fwdPayload
            }),
            success: true,
        });
        expect(res.transactions).toHaveTransaction({
            on: deployer.address,
            from: deployerJettonWallet.address,
            op: Op.transfer_notification,
            body: (x) => testJettonNotification(x!, {
                amount: txAmount,
                from: notDeployer.address,
                payload: fwdPayload
            }),
            value: fwdAmount,
            success: true
        });
        expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore + txAmount);
    });
    it('not admin should not be able to force transfer', async () => {

        const txAmount = BigInt(getRandomInt(1, 100));

        let res = await jettonMinter.sendForceTransfer(notDeployer.getSender(),
                                                       txAmount,
                                                       notDeployer.address, // To
                                                       deployer.address, // From
                                                       null,
                                                       toNano('0.25'),
                                                       null,
                                                       toNano('1'));
        expect(res.transactions).toHaveTransaction({
            on: jettonMinter.address,
            from: notDeployer.address,
            op: Op.call_to,
            success: false,
            aborted: true,
            exitCode: Errors.not_owner
        });
        expect(res.transactions).not.toHaveTransaction({
            from: jettonMinter.address,
            op: Op.transfer
        });
    });
    it('admin should be able to force transfer even locked jettons', async () => {
        const deployerJettonWallet    = await userWallet(deployer.address);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        const txAmount      = BigInt(getRandomInt(1, 100));

        await testCap(['in','out','full'], notDeployer.address, async () => {
        const balanceBefore = await deployerJettonWallet.getJettonBalance();
            const res = await jettonMinter.sendForceTransfer(deployer.getSender(),
                                                             txAmount,
                                                             deployer.address, // To
                                                             notDeployer.address, // From
                                                             null,
                                                             toNano('0.15'),
                                                             null,
                                                             toNano('1'));
            expect(res.transactions).not.toHaveTransaction({
                on: notDeployerJettonWallet.address,
                from: jettonMinter.address,
                op: Op.transfer,
                exitCode: Errors.contract_locked
            });
            expect(res.transactions).toHaveTransaction({
                on: deployer.address,
                from: deployerJettonWallet.address,
                op: Op.transfer_notification,
                body: (x) => testJettonNotification(x!, {
                    amount: txAmount,
                    from: notDeployer.address,
                }),
            });
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore + txAmount);
        });
    });
    });
    describe('Force burn', () => {
    let prevState : BlockchainSnapshot;
    beforeAll( () => prevState = blockchain.snapshot());
    afterAll( async () => await blockchain.loadFrom(prevState));

    it('admin should be able to force burn jettons in arbitrary wallet', async () => {
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        const msgValue   = getRandomTon(10, 20);
        const burnAmount = BigInt(getRandomInt(1, 100));

        const balanceBefore = await notDeployerJettonWallet.getJettonBalance();
        const supplyBefore  = await jettonMinter.getTotalSupply();

        const res = await jettonMinter.sendForceBurn(deployer.getSender(), burnAmount, notDeployer.address, deployer.address, msgValue);
        expect(res.transactions).toHaveTransaction({
            on: notDeployerJettonWallet.address,
            from: jettonMinter.address,
            op: Op.burn,
            value: msgValue,
            success: true,
        });
        expect(res.transactions).toHaveTransaction({
            on: jettonMinter.address,
            from: notDeployerJettonWallet.address,
            op: Op.burn_notification,
            body: (x) => testJettonBurnNotification(x!, {
                amount: burnAmount,
                response_address: deployer.address
            })
        });
        expect(res.transactions).toHaveTransaction({
            on: deployer.address,
            from: jettonMinter.address,
            op: Op.excesses,
            success: true
        });

        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(balanceBefore - burnAmount);
        expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore - burnAmount);
    });
    it('not admin should not be able to force burn', async () => {
        const deployerJettonWallet    = await userWallet(deployer.address);
        const notDeployerJettonWallet = await userWallet(notDeployer.address);


        const msgValue   = getRandomTon(10, 20);
        const burnAmount = BigInt(getRandomInt(1, 100));

        const balanceBefore = await notDeployerJettonWallet.getJettonBalance();
        const supplyBefore  = await jettonMinter.getTotalSupply();

        const res = await jettonMinter.sendForceBurn(notDeployer.getSender(), burnAmount, notDeployer.address, deployer.address, msgValue);

        expect(res.transactions).toHaveTransaction({
            on: jettonMinter.address,
            from: notDeployer.address,
            op: Op.call_to,
            success: false,
            aborted: true
        });
        expect(res.transactions).not.toHaveTransaction({
            from: jettonMinter.address,
            op: Op.burn
        });

        expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(balanceBefore);
        expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore);
    });

    it('admin should be able to force burn even on locked wallet', async () => {
        const notDeployerJettonWallet = await userWallet(notDeployer.address);
        const burnAmount = BigInt(getRandomInt(1, 100));
        await testCap(['in','out','full'], notDeployer.address, async () => {
            const balanceBefore = await notDeployerJettonWallet.getJettonBalance();
            const supplyBefore  = await jettonMinter.getTotalSupply();
            const msgValue   = getRandomTon(10, 20);


            const res = await jettonMinter.sendForceBurn(deployer.getSender(), burnAmount, notDeployer.address, deployer.address, msgValue);

            expect(res.transactions).toHaveTransaction({
                on: notDeployerJettonWallet.address,
                from: jettonMinter.address,
                op: Op.burn,
                success: true
            });

            expect(await notDeployerJettonWallet.getJettonBalance()).toEqual(balanceBefore - burnAmount);
            expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore - burnAmount);
        });

    });
    });
    });
    describe('Bounces', () => {
        it('minter should restore supply on internal_transfer bounce', async () => {
            const deployerJettonWallet    = await userWallet(deployer.address);
            const mintAmount = BigInt(getRandomInt(1000, 2000));
            const mintMsg    = JettonMinter.mintMessage(deployer.address, mintAmount, null, null, null, toNano('0.1'), toNano('0.1'));

            const supplyBefore = await jettonMinter.getTotalSupply();
            const minterSmc = await blockchain.getContract(jettonMinter.address);

            // Sending message but only processing first step of tx chain
            let res = minterSmc.receiveMessage(internal({
                from: deployer.address,
                to: jettonMinter.address,
                body: mintMsg,
                value: toNano('1')
            }));

            expect(res.outMessagesCount).toEqual(1);
            const outMsgSc = res.outMessages.get(0)!.body.beginParse();
            expect(outMsgSc.preloadUint(32)).toEqual(Op.internal_transfer);

            expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore + mintAmount);

            minterSmc.receiveMessage(internal({
                from: deployerJettonWallet.address,
                to: jettonMinter.address,
                bounced: true,
                body: beginCell().storeUint(0xFFFFFFFF, 32).storeSlice(outMsgSc).endCell(),
                value: toNano('0.95')
            }));

            // Supply should change back
            expect(await jettonMinter.getTotalSupply()).toEqual(supplyBefore);
        });
        it('wallet should restore balance on internal_transfer bounce', async () => {
            const deployerJettonWallet    = await userWallet(deployer.address);
            const notDeployerJettonWallet = await userWallet(notDeployer.address);
            const balanceBefore           = await deployerJettonWallet.getJettonBalance();
            const txAmount = BigInt(getRandomInt(100, 200));
            const transferMsg = JettonWallet.transferMessage(txAmount, notDeployer.address, deployer.address, null, 0n, null);

            const walletSmc = await blockchain.getContract(deployerJettonWallet.address);

            const res = walletSmc.receiveMessage(internal({
                from: deployer.address,
                to: deployerJettonWallet.address,
                body: transferMsg,
                value: toNano('1')
            }));

            expect(res.outMessagesCount).toEqual(1);

            const outMsgSc = res.outMessages.get(0)!.body.beginParse();
            expect(outMsgSc.preloadUint(32)).toEqual(Op.internal_transfer);

            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore - txAmount);

            walletSmc.receiveMessage(internal({
                from: notDeployerJettonWallet.address,
                to: walletSmc.address,
                bounced: true,
                body: beginCell().storeUint(0xFFFFFFFF, 32).storeSlice(outMsgSc).endCell(),
                value: toNano('0.95')
            }));

            // Balance should roll back
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore);
        });
        it('wallet should restore balance on burn_notification bounce', async () => {
            const deployerJettonWallet = await userWallet(deployer.address);
            const balanceBefore        = await deployerJettonWallet.getJettonBalance();
            const burnAmount = BigInt(getRandomInt(100, 200));

            const burnMsg = JettonWallet.burnMessage(burnAmount, deployer.address, null);

            const walletSmc = await blockchain.getContract(deployerJettonWallet.address);

            const res = walletSmc.receiveMessage(internal({
                from: deployer.address,
                to: deployerJettonWallet.address,
                body: burnMsg,
                value: toNano('1')
            }));

            expect(res.outMessagesCount).toEqual(1);

            const outMsgSc = res.outMessages.get(0)!.body.beginParse();
            expect(outMsgSc.preloadUint(32)).toEqual(Op.burn_notification);

            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore - burnAmount);

            walletSmc.receiveMessage(internal({
                from: jettonMinter.address,
                to: walletSmc.address,
                bounced: true,
                body: beginCell().storeUint(0xFFFFFFFF, 32).storeSlice(outMsgSc).endCell(),
                value: toNano('0.95')
            }));

            // Balance should roll back
            expect(await deployerJettonWallet.getJettonBalance()).toEqual(balanceBefore);
        });
    });

    describe('Upgrade', () => {
        let prevState : BlockchainSnapshot;

        let getContractData:(address: Address) => Promise<Cell>;
        let getContractCode:(smc: Address)     => Promise<Cell>;
        beforeAll(() => {
            prevState = blockchain.snapshot();
            getContractData = async (address: Address) => {
              const smc = await blockchain.getContract(address);
              if(!smc.account.account)
                throw("Account not found")
              if(smc.account.account.storage.state.type != "active" )
                throw("Atempting to get data on inactive account");
              if(!smc.account.account.storage.state.state.data)
                throw("Data is not present");
              return smc.account.account.storage.state.state.data
            }
            getContractCode = async (address: Address) => {
              const smc = await blockchain.getContract(address);
              if(!smc.account.account)
                throw("Account not found")
              if(smc.account.account.storage.state.type != "active" )
                throw("Atempting to get code on inactive account");
              if(!smc.account.account.storage.state.state.code)
                throw("Code is not present");
              return smc.account.account.storage.state.state.code;
            }
        });

        afterAll(async () => await blockchain.loadFrom(prevState));


        it('not admin should not be able to upgrade minter', async () => {
            const codeCell = beginCell().storeUint(getRandomInt(1000, (1 << 32) - 1), 32).endCell();
            const dataCell = beginCell().storeUint(getRandomInt(1000, (1 << 32) - 1), 32).endCell();

            const codeBefore = await getContractCode(jettonMinter.address);
            const dataBefore = await getContractData(jettonMinter.address);

            const notAdmin = differentAddress(deployer.address);

            const res = await jettonMinter.sendUpgrade(blockchain.sender(notAdmin), codeCell, dataCell);

            expect(res.transactions).toHaveTransaction({
                on: jettonMinter.address,
                from: notAdmin,
                success: false,
                aborted: true
            });

            // Excessive due to transaction is aborted, but still
            expect(await getContractCode(jettonMinter.address)).toEqualCell(codeBefore);
            expect(await getContractData(jettonMinter.address)).toEqualCell(dataBefore);
        });
        it('admin should be able to upgrade minter code and data', async () => {
            const codeCell = beginCell().storeUint(getRandomInt(1000, (1 << 32) - 1), 32).endCell();
            const dataCell = beginCell().storeUint(getRandomInt(1000, (1 << 32) - 1), 32).endCell();

            const res = await jettonMinter.sendUpgrade(deployer.getSender(), codeCell, dataCell);
            expect(res.transactions).toHaveTransaction({
                on: jettonMinter.address,
                from: deployer.address,
                op: Op.upgrade,
                success: true
            });

            expect(await getContractCode(jettonMinter.address)).toEqualCell(codeCell);
            expect(await getContractData(jettonMinter.address)).toEqualCell(dataCell);
        });
    });

    // Current wallet version doesn't support those operations
    // implementation detail
    it.skip('owner can withdraw excesses', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let initialBalance = (await blockchain.getContract(deployer.address)).balance;
        const withdrawResult = await deployerJettonWallet.sendWithdrawTons(deployer.getSender());
        expect(withdrawResult.transactions).toHaveTransaction({ //excesses
            from: deployerJettonWallet.address,
            to: deployer.address
        });
        let finalBalance = (await blockchain.getContract(deployer.address)).balance;
        let finalWalletBalance = (await blockchain.getContract(deployerJettonWallet.address)).balance;
        expect(finalWalletBalance).toEqual(min_tons_for_storage);
        expect(finalBalance - initialBalance).toBeGreaterThan(toNano('0.99'));
    });
    // implementation detail
    it.skip('not owner can not withdraw excesses', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        await deployer.send({value:toNano('1'), bounce:false, to: deployerJettonWallet.address});
        let initialBalance = (await blockchain.getContract(deployer.address)).balance;
        const withdrawResult = await deployerJettonWallet.sendWithdrawTons(notDeployer.getSender());
        expect(withdrawResult.transactions).not.toHaveTransaction({ //excesses
            from: deployerJettonWallet.address,
            to: deployer.address
        });
        let finalBalance = (await blockchain.getContract(deployer.address)).balance;
        let finalWalletBalance = (await blockchain.getContract(deployerJettonWallet.address)).balance;
        expect(finalWalletBalance).toBeGreaterThan(toNano('1'));
        expect(finalBalance - initialBalance).toBeLessThan(toNano('0.1'));
    });
    // implementation detail
    it.skip('owner can withdraw jettons owned by JettonWallet', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, deployerJettonWallet.address,
               deployer.address, null, forwardAmount, null);
        const childJettonWallet = await userWallet(deployerJettonWallet.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialChildJettonBalance = await childJettonWallet.getJettonBalance();
        expect(initialChildJettonBalance).toEqual(toNano('0.5'));
        let withdrawResult = await deployerJettonWallet.sendWithdrawJettons(deployer.getSender(), childJettonWallet.address, toNano('0.4'));
        expect(await deployerJettonWallet.getJettonBalance() - initialJettonBalance).toEqual(toNano('0.4'));
        expect(await childJettonWallet.getJettonBalance()).toEqual(toNano('0.1'));
        //withdraw the rest
        await deployerJettonWallet.sendWithdrawJettons(deployer.getSender(), childJettonWallet.address, toNano('0.1'));
    });
    // implementation detail
    it.skip('not owner can not withdraw jettons owned by JettonWallet', async () => {
        const deployerJettonWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        await deployerJettonWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, deployerJettonWallet.address,
               deployer.address, null, forwardAmount, null);
        const childJettonWallet = await userWallet(deployerJettonWallet.address);
        let initialJettonBalance = await deployerJettonWallet.getJettonBalance();
        let initialChildJettonBalance = await childJettonWallet.getJettonBalance();
        expect(initialChildJettonBalance).toEqual(toNano('0.5'));
        let withdrawResult = await deployerJettonWallet.sendWithdrawJettons(notDeployer.getSender(), childJettonWallet.address, toNano('0.4'));
        expect(await deployerJettonWallet.getJettonBalance() - initialJettonBalance).toEqual(toNano('0.0'));
        expect(await childJettonWallet.getJettonBalance()).toEqual(toNano('0.5'));
    });
});
