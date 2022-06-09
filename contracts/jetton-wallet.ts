import BN from "bn.js";
import { Cell, beginCell, Address } from "ton";
import { beginMessage } from "./helpers";

export function data(params: {
    status: BN;
    balance: BN;
    ownerAddress: Address;
    jettonMasterAddress: Address;
    jettonWalletCode: Cell;
}): Cell {
    return beginCell()
        .storeUint(params.status, 4)
        .storeCoins(params.balance)
        .storeAddress(params.ownerAddress)
        .storeAddress(params.jettonMasterAddress)
        .storeRef(params.jettonWalletCode)
        .endCell();
}


export function setStatus(params: { newStatus: BN }): Cell {
    return beginMessage({ op: new BN(100) })
        .storeUint(params.newStatus, 4)
        .endCell();
}

export function burn(params: { jettonAmount: BN; responseAddress?: Address }): Cell {
    return beginMessage({ op: new BN(0x595f07bc) })
        .storeCoins(params.jettonAmount)
        .storeAddress(params.responseAddress || null)
        .endCell();
}

export function transfer(params: {
    jettonAmount: BN;
    toAddress: Address;
    forwardTonAmount?: BN;
    responseAddress?: Address
}): Cell {
    return beginMessage({ op: new BN(0xf8a7ea5) })
        .storeCoins(params.jettonAmount)
        .storeAddress(params.toAddress)
        .storeAddress(params.responseAddress || null)
        .storeBit(false)
        .storeCoins(params.forwardTonAmount || new BN(0))
        .storeBit(false)
        .endCell();
}

export function internalTransfer(params: {
    jettonAmount: BN;
    fromAddress: Address;
    forwardTonAmount?: BN;
    responseAddress?: Address
}): Cell {
    return beginMessage({ op: new BN(0x178d4519) })
        .storeCoins(params.jettonAmount)
        .storeAddress(params.fromAddress)
        .storeAddress(params.responseAddress || null)
        .storeCoins(params.forwardTonAmount || new BN(0))
        .storeBit(false)
        .endCell();
}