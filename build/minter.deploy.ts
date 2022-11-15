import * as jettonMinter from "../contracts/jetton-minter";
import fs from "fs";
import { Address, TupleSlice, WalletContract, Cell, beginCell } from "ton";
import dotenv from "dotenv";
import { BN } from "bn.js";
dotenv.config();

export function initData() {
    if (process.env.ADMIN_ADDRESS === undefined)
        throw new Error("ADMIN_ADDRESS is not defined");

    return jettonMinter.data({
        totalSupply: new BN(0),
        adminAddress: Address.parseFriendly(process.env.ADMIN_ADDRESS).address,
        jettonWalletCode: Cell.fromBoc(fs.readFileSync("build/jetton-wallet.cell"))[0],
    });
}

export function initMessage() {
    return null;
}

