import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN, { min } from "bn.js";
chai.use(chaiBN(BN));

import * as fs from "fs";
import { Cell, beginCell, Address, toNano, Slice } from "ton";
import { SmartContract, buildC7, SendMsgAction } from "ton-contract-executor";
import * as wallet from "../contracts/jetton-wallet";
import { internalMessage, randomAddress, setBalance, parseUri, createOffchainUriCell } from "./helpers";

describe("wallet tests", () => {
    let contract: SmartContract,
        minter: Address,
        owner: Address,
        alice: Address;

    beforeEach(async () => {
        minter = randomAddress("minter");
        owner = randomAddress("owner");
        alice = randomAddress("alice");
        contract = await SmartContract.fromCell(
            Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0],
            wallet.data({
                status: new BN(0),
                balance: new BN(0),
                ownerAddress: owner,
                jettonMasterAddress: minter,
                jettonWalletCode: Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0]
            })
        );
    });

    it("should change wallet status", async () => {
        const sendSetStatusFailed = await contract.sendInternalMessage(
            internalMessage({
                from: owner,
                value: toNano(70000000),
                body: wallet.setStatus({
                    newStatus: new BN(0),
                }),
            })
        );
        expect(sendSetStatusFailed.type).to.be.equal("failed");

        const sendSetStatus = await contract.sendInternalMessage(
            internalMessage({
                from: minter,
                value: toNano(70000000),
                body: wallet.setStatus({
                    newStatus: new BN(2),
                }),
            })
        );
        expect(sendSetStatus.type).to.be.equal("success");

        const callStatus = await contract.invokeGetMethod("get_status", []);
        expect(callStatus.type).to.equal("success");
        expect((callStatus.result[0] as BN).toString()).to.be.equal("2");
    });

    it("should burn tokens", async () => {
        contract.setDataCell(wallet.data({
            status: new BN(0),
            balance: new BN(1000),
            ownerAddress: owner,
            jettonMasterAddress: minter,
            jettonWalletCode: Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0]
        }));

        const sendBurnTokensFailed = await contract.sendInternalMessage(
            internalMessage({
                from: alice,
                value: toNano(70000000),
                body: wallet.burn({
                    jettonAmount: new BN(10),
                }),
            })
        );
        expect(sendBurnTokensFailed.type).to.be.equal("failed");

        const sendBurnTokensFailed2 = await contract.sendInternalMessage(
            internalMessage({
                from: owner,
                value: toNano(70000000),
                body: wallet.burn({
                    jettonAmount: new BN(1001),
                }),
            })
        );
        expect(sendBurnTokensFailed2.type).to.be.equal("failed");

        const sendBurnTokensAdmin = await contract.sendInternalMessage(
            internalMessage({
                from: minter,
                value: toNano(70000000),
                body: wallet.burn({
                    jettonAmount: new BN(10),
                }),
            })
        );
        expect(sendBurnTokensAdmin.type).to.be.equal("success");
        expect((sendBurnTokensAdmin.actionList[0] as SendMsgAction).message.info.dest?.toString()).to.be.equal(minter.toString());

        const sendBurnTokensUser = await contract.sendInternalMessage(
            internalMessage({
                from: owner,
                value: toNano(70000000),
                body: wallet.burn({
                    jettonAmount: new BN(5),
                }),
            })
        );
        expect(sendBurnTokensUser.type).to.be.equal("success");

        const callStatus = await contract.invokeGetMethod("get_wallet_data", []);
        expect(callStatus.type).to.equal("success");
        expect((callStatus.result[0] as BN).toNumber()).to.be.equal(985);
    });

    it("should send tokens", async () => {
        contract.setDataCell(wallet.data({
            status: new BN(1),
            balance: new BN(1000),
            ownerAddress: owner,
            jettonMasterAddress: minter,
            jettonWalletCode: Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0]
        }));
        const sendTransferFailed = await contract.sendInternalMessage(
            internalMessage({
                from: owner,
                value: toNano(70000000),
                body: wallet.transfer({
                    jettonAmount: new BN(10),
                    toAddress: alice,
                }),
            })
        );
        expect(sendTransferFailed.type).to.be.equal("failed");

        const sendTransferAdmin = await contract.sendInternalMessage(
            internalMessage({
                from: minter,
                value: toNano(70000000),
                body: wallet.transfer({
                    jettonAmount: new BN(10),
                    toAddress: alice,
                }),
            })
        );
        expect(sendTransferAdmin.type).to.be.equal("success");

        contract.setDataCell(wallet.data({
            status: new BN(0),
            balance: new BN(990),
            ownerAddress: owner,
            jettonMasterAddress: minter,
            jettonWalletCode: Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0]
        }));

        const sendTransfer = await contract.sendInternalMessage(
            internalMessage({
                from: owner,
                value: toNano(70000000),
                body: wallet.transfer({
                    jettonAmount: new BN(10),
                    toAddress: alice,
                }),
            })
        );
        expect(sendTransfer.type).to.be.equal("success");

        const callStatus = await contract.invokeGetMethod("get_wallet_data", []);
        expect(callStatus.type).to.equal("success");
        expect((callStatus.result[0] as BN).toString()).to.be.equal("980");
    });

    it("should receive tokens", async () => {
        const sendReceiveFailed = await contract.sendInternalMessage(
            internalMessage({
                from: alice,
                value: toNano(70000000),
                body: wallet.internalTransfer({
                    jettonAmount: new BN(10),
                    fromAddress: alice,
                }),
            })
        );
        expect(sendReceiveFailed.type).to.be.equal("failed");

        const sendReceiveMint = await contract.sendInternalMessage(
            internalMessage({
                from: minter,
                value: toNano(70000000),
                body: wallet.internalTransfer({
                    jettonAmount: new BN(10),
                    fromAddress: minter,
                }),
            })
        );
        expect(sendReceiveMint.type).to.be.equal("success");

        const sendReceive = await contract.sendInternalMessage(
            internalMessage({
                from: Address.parseFriendly("EQCVL3PiRdi9Bsf63p0U9vqfIfcPhz_EbgobcQLR_faXdm7B").address,
                value: toNano(70000000),
                body: wallet.internalTransfer({
                    jettonAmount: new BN(10),
                    fromAddress: alice,
                }),
            })
        );
        expect(sendReceive.type).to.be.equal("success");

        const callStatus = await contract.invokeGetMethod("get_wallet_data", []);
        expect(callStatus.type).to.equal("success");
        expect((callStatus.result[0] as BN).toString()).to.be.equal("20");
    });
});