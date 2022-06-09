import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import * as fs from "fs";
import { Cell, beginCell, Address, toNano, Slice } from "ton";
import { SmartContract, buildC7, SendMsgAction } from "ton-contract-executor";
import * as minter from "../contracts/jetton-minter";
import { internalMessage, randomAddress, setBalance, parseUri, createOffchainUriCell } from "./helpers";

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
                content: createOffchainUriCell("https://usdt/token.json"),
                jettonWalletCode: Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0],
            })
        );
    });

    it("should mint tokens", async () => {
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
        const callJettonData = await contract.invokeGetMethod("get_jetton_data", []);

        expect(sendMintTokens.type).to.be.equal("success");
        expect((sendMintTokens.actionList[0] as SendMsgAction).message.info.dest?.toString()).to.be.equal(Address.parseFriendly("EQAS803jTMzPnVCXp9l-qNdXF4UkZbgf9WDfVPYDus_FisGr").address.toString());
        expect(callJettonData.type).to.equal("success");
        expect((callJettonData.result[0] as BN).toString()).to.be.equal(toNano(700000).toString());
    });


    it("should handle burn notifications", async () => {
        contract.setDataCell(
            minter.data({
                totalSupply: toNano(700000),
                adminAddress: admin,
                content: createOffchainUriCell("https://usdt/token.json"),
                jettonWalletCode: Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0],
            })
        );

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
        expect(sendChangeAdmin.actionList.length).to.be.equal(0);
    });

    it("should change content", async () => {
        const sendChangeContent = await contract.sendInternalMessage(
            internalMessage({
                from: admin,
                value: toNano(70000000),
                body: minter.changeContent({
                    newContent: createOffchainUriCell("https://usdt/token2.json"),
                }),
            })
        );
        expect(sendChangeContent.type).to.be.equal("success");
        expect(sendChangeContent.actionList.length).to.be.equal(0);
    });

    it("should upgrade minter contract", async () => {
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
        expect(sendUpgradeContract.actionList.length).to.be.equal(1);
    });

    it("should be able to send messagges to wallets", async () => {
        const sendUpgradeContract = await contract.sendInternalMessage(
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
        expect(sendUpgradeContract.type).to.be.equal("success");
        expect(sendUpgradeContract.actionList.length).to.be.equal(1);
    });
});