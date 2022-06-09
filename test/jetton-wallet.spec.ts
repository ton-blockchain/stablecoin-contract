import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import BN from "bn.js";
chai.use(chaiBN(BN));

import * as fs from "fs";
import { Cell, beginCell, Address, toNano, Slice } from "ton";
import { SmartContract, buildC7, SendMsgAction } from "ton-contract-executor";
import * as wallet from "../contracts/jetton-wallet";
import { internalMessage, randomAddress, setBalance, parseUri, createOffchainUriCell } from "./helpers";

describe("minter tests", () => {
    let contract: SmartContract,
        minter: Address,
        owner: Address;

    beforeEach(async () => {
        minter = randomAddress("minter");
        owner = randomAddress("owner");
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

});