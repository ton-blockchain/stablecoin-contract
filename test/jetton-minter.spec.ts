import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import * as fs from "fs";
import { Cell, beginCell, Address, toNano, Slice } from "ton";
import { SmartContract, buildC7, SendMsgAction } from "ton-contract-executor";
import * as minter from "../contracts/jetton-minter";
import { internalMessage, randomAddress, setBalance, parseUri, createOffchainUriCell, parseOffchainUriCell } from "./helpers";

describe("minter tests", () => {
    let contract: SmartContract,
        admin: Address,
        alice: Address;

    beforeEach(async () => {
        admin = randomAddress("admin");
        alice = randomAddress("alice");
        contract = await SmartContract.fromCell(
            Cell.fromBoc(fs.readFileSync("build/jetton-minter.cell"))[0],
            minter.data({
                totalSupply: new BN(0),
                adminAddress: admin,
                content: createOffchainUriCell("http://ton-stable.ton/token.json"),
                jettonWalletCode: Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0],
            })
        );
    });

    it("should mint tokens", async () => {
        const sendMintTokensFailed = await contract.sendInternalMessage(
            internalMessage({
                from: alice,
                value: toNano(70000000),
                body: minter.mint({
                    toAddress: alice,
                    gasAmount: toNano(7000000),
                    jettonAmount: toNano(700000),
                }),
            })
        );
        expect(sendMintTokensFailed.type).to.be.equal("failed");

        const sendMintTokens = await contract.sendInternalMessage(
            internalMessage({
                from: admin,
                value: toNano(70000000),
                body: minter.mint({
                    toAddress: alice,
                    gasAmount: toNano(7000000),
                    jettonAmount: toNano(700000),
                }),
            })
        );

        expect(sendMintTokens.type).to.be.equal("success");
        expect((sendMintTokens.actionList[0] as SendMsgAction).message.info.dest?.toString()).to.be.equal(Address.parseFriendly("EQBe2eJEEHqk6OHu0No0epXXgNpltyyTNddNX9KPySMVmbbY").address.toString());

        const callJettonData = await contract.invokeGetMethod("get_jetton_data", []);

        expect(callJettonData.type).to.equal("success");
        expect((callJettonData.result[0] as BN).toString()).to.be.equal(toNano(700000).toString());
    });

    it("should handle burn notifications", async () => {
        contract.setDataCell(
            minter.data({
                totalSupply: toNano(800000),
                adminAddress: admin,
                content: createOffchainUriCell("http://ton-stable.ton/token.json"),
                jettonWalletCode: Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0],
            })
        );

        const sendBurnNotificationFailed = await contract.sendInternalMessage(
            internalMessage({
                from: randomAddress("someone"),
                value: toNano(70000000),
                body: minter.burnNotification({
                    fromAddress: alice,
                    jettonAmount: toNano(700000),
                }),
            })
        );

        expect(sendBurnNotificationFailed.type).to.be.equal("failed");

        const aliceJettonWallet = beginCell().storeAddress(alice).endCell();
        const callGetWallettAddress = await contract.invokeGetMethod("get_wallet_address", [{ type: "cell_slice", value: aliceJettonWallet.toBoc({ idx: false }).toString("base64") }]);
        expect(callGetWallettAddress.type).to.equal("success");

        const sendBurnNotification = await contract.sendInternalMessage(
            internalMessage({
                from: ((callGetWallettAddress.result[0] as Slice).readAddress() as Address),
                value: toNano(70000000),
                body: minter.burnNotification({
                    fromAddress: alice,
                    jettonAmount: toNano(700000),
                }),
            })
        );

        expect(sendBurnNotification.type).to.be.equal("success");
        expect(sendBurnNotification.actionList.length).to.be.equal(0);

        const callJettonData = await contract.invokeGetMethod("get_jetton_data", []);

        expect(callJettonData.type).to.equal("success");
        expect((callJettonData.result[0] as BN).toString()).to.be.equal(toNano(100000).toString());
    });

    it("should change admin", async () => {
        const sendChangeAdmin = await contract.sendInternalMessage(
            internalMessage({
                from: admin,
                value: toNano(70000000),
                body: minter.changeAdmin({
                    newAdmin: alice,
                }),
            })
        );
        expect(sendChangeAdmin.type).to.be.equal("success");

        const callJettonData = await contract.invokeGetMethod("get_jetton_data", []);
        expect(callJettonData.type).to.equal("success");
        expect((callJettonData.result[2] as Slice).readAddress()?.toString()).to.be.equal(alice.toString());


        const sendChangeAdminFailed = await contract.sendInternalMessage(
            internalMessage({
                from: admin,
                value: toNano(70000000),
                body: minter.changeAdmin({
                    newAdmin: alice,
                }),
            })
        );
        expect(sendChangeAdminFailed.type).to.be.equal("failed");
    });

    it("should change content", async () => {
        let newUrl = "http://new-ton-stable.ton/token.json";

        const sendChangeContentFailed = await contract.sendInternalMessage(
            internalMessage({
                from: alice,
                value: toNano(70000000),
                body: minter.changeContent({
                    newContent: createOffchainUriCell(newUrl + "!"),
                }),
            })
        );
        expect(sendChangeContentFailed.type).to.be.equal("failed");


        const sendChangeContent = await contract.sendInternalMessage(
            internalMessage({
                from: admin,
                value: toNano(70000000),
                body: minter.changeContent({
                    newContent: createOffchainUriCell(newUrl),
                }),
            })
        );
        expect(sendChangeContent.type).to.be.equal("success");

        const callJettonData = await contract.invokeGetMethod("get_jetton_data", []);
        expect(callJettonData.type).to.equal("success");
        expect(parseOffchainUriCell(callJettonData.result[3] as Cell)).to.be.equal(newUrl);
    });

    it("should upgrade minter contract", async () => {
        const sendUpgradeContractFailed = await contract.sendInternalMessage(
            internalMessage({
                from: alice,
                value: toNano(70000000),
                body: minter.upgradeMinter({
                    newCode: Cell.fromBoc(fs.readFileSync("build/jetton-minter.cell"))[0],
                    newData: createOffchainUriCell("hello world!")
                }),
            })
        );
        expect(sendUpgradeContractFailed.type).to.be.equal("failed");

        const sendUpgradeContract = await contract.sendInternalMessage(
            internalMessage({
                from: admin,
                value: toNano(70000000),
                body: minter.upgradeMinter({
                    newCode: Cell.fromBoc(fs.readFileSync("build/jetton-minter.cell"))[0],
                    newData: createOffchainUriCell("hello world!")
                }),
            })
        );
        expect(sendUpgradeContract.type).to.be.equal("success");
        expect(sendUpgradeContract.actionList[0].type).to.be.equal("set_code");
    });

    it("should send messagges to wallets", async () => {
        const sendMsgToWalletNotAdmin = await contract.sendInternalMessage(
            internalMessage({
                from: alice,
                value: toNano(70000000),
                body: minter.callTo({
                    toAddress: alice,
                    amount: toNano(70000),
                    masterMsg: beginCell().storeUint(1, 32).endCell(),
                }),
            })
        );
        expect(sendMsgToWalletNotAdmin.type).to.be.equal("failed");
        expect(sendMsgToWalletNotAdmin.actionList.length).to.be.equal(0);

        const sendMsgToWalletIntTransf = await contract.sendInternalMessage(
            internalMessage({
                from: admin,
                value: toNano(70000000),
                body: minter.callTo({
                    toAddress: alice,
                    amount: toNano(70000),
                    masterMsg: beginCell().storeUint(0x178d4519, 32).endCell(),
                }),
            })
        );
        expect(sendMsgToWalletIntTransf.type).to.be.equal("failed");
        expect(sendMsgToWalletIntTransf.actionList.length).to.be.equal(0);

        const sendMessageToWallet = await contract.sendInternalMessage(
            internalMessage({
                from: admin,
                value: toNano(70000000),
                body: minter.callTo({
                    toAddress: alice,
                    amount: toNano(70000),
                    masterMsg: beginCell().storeUint(1, 32).endCell(),
                }),
            })
        );
        expect(sendMessageToWallet.type).to.be.equal("success");
        expect(sendMessageToWallet.actionList.length).to.be.equal(1);
    });
});
