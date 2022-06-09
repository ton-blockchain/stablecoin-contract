import BN from "bn.js";
import { Address, Cell, CellMessage, InternalMessage, CommonMessageInfo, WalletContract, SendMode, Wallet, Builder, beginCell } from "ton";
import { SmartContract } from "ton-contract-executor";
import Prando from "prando";

const CHUNK_DATA_PREFIX = 0x01;
const OFFCHAIN_CONTENT_PREFIX = 0x01;

export const zeroAddress = new Address(0, Buffer.alloc(32, 0));

export function randomAddress(seed: string, workchain?: number) {
    const random = new Prando(seed);
    const hash = Buffer.alloc(32);
    for (let i = 0; i < hash.length; i++) {
        hash[i] = random.nextInt(0, 255);
    }
    return new Address(workchain ?? 0, hash);
}

export function internalMessage(params: { from?: Address; to?: Address; value?: BN; bounce?: boolean; body?: Cell }) {
    const message = params.body ? new CellMessage(params.body) : undefined;
    return new InternalMessage({
        from: params.from ?? randomAddress("sender"),
        to: params.to ?? zeroAddress,
        value: params.value ?? 0,
        bounce: params.bounce ?? true,
        body: new CommonMessageInfo({ body: message }),
    });
}

export function setBalance(contract: SmartContract, balance: BN) {
    contract.setC7Config({
        balance: balance.toNumber(),
    });
}

export async function sendInternalMessageWithWallet(params: { walletContract: WalletContract; secretKey: Buffer; to: Address; value: BN; bounce?: boolean; body?: Cell }) {
    const message = params.body ? new CellMessage(params.body) : undefined;
    const seqno = await params.walletContract.getSeqNo();
    const transfer = params.walletContract.createTransfer({
        secretKey: params.secretKey,
        seqno: seqno,
        sendMode: SendMode.PAY_GAS_SEPARATLY + SendMode.IGNORE_ERRORS,
        order: new InternalMessage({
            to: params.to,
            value: params.value,
            bounce: params.bounce ?? false,
            body: new CommonMessageInfo({
                body: message,
            }),
        }),
    });
    await params.walletContract.client.sendExternalMessage(params.walletContract, transfer);
    for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(2000);
        const seqnoAfter = await params.walletContract.getSeqNo();
        if (seqnoAfter > seqno) return;
    }
}

export function parseUri(cell: Cell) {
    return new TextDecoder().decode(cell.beginParse().readRemainingBytes().slice(1)); // skip prefix
}
export function createOffchainUriCell(uri: string) {
    return beginCell()
        .storeUint(OFFCHAIN_CONTENT_PREFIX, 8)
        .storeBitArray([].slice.call(serializeUri(uri)))
        .endCell();
}

export function serializeUri(uri: string) {
    return new TextEncoder().encode(encodeURI(uri));
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
